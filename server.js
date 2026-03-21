/**
 * server.js
 *
 * Node.js / Express server for VR Street View.
 *
 * Responsibilities:
 *  1. Serve the static web app from ./public.
 *  2. Proxy Street View panorama tile requests to Google's CBK tile service.
 *     This avoids CORS errors in the browser and keeps the API key server-side.
 *  3. Proxy Google Maps Geocoding / StreetView metadata API calls.
 *
 * Environment variables:
 *   PORT            – TCP port (default: 3000).
 *   GOOGLE_MAPS_KEY – Google Maps Platform API key (required for proxy routes).
 *
 * Endpoints:
 *   GET  /api/tile?panoid=…&zoom=…&x=…&y=…
 *        Proxy a single Street View panorama tile.
 *
 *   GET  /api/metadata?pano=…   |   ?location=…&radius=…
 *        Proxy the Street View Static API metadata endpoint.
 *
 *   GET  /api/geocode?address=…
 *        Proxy the Geocoding API (returns JSON).
 *
 *   GET  /health
 *        Health-check (returns 200 OK).
 */

'use strict';

const express   = require('express');
const path      = require('path');
const fetch     = require('node-fetch');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

/** Read API key fresh on every request so tests can inject via process.env. */
const getApiKey = () => process.env.GOOGLE_MAPS_KEY || '';

/* ─── Rate limiting ──────────────────────────────────────────────────────── */

/** General limiter applied to all routes (prevents scraping / DoS). */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,                  // 300 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/** Stricter limiter for API proxy routes that forward to Google. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 120,              // 120 tile/geocode requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded, please slow down.' },
});

app.use(generalLimiter);

/* ─── Security headers ───────────────────────────────────────────────────── */

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'", "'unsafe-inline'", 'https://aframe.io', 'https://maps.googleapis.com'],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        connectSrc:  ["'self'", 'https://maps.googleapis.com'],
        workerSrc:   ["'self'", 'blob:'],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

/* ─── Static files ───────────────────────────────────────────────────────── */

app.use(express.static(path.join(__dirname, 'public')));

/* ─── Health check ───────────────────────────────────────────────────────── */

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', hasApiKey: Boolean(getApiKey()) });
});

/* ─── Helper: validate query params are safe integers / strings ─────────── */

function safeInt(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < min || n > max) return null;
  return n;
}

function safePanoId(value) {
  if (typeof value !== 'string') return null;
  // Panorama IDs are base64url-like strings, max ~64 chars.
  if (!/^[\w\-]{1,128}$/.test(value)) return null;
  return value;
}

/* ─── Tile proxy ─────────────────────────────────────────────────────────── */

/**
 * GET /api/tile?panoid=…&zoom=…&x=…&y=…
 *
 * Fetches a single equirectangular panorama tile from Google's CBK tile service
 * and streams it back to the browser as image/jpeg.
 *
 * Zoom levels and tile counts:
 *   zoom=0 → 1×1, zoom=1 → 2×1, zoom=2 → 4×2, zoom=3 → 8×4, zoom=4 → 16×8
 */
app.get('/api/tile', apiLimiter, async (req, res) => {
  const panoId = safePanoId(req.query.panoid);
  const zoom   = safeInt(req.query.zoom, 0, 4);
  const x      = safeInt(req.query.x, 0, 31);
  const y      = safeInt(req.query.y, 0, 15);

  if (panoId === null || zoom === null || x === null || y === null) {
    return res.status(400).json({ error: 'Invalid tile parameters.' });
  }

  // Validate x/y bounds for the given zoom level.
  const maxCols = Math.pow(2, zoom);
  const maxRows = Math.pow(2, Math.max(zoom - 1, 0));
  if (x >= maxCols || y >= maxRows) {
    return res.status(400).json({ error: 'Tile coordinates out of range.' });
  }

  // Google's CBK tile service URL (well-known public endpoint used by the Maps SDK).
  const tileUrl = `https://cbk0.google.com/cbk?output=tile&panoid=${encodeURIComponent(panoId)}&zoom=${zoom}&x=${x}&y=${y}`;

  try {
    const upstream = await fetch(tileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VRStreetView/1.0)',
        'Referer':    'https://maps.google.com/',
      },
      timeout: 15000,
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Upstream tile error.' });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // tiles are immutable
    upstream.body.pipe(res);

  } catch (err) {
    console.error('[tile proxy]', err.message);
    res.status(502).json({ error: 'Failed to fetch tile from upstream.' });
  }
});

/* ─── Street View metadata proxy ─────────────────────────────────────────── */

/**
 * GET /api/metadata?pano=…
 *   or
 * GET /api/metadata?location=lat,lng&radius=50
 *
 * Proxies the Street View Static API metadata endpoint.
 * Requires GOOGLE_MAPS_KEY environment variable.
 */
app.get('/api/metadata', apiLimiter, async (req, res) => {
  if (!getApiKey()) {
    return res.status(503).json({ error: 'Server-side API key not configured.' });
  }

  const params = new URLSearchParams({ key: getApiKey() });

  if (req.query.pano) {
    const panoId = safePanoId(req.query.pano);
    if (!panoId) return res.status(400).json({ error: 'Invalid pano ID.' });
    params.set('pano', panoId);

  } else if (req.query.location) {
    // Expect "lat,lng" format – basic validation.
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(req.query.location)) {
      return res.status(400).json({ error: 'Invalid location format.' });
    }
    params.set('location', req.query.location);
    if (req.query.radius) {
      const radius = safeInt(req.query.radius, 1, 5000);
      if (radius !== null) params.set('radius', radius);
    }
  } else {
    return res.status(400).json({ error: 'Provide pano or location parameter.' });
  }

  const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?${params}`;

  try {
    const upstream = await fetch(metaUrl, { timeout: 10000 });
    const json = await upstream.json();
    res.json(json);
  } catch (err) {
    console.error('[metadata proxy]', err.message);
    res.status(502).json({ error: 'Failed to fetch metadata.' });
  }
});

/* ─── Geocoding proxy ────────────────────────────────────────────────────── */

/**
 * GET /api/geocode?address=…
 *
 * Proxies the Google Maps Geocoding API.
 * Requires GOOGLE_MAPS_KEY environment variable.
 */
app.get('/api/geocode', apiLimiter, async (req, res) => {
  if (!getApiKey()) {
    return res.status(503).json({ error: 'Server-side API key not configured.' });
  }

  const address = req.query.address;
  if (!address || typeof address !== 'string' || address.length > 256) {
    return res.status(400).json({ error: 'Invalid address parameter.' });
  }

  const params = new URLSearchParams({ address, key: getApiKey() });
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;

  try {
    const upstream = await fetch(geoUrl, { timeout: 10000 });
    const json = await upstream.json();
    res.json(json);
  } catch (err) {
    console.error('[geocode proxy]', err.message);
    res.status(502).json({ error: 'Failed to geocode address.' });
  }
});

/* ─── Catch-all → serve index.html (SPA) ────────────────────────────────── */

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Start server ───────────────────────────────────────────────────────── */

if (require.main === module) {
  if (!getApiKey()) {
    console.warn(
      '[VRStreetView] WARNING: GOOGLE_MAPS_KEY not set.\n' +
      '  The /api/metadata and /api/geocode proxy routes will return 503.\n' +
      '  Set the env variable before starting the server:\n' +
      '  GOOGLE_MAPS_KEY=AIza… node server.js'
    );
  }

  app.listen(PORT, () => {
    console.log(`[VRStreetView] Server running on http://localhost:${PORT}`);
    console.log(`[VRStreetView] Open in Quest 3 browser or at http://localhost:${PORT}`);
  });
}

module.exports = app; // exported for testing
