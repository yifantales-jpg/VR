/**
 * street-view-service.js
 *
 * Handles all communication with the Google Maps / Street View APIs.
 * Supports two modes:
 *  1. Direct mode  – uses the Google Maps JavaScript API (requires API key loaded in page).
 *  2. Proxy  mode  – routes every request through /api/proxy on the Node.js server,
 *                    which avoids CORS issues for tile fetching.
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
   * @param {string}  opts.apiKey   – Google Maps API key (optional when using proxy).
   * @param {string}  opts.proxyUrl – Base URL of the tile proxy (default: '/api').
   * @param {number}  opts.tileZoom – Tile zoom level, 2–4 (default: 3).
   */
  constructor({ apiKey = '', proxyUrl = '/api', tileZoom = 3 } = {}) {
    this.apiKey   = apiKey;
    this.proxyUrl = proxyUrl;
    this.tileZoom = Math.max(1, Math.min(4, tileZoom));
    this._mapsReady = false;
    this._loadPromise = null;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Load the Google Maps JavaScript API (idempotent – safe to call multiple times).
   * @returns {Promise<void>}
   */
  loadMapsAPI() {
    if (this._mapsReady) return Promise.resolve();
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = new Promise((resolve, reject) => {
      // Guard for non-browser environments (e.g. Node.js unit tests).
      if (typeof window !== 'undefined' && window.google && window.google.maps) {
        this._mapsReady = true;
        resolve();
        return;
      }

      if (!this.apiKey) {
        reject(new Error('Google Maps API key is required to initialise the Maps SDK.'));
        return;
      }

      const callbackName = `_svInitCallback_${Date.now()}`;
      window[callbackName] = () => {
        this._mapsReady = true;
        resolve();
        delete window[callbackName];
      };

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(this.apiKey)}&libraries=places&callback=${callbackName}`;
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
      document.head.appendChild(script);
    });

    return this._loadPromise;
  }

  /**
   * Find a Street View panorama near the given address or coordinates.
   * @param {string} query  – Human-readable address / place name.
   * @returns {Promise<PanoramaData>}
   */
  async findPanoramaByQuery(query) {
    await this.loadMapsAPI();

    // Geocode the query to (lat, lng) first.
    const latLng = await this._geocode(query);
    return this.findPanoramaByLocation(latLng);
  }

  /**
   * Find a Street View panorama near a geographic coordinate.
   * @param {{ lat: number, lng: number }} latLng
   * @returns {Promise<PanoramaData>}
   */
  findPanoramaByLocation(latLng) {
    return this._svRequest({ location: latLng, radius: 100, preference: 'nearest' });
  }

  /**
   * Fetch a panorama by its panoId string.
   * @param {string} panoId
   * @returns {Promise<PanoramaData>}
   */
  findPanoramaById(panoId) {
    return this._svRequest({ pano: panoId });
  }

  /**
   * Stitch the full equirectangular panorama from individual tiles onto a canvas.
   * @param {string}          panoId  – Panorama ID returned by the Maps API.
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

  /** Geocode a text query → {lat, lng} */
  async _geocode(query) {
    return new Promise((resolve, reject) => {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ address: query }, (results, status) => {
        if (status === google.maps.GeocoderStatus.OK && results.length > 0) {
          const loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
        } else {
          reject(new Error(`Geocoding failed for "${query}": ${status}`));
        }
      });
    });
  }

  /** Call the StreetViewService with the given request object. */
  _svRequest(request) {
    return new Promise((resolve, reject) => {
      const svc = new google.maps.StreetViewService();
      svc.getPanorama(request, (data, status) => {
        if (status === google.maps.StreetViewStatus.OK) {
          resolve(this._normalisePanoData(data));
        } else {
          reject(new Error(`Street View unavailable (${status})`));
        }
      });
    });
  }

  /**
   * Normalise the raw Maps API panorama object into a consistent shape.
   * @param {google.maps.StreetViewPanoramaData} raw
   * @returns {PanoramaData}
   */
  _normalisePanoData(raw) {
    const loc = raw.location;
    return {
      panoId:      loc.pano,
      description: loc.description || '',
      latLng: {
        lat: loc.latLng.lat(),
        lng: loc.latLng.lng(),
      },
      links: (raw.links || []).map(l => ({
        panoId:      l.pano,
        heading:     l.heading,
        description: l.description || '',
      })),
      copyright: raw.copyright || '',
      tiles: raw.tiles || null,
    };
  }

  /**
   * Build the Street View tile URL.
   * Uses the proxy server by default to avoid CORS restrictions.
   *
   * Tile URL template (Google's internal CBK service):
   *   https://cbk0.google.com/cbk?output=tile&panoid={panoId}&zoom={zoom}&x={x}&y={y}
   */
  _tileUrl(panoId, zoom, x, y) {
    // Route through proxy so the server attaches the API key and avoids browser CORS.
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
