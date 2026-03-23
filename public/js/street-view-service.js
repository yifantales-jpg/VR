/**
 * street-view-service.js
 *
 * Handles all communication with Google's public Street View tile and metadata
 * services. No Google Maps API key is required.
 *
 * Usage:
 *  1. Parse a Google Maps URL:
 *       const parsed = StreetViewService.parseGoogleMapsUrl(url);
 *       // → { panoId: '…' }  or  { lat: …, lng: …, heading: … }
 *
 *  2. Fetch panorama metadata via the server proxy:
 *       const panoData = await svc.fetchPanoData(parsed);
 *
 *  3. Stitch tiles onto a canvas:
 *       await svc.stitchPanorama(panoData.panoId, canvas, onProgress);
 *
 * Panorama tile coordinate system (equirectangular cube-face tiles):
 *   zoom 0 → 1 column × 1 row
 *   zoom 1 → 2 × 1
 *   zoom 2 → 4 × 2
 *   zoom 3 → 8 × 4   (4096 × 2048 result)
 *   zoom 4 → 16 × 8  ← maximum (8192 × 4096 result — highest quality available)
 */

'use strict';

class StreetViewService {
  /**
   * @param {Object} opts
   * @param {string}  opts.proxyUrl – Base URL of the tile/pano proxy (default: '/api').
   * @param {number}  opts.tileZoom – Tile zoom level, 1–4 (default: 3).
   */
  constructor({ proxyUrl = '/api', tileZoom = 3 } = {}) {
    this.proxyUrl = proxyUrl;
    this.tileZoom = Math.max(1, Math.min(4, tileZoom));
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Parse a Google Maps URL and extract panorama location info.
   *
   * Supports:
   *  - New desktop URL:   https://www.google.com/maps/@lat,lng,…/data=…!1sPANO_ID…
   *  - User Photo Sphere: same URL shape but with !6s<google-photo-url> and !2e10/!3e11 flags
   *  - Old URL:           https://maps.google.com/maps?panoid=PANO_ID
   *  - cbll parameter:    …&cbll=lat,lng
   *  - lat/lng q param:   …?q=lat,lng
   *
   * @param {string} url – Any Google Maps Street View URL.
   * @returns {{ panoId: string, photoUrl?: string, photoWidth?: number, photoHeight?: number }|{ lat: number, lng: number, heading?: number }|null}
   */
  static parseGoogleMapsUrl(url) {
    try {
      const u = new URL(url.trim());

      // 1. Try panoId from the 'data' path segment (new desktop URLs):
      //    …/@lat,lng,…/data=!3m…!1sPANO_ID!…
      const pathDataMatch = u.pathname.match(/\/data=([^?#]*)/);
      if (pathDataMatch) {
        const m = pathDataMatch[1].match(/!1s([^!]+)/);
        if (m && m[1]) {
          const panoId = decodeURIComponent(m[1]);
          // User-contributed Photo Spheres embed a direct Google image URL in !6s.
          // When present, pass it through so the caller can skip the CBK tile proxy.
          const photoUrl = StreetViewService._extractGooglePhotoUrl(pathDataMatch[1]);
          if (photoUrl) {
            const dims = StreetViewService._extractPhotoDimensions(pathDataMatch[1]);
            return { panoId, photoUrl, ...dims };
          }
          return { panoId };
        }
      }

      // 2. Try panoId from the 'data' query parameter (some share links).
      const data = u.searchParams.get('data');
      if (data) {
        const m = data.match(/!1s([^!]+)/);
        if (m && m[1]) {
          const panoId = decodeURIComponent(m[1]);
          const photoUrl = StreetViewService._extractGooglePhotoUrl(data);
          if (photoUrl) {
            const dims = StreetViewService._extractPhotoDimensions(data);
            return { panoId, photoUrl, ...dims };
          }
          return { panoId };
        }
      }

      // 3. Try 'panoid' query parameter (old-style URLs).
      const panoid = u.searchParams.get('panoid');
      if (panoid) return { panoId: panoid };

      // 4. Try to extract lat/lng (and optional heading) from the '@' in the pathname.
      //    e.g. /maps/@48.8584,2.2945,3a,75y,90h,90t
      const atMatch = u.pathname.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (atMatch) {
        const lat = parseFloat(atMatch[1]);
        const lng = parseFloat(atMatch[2]);
        // Heading is encoded as …,Xh, in the path segment list (or at end of path).
        const headingMatch = u.pathname.match(/,([\d.]+)h(?:[,/]|$)/);
        const heading = headingMatch ? parseFloat(headingMatch[1]) : 0;
        return { lat, lng, heading };
      }

      // 5. Try 'cbll' parameter (old Street View embed style).
      const cbll = u.searchParams.get('cbll');
      if (cbll) {
        const parts = cbll.split(',');
        if (parts.length === 2) {
          const lat = parseFloat(parts[0]);
          const lng = parseFloat(parts[1]);
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
        }
      }

      // 6. Try 'q' parameter when it is a bare lat,lng pair.
      const q = u.searchParams.get('q');
      if (q && /^-?\d+\.?\d*,-?\d+\.?\d*$/.test(q.trim())) {
        const parts = q.split(',');
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch panorama metadata from the server-side CBK proxy.
   *
   * When the parsed location contains a `photoUrl` (user-contributed Photo
   * Sphere), the CBK proxy is skipped and a synthetic PanoramaData object is
   * returned immediately so the caller can load the image directly.
   *
   * @param {{ panoId?: string, lat?: number, lng?: number, photoUrl?: string }} location
   * @returns {Promise<PanoramaData>}
   */
  async fetchPanoData({ panoId, lat, lng, photoUrl, photoWidth, photoHeight } = {}) {
    // User-contributed Photo Sphere: the equirectangular image URL is embedded
    // directly in the Maps URL; skip the CBK metadata proxy entirely.
    if (photoUrl) {
      return {
        panoId:      panoId || '',
        description: '',
        latLng:      { lat: 0, lng: 0 },
        links:       [],
        copyright:   '',
        tiles:       null,
        photoUrl,
        photoWidth,
        photoHeight,
      };
    }

    let query;
    if (panoId) {
      query = `panoid=${encodeURIComponent(panoId)}`;
    } else if (lat !== undefined && lng !== undefined) {
      query = `ll=${encodeURIComponent(`${lat},${lng}`)}`;
    } else {
      throw new Error('Provide panoId or lat/lng to fetch panorama data.');
    }

    const response = await fetch(`${this.proxyUrl}/pano?${query}`);
    if (!response.ok) {
      let msg = 'Failed to load panorama data.';
      try {
        const json = await response.json();
        if (json.error) msg = json.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    const json = await response.json();
    return this._normaliseCbkData(json);
  }

  /**
   * Stitch the full equirectangular panorama from individual tiles onto a canvas.
   *
   * Tile requests are dispatched with bounded concurrency (up to
   * `TILE_CONCURRENCY` in-flight at once) to avoid saturating the browser's
   * HTTP connection pool and to stay comfortably within the server's per-minute
   * rate limit.
   *
   * @param {string}          panoId  – Panorama ID.
   * @param {HTMLCanvasElement} canvas – Destination canvas (width/height will be set).
   * @param {Function}        onProgress – Called with (loaded, total) as tiles arrive.
   * @returns {Promise<HTMLCanvasElement>}
   */
  async stitchPanorama(panoId, canvas, onProgress = () => {}) {
    const zoom            = this.tileZoom;
    const cols            = Math.pow(2, zoom);
    const rows            = Math.pow(2, zoom - 1);
    const tileSize        = 512;
    const TILE_CONCURRENCY = 8; // max simultaneous tile requests

    canvas.width  = cols * tileSize;
    canvas.height = rows * tileSize;

    const ctx   = canvas.getContext('2d');
    const total = cols * rows;
    let loaded  = 0;

    // Build the ordered list of tile-fetch tasks (closures, not yet started).
    const tasks = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const destX = col * tileSize;
        const destY = row * tileSize;
        tasks.push(() =>
          this._loadTile(panoId, zoom, col, row)
            .then(img => {
              ctx.drawImage(img, destX, destY, tileSize, tileSize);
            })
            .catch(() => {
              // Draw a dark placeholder so the sphere still renders.
              ctx.fillStyle = '#1a1a2e';
              ctx.fillRect(destX, destY, tileSize, tileSize);
            })
            .finally(() => {
              loaded++;
              onProgress(loaded, total);
            })
        );
      }
    }

    await this._runWithConcurrency(tasks, TILE_CONCURRENCY);
    return canvas;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Extract a cleaned Google image-hosting URL from a Maps data string.
   *
   * User-contributed Photo Spheres embed their equirectangular image URL inside
   * a `!6s…` segment of the Maps data blob. The URL is percent-encoded and
   * includes size/transform parameters after a bare `=` separator; this method
   * decodes the URL and strips those parameters so the caller can request its
   * own preferred size (e.g. `=w8192-h4096-k-no`).
   *
   * Returns null when the data string contains no usable Google photo URL.
   *
   * @param {string} dataStr – Raw (path-encoded) or pre-decoded Maps data blob.
   * @returns {string|null}
   */
  static _extractGooglePhotoUrl(dataStr) {
    const m = dataStr.match(/!6s(https?[^!]+)/);
    if (!m) return null;
    try {
      const rawUrl = decodeURIComponent(m[1]);
      if (!/^https:\/\/lh\d+\.googleusercontent\.com\//.test(rawUrl)) return null;
      // Strip the size/transform suffix that follows the bare `=` separator.
      return rawUrl.replace(/=.*$/, '');
    } catch {
      return null;
    }
  }

  /**
   * Extract the native panorama dimensions from a Maps data string.
   *
   * Photo Sphere URLs embed the source image dimensions in `!7i<width>` and
   * `!8i<height>` segments. These are used to request the image at its native
   * resolution rather than a fixed constant, preventing Google's image-serving
   * from rejecting an oversized request (e.g. when the constant exceeds the
   * native width, Google may return an error instead of the image).
   *
   * Returns an empty object when the segments are absent.
   *
   * @param {string} dataStr – Raw (path-encoded) or pre-decoded Maps data blob.
   * @returns {{ photoWidth?: number, photoHeight?: number }}
   */
  static _extractPhotoDimensions(dataStr) {
    const wMatch = dataStr.match(/!7i(\d+)/);
    const hMatch = dataStr.match(/!8i(\d+)/);
    if (wMatch && hMatch) {
      return {
        photoWidth:  parseInt(wMatch[1], 10),
        photoHeight: parseInt(hMatch[1], 10),
      };
    }
    return {};
  }

  /**
   * Normalise a CBK JSON metadata response into the shared PanoramaData shape.
   * @param {Object} json – Raw JSON from cbk0.google.com/cbk?output=json
   * @returns {PanoramaData}
   */
  _normaliseCbkData(json) {
    const loc = json.Location || {};
    return {
      panoId:      loc.panoId || '',
      description: loc.description || '',
      latLng: {
        lat: parseFloat(loc.lat) || 0,
        lng: parseFloat(loc.lng) || 0,
      },
      links: (json.Links || []).map(l => ({
        panoId:      l.panoId || '',
        heading:     parseFloat(l.heading) || 0,
        description: l.description || '',
      })),
      copyright: '',
      tiles: json.Data || null,
    };
  }

  /**
   * Run an array of zero-argument async task factories with at most `limit`
   * tasks executing concurrently.  Tasks are started in order; a new task
   * begins as soon as a running slot becomes free.
   *
   * @param {Array<() => Promise<any>>} tasks
   * @param {number} limit – Max concurrent tasks (must be ≥ 1).
   * @returns {Promise<void>}
   */
  _runWithConcurrency(tasks, limit) {
    const iter = tasks[Symbol.iterator]();
    const workers = Array.from({ length: limit }, async () => {
      for (const task of iter) {
        await task(); // eslint-disable-line no-await-in-loop
      }
    });
    return Promise.all(workers);
  }

  /**
   * Build the Street View tile URL routed through the server proxy (avoids CORS).
   */
  _tileUrl(panoId, zoom, x, y) {
    return `${this.proxyUrl}/tile?panoid=${encodeURIComponent(panoId)}&zoom=${zoom}&x=${x}&y=${y}`;
  }

  /** Load a single tile image element. */
  _loadTile(panoId, zoom, x, y) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error(`Tile load failed: pano=${panoId} z=${zoom} x=${x} y=${y}`));
      img.src = this._tileUrl(panoId, zoom, x, y);
    });
  }
}

/**
 * @typedef {Object} PanoramaData
 * @property {string}              panoId
 * @property {string}              description
 * @property {{ lat: number, lng: number }} latLng
 * @property {Array<LinkData>}     links
 * @property {string}              copyright
 * @property {Object|null}         tiles
 * @property {string}              [photoUrl]     – Direct equirectangular image URL (Photo Spheres only).
 * @property {number}              [photoWidth]   – Native image width in pixels (Photo Spheres only).
 * @property {number}              [photoHeight]  – Native image height in pixels (Photo Spheres only).
 */

/**
 * @typedef {Object} LinkData
 * @property {string} panoId
 * @property {number} heading
 * @property {string} description
 */

// Export for use in Node.js tests (browser ignores this).
if (typeof module !== 'undefined') {
  module.exports = { StreetViewService };
}
