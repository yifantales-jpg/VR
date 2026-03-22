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
 *  4. Serve over HTTPS (required for WebXR on Quest 3 and other devices).
 *     A self-signed certificate is generated automatically when no certificate
 *     is provided. For production, supply SSL_CERT_FILE and SSL_KEY_FILE.
 *
 * Environment variables:
 *   PORT        – HTTP port (default: 3000).
 *   HTTPS_PORT  – HTTPS port (default: 3443).
 *   SSL_CERT_FILE – Path to PEM certificate file (optional; auto-generated if absent).
 *   SSL_KEY_FILE  – Path to PEM private key file (optional; auto-generated if absent).
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
 *   GET  /api/photo?url=…
 *        Proxy a user-contributed Photo Sphere equirectangular image from
 *        Google's image hosting (lh3.googleusercontent.com). Only Google
 *        image hosting URLs are accepted to prevent open-proxy abuse.
 *
 *   POST /api/ai-facts
 *        Accept a base64 JPEG snapshot of the current view and an optional
 *        location description; query the Google Gemini API for amazing
 *        facts about the scene and return them as text.
 *        Requires GEMINI_API_KEY environment variable.
 *
 *   GET  /health
 *        Health-check (returns 200 OK).
 *
 * Additional environment variables:
 *   GEMINI_API_KEY – API key for the Google Gemini API
 *                    (https://aistudio.google.com/app/apikey).
 *                    Required for the /api/ai-facts endpoint.
 *                    For local testing, set it in your shell before starting
 *                    the server:  export GEMINI_API_KEY=your_key_here
 */

'use strict';

const https      = require('https');
const fs         = require('fs');
const express    = require('express');
const path       = require('path');
const fetch      = require('node-fetch');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const selfsigned = require('selfsigned');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

/* ─── Rate limiting ──────────────────────────────────────────────────────── */

/** General limiter applied to all routes (prevents scraping / DoS). */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1500,                 // ~10 full panorama loads (128 tiles each) per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/** Stricter limiter for API proxy routes that forward to Google. */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 300,              // covers one full zoom=4 load (128 tiles) + navigation overhead
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
        connectSrc:  ["'self'", 'https://cdn.aframe.io'],
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

/* ─── Photo Sphere image proxy ───────────────────────────────────────────── */

/**
 * GET /api/photo?url=…
 *
 * Proxies a user-contributed Photo Sphere equirectangular image from Google's
 * image hosting service (lh3.googleusercontent.com) back to the browser.
 * This avoids CORS restrictions that would otherwise prevent the canvas from
 * painting the cross-origin image.
 *
 * Only lh3.googleusercontent.com URLs are accepted to prevent open-proxy abuse.
 */
app.get('/api/photo', apiLimiter, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required.' });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  // Restrict to Google's image-hosting domain to prevent open-proxy abuse.
  if (!/^lh\d+\.googleusercontent\.com$/.test(parsedUrl.hostname)) {
    return res.status(400).json({ error: 'Only Google image hosting URLs are supported.' });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VRStreetView/1.0)',
        'Referer':    'https://maps.google.com/',
      },
      timeout: 30000,
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Could not fetch photo.' });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    upstream.body.on('error', (err) => {
      console.error('[photo proxy] Stream error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to fetch photo.' });
      } else {
        res.destroy();
      }
    });
    upstream.body.pipe(res);

  } catch (err) {
    console.error('[photo proxy]', err.message);
    res.status(502).json({ error: 'Failed to fetch photo.' });
  }
});

/* ─── Short URL resolver ─────────────────────────────────────────────────── */

/**
 * GET /api/resolve?url=…
 *
 * Follows HTTP redirects for a known short URL service and returns the final
 * (fully-resolved) URL.  This lets the client resolve Google Maps short links
 * (maps.app.goo.gl) and Twitter/X share links (t.co) before passing them to
 * StreetViewService.parseGoogleMapsUrl.
 *
 * Only URLs from the ALLOWED_SHORT_URL_HOSTS allowlist are accepted to prevent
 * open-proxy / SSRF abuse.
 */
const ALLOWED_SHORT_URL_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  't.co',
]);

app.get('/api/resolve', apiLimiter, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url parameter required.' });

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are supported.' });
  }

  if (!ALLOWED_SHORT_URL_HOSTS.has(parsedUrl.hostname)) {
    return res.status(400).json({
      error: `URL host not supported. Supported hosts: ${[...ALLOWED_SHORT_URL_HOSTS].join(', ')}.`,
    });
  }

  try {
    const upstream = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VRStreetView/1.0)',
      },
    });
    res.json({ url: upstream.url });
  } catch (err) {
    console.error('[resolve proxy]', err.message);
    res.status(502).json({ error: 'Failed to resolve URL.' });
  }
});

/* ─── Google Gemini AI facts endpoint ───────────────────────────────────── */

/**
 * POST /api/ai-facts
 *
 * Accepts a base64-encoded JPEG snapshot of the current panorama view (as a
 * data URL) and an optional location description.  Forwards the image to the
 * Google Gemini API and returns a short list of amazing facts about the scene.
 *
 * Requires the GEMINI_API_KEY environment variable (Google AI Studio API key).
 * To obtain a key visit https://aistudio.google.com/app/apikey.
 * For local testing: export GEMINI_API_KEY=your_key_here  (then npm start)
 *
 * Request body (JSON, max 4 MB):
 *   { image: "data:image/jpeg;base64,…", description: "Location name" }
 *
 * Response (JSON):
 *   { facts: "…interesting facts…" }
 */
app.post('/api/ai-facts', express.json({ limit: '4mb' }), apiLimiter, async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI service not configured (GEMINI_API_KEY not set).' });
  }

  const { image, description } = req.body || {};
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'image field required (base64 data URL).' });
  }

  // Split "data:<mimeType>;base64,<data>" into its components for Gemini's
  // inlineData format.
  const dataUrlMatch = image.match(/^data:([^;]+);base64,(.+)$/);
  if (!dataUrlMatch) {
    return res.status(400).json({ error: 'image field required (base64 data URL).' });
  }
  const mimeType  = dataUrlMatch[1];
  const imageData = dataUrlMatch[2];

  const locationHint = description ? ` at "${description}"` : '';
  const prompt = `This is a Street View panorama${locationHint}. Share 3–4 amazing, surprising, or little-known facts about what you see — the location, architecture, history, culture, or anything remarkable. Be specific, fascinating, and concise.`;

  const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  try {
    const upstream = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: imageData } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 400 },
      }),
      timeout: 30000,
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[ai-facts] upstream error:', upstream.status, body);
      return res.status(502).json({ error: 'AI service returned an error.' });
    }

    const data  = await upstream.json();
    const facts = (data.candidates &&
                   data.candidates[0] &&
                   data.candidates[0].content &&
                   data.candidates[0].content.parts &&
                   data.candidates[0].content.parts[0] &&
                   data.candidates[0].content.parts[0].text) || '';
    res.json({ facts });

  } catch (err) {
    console.error('[ai-facts]', err.message);
    res.status(502).json({ error: 'Failed to get AI response.' });
  }
});

/* ─── Catch-all → serve index.html (SPA) ────────────────────────────────── */

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Start server ───────────────────────────────────────────────────────── */

/**
 * Load or auto-generate a TLS certificate for the HTTPS server.
 *
 * Priority:
 *  1. SSL_CERT_FILE + SSL_KEY_FILE environment variables → use provided files.
 *  2. No files provided → generate a self-signed certificate in memory.
 *
 * The self-signed certificate is valid for localhost and common loopback
 * addresses. Browsers will show a "Not secure" warning for self-signed certs;
 * users must accept the warning once (or install the cert as trusted).
 */
async function loadOrGenerateTlsCredentials() {
  const certFile = process.env.SSL_CERT_FILE;
  const keyFile  = process.env.SSL_KEY_FILE;

  if (certFile && keyFile) {
    try {
      return {
        cert: fs.readFileSync(certFile, 'utf8'),
        key:  fs.readFileSync(keyFile,  'utf8'),
      };
    } catch (err) {
      console.warn(`[VRStreetView] Could not read SSL certificate files: ${err.message}`);
      console.warn('[VRStreetView] Falling back to auto-generated self-signed certificate.');
    }
  }

  // Generate a self-signed certificate valid for one year, covering localhost
  // and common local-network access patterns.
  const attrs = [{ name: 'commonName', value: 'VR Street View (self-signed)' }];
  const opts  = {
    days:      365,
    algorithm: 'sha256',
    extensions: [
      {
        name:     'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' },
        ],
      },
    ],
  };

  const pems = await selfsigned.generate(attrs, opts);
  return { cert: pems.cert, key: pems.private };
}

if (require.main === module) {
  // HTTP server — keeps plain-HTTP access working alongside HTTPS.
  app.listen(PORT, () => {
    console.log(`[VRStreetView] HTTP  server running on http://localhost:${PORT}`);
  });

  // HTTPS server — required for WebXR on Quest 3 and modern browsers.
  loadOrGenerateTlsCredentials().then((tlsCreds) => {
    https.createServer(tlsCreds, app).listen(HTTPS_PORT, () => {
      console.log(`[VRStreetView] HTTPS server running on https://localhost:${HTTPS_PORT}`);
      console.log(`[VRStreetView] Open in Quest 3 browser: https://<your-pc-ip>:${HTTPS_PORT}`);
      if (!process.env.SSL_CERT_FILE) {
        console.log('[VRStreetView] Using auto-generated self-signed certificate.');
        console.log('[VRStreetView] Accept the browser security warning to proceed.');
      }
    });
  }).catch((err) => {
    console.error('[VRStreetView] Failed to start HTTPS server:', err.message);
    process.exit(1);
  });
}

module.exports = app; // exported for testing
