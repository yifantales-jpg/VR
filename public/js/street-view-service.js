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
 *   zoom 3 → 8 × 4   ← default (4096 × 2048 result, good quality)
 *   zoom 4 → 16 × 8
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
   *  - New desktop URL: https://www.google.com/maps/@lat,lng,…/data=…!1sPANO_ID…
   *  - Old URL:         https://maps.google.com/maps?panoid=PANO_ID
   *  - cbll parameter:  …&cbll=lat,lng
   *  - lat/lng q param: …?q=lat,lng
   *
   * @param {string} url – Any Google Maps Street View URL.
   * @returns {{ panoId: string }|{ lat: number, lng: number, heading?: number }|null}
   */
  static parseGoogleMapsUrl(url) {
    try {
      const u = new URL(url.trim());

      // 1. Try panoId from the 'data' path segment (new desktop URLs):
      //    …/@lat,lng,…/data=!3m…!1sPANO_ID!…
      const pathDataMatch = u.pathname.match(/\/data=([^?#]*)/);
      if (pathDataMatch) {
        const m = pathDataMatch[1].match(/!1s([^!]+)/);
        if (m && m[1]) return { panoId: m[1] };
      }

      // 2. Try panoId from the 'data' query parameter (some share links).
      const data = u.searchParams.get('data');
      if (data) {
        const m = data.match(/!1s([^!]+)/);
        if (m && m[1]) return { panoId: m[1] };
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
   * @param {{ panoId?: string, lat?: number, lng?: number }} location
   * @returns {Promise<PanoramaData>}
   */
  async fetchPanoData({ panoId, lat, lng } = {}) {
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
   * @param {string}          panoId  – Panorama ID.
   * @param {HTMLCanvasElement} canvas – Destination canvas (width/height will be set).
   * @param {Function}        onProgress – Called with (loaded, total) as tiles arrive.
   * @returns {Promise<HTMLCanvasElement>}
   */
  async stitchPanorama(panoId, canvas, onProgress = () => {}) {
    const zoom     = this.tileZoom;
    const cols     = Math.pow(2, zoom);
    const rows     = Math.pow(2, zoom - 1);
    const tileSize = 512;

    canvas.width  = cols * tileSize;
    canvas.height = rows * tileSize;

    const ctx   = canvas.getContext('2d');
    const total = cols * rows;
    let loaded  = 0;

    const tilePromises = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const destX = col * tileSize;
        const destY = row * tileSize;

        tilePromises.push(
          this._loadTile(panoId, zoom, col, row)
            .then(img => {
              ctx.drawImage(img, destX, destY, tileSize, tileSize);
              loaded++;
              onProgress(loaded, total);
            })
            .catch(() => {
              // Draw a dark placeholder if a tile fails so the sphere still loads.
              ctx.fillStyle = '#1a1a2e';
              ctx.fillRect(destX, destY, tileSize, tileSize);
              loaded++;
              onProgress(loaded, total);
            })
        );
      }
    }

    await Promise.all(tilePromises);
    return canvas;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

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
