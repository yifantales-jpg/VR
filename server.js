/**
 * server.js
 *
 * Node.js / Express server for VR Street View.
 *
 * Responsibilities:
 *  1. Serve the static web app from ./public.
 *  2. Proxy Street View panorama tile requests to Google's CBK tile service.
 *     This avoids CORS errors in the browser. No API key is required.
 *  3. Proxy CBK panorama metadata (JSON) requests. No API key required.
 *
 * Environment variables:
 *   PORT – TCP port (default: 3000).
 *
 * Endpoints:
 *   GET  /api/tile?panoid=…&zoom=…&x=…&y=…
 *        Proxy a single Street View panorama tile.
 *
 *   GET  /api/pano?panoid=…
 *        Proxy CBK panorama metadata by pano ID (returns JSON).
 *
 *   GET  /api/pano?ll=lat,lng
 *        Proxy CBK panorama metadata nearest to lat/lng (returns JSON).
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
        scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc:    ["'self'", "'unsafe-inline'"],
        imgSrc:      ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        connectSrc:  ["'self'"],
        workerSrc:   ["'self'", 'blob:'],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Allow WebXR / immersive-vr sessions on Quest browser.
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'xr-spatial-tracking=*');
  next();
});

/* ─── Static files ───────────────────────────────────────────────────────── */

app.use(express.static(path.join(__dirname, 'public')));

// Serve A-Frame from node_modules to avoid bundling a 1.4 MB file in source.
app.get('/js/aframe.min.js', (_req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'aframe', 'dist', 'aframe-v1.5.0.min.js'));
});

/* ─── Health check ───────────────────────────────────────────────────────── */

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/* ─── Helper: validate query params are safe integers / strings ─────────── */

/** Default search radius (metres) when finding a panorama nearest to lat/lng. */
const DEFAULT_PANO_SEARCH_RADIUS = 50;

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

/* ─── Panorama metadata proxy (CBK – no API key required) ────────────────── */

/**
 * GET /api/pano?panoid=…
 *   or
 * GET /api/pano?ll=lat,lng
 *
 * Proxies Google's CBK JSON metadata endpoint for a Street View panorama.
 * No Google Maps API key is required; CBK is a public tile/metadata service.
 */
app.get('/api/pano', apiLimiter, async (req, res) => {
  const params = new URLSearchParams({ output: 'json' });

  if (req.query.panoid) {
    const panoId = safePanoId(req.query.panoid);
    if (!panoId) return res.status(400).json({ error: 'Invalid pano ID.' });
    params.set('panoid', panoId);

  } else if (req.query.ll) {
    if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(req.query.ll)) {
      return res.status(400).json({ error: 'Invalid location format (expected lat,lng).' });
    }
    params.set('ll', req.query.ll);
    params.set('radius', String(DEFAULT_PANO_SEARCH_RADIUS));

  } else {
    return res.status(400).json({ error: 'Provide panoid or ll parameter.' });
  }

  const cbkUrl = `https://cbk0.google.com/cbk?${params}`;

  try {
    const upstream = await fetch(cbkUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VRStreetView/1.0)',
        'Referer':    'https://maps.google.com/',
      },
      timeout: 10000,
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Could not find a panorama at this location.' });
    }

    const json = await upstream.json();
    res.json(json);

  } catch (err) {
    console.error('[pano proxy]', err.message);
    res.status(502).json({ error: 'Failed to fetch panorama data.' });
  }
});

/* ─── Catch-all → serve index.html (SPA) ────────────────────────────────── */

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Start server ───────────────────────────────────────────────────────── */

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[VRStreetView] Server running on http://localhost:${PORT}`);
    console.log(`[VRStreetView] Open in Quest 3 browser or at http://localhost:${PORT}`);
  });
}

module.exports = app; // exported for testing
