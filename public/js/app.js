/**
 * app.js
 *
 * Main application logic for VR Street View.
 * Wires together the UI, StreetViewService, and the A-Frame scene.
 *
 * Workflow:
 *  1. User pastes a Google Maps Street View URL into the input.
 *  2. StreetViewService.parseGoogleMapsUrl() extracts the panoId or lat/lng.
 *  3. fetchPanoData() fetches metadata via the server-side CBK proxy.
 *  4. stitchPanorama() fetches and stitches tiles onto the canvas.
 *  5. The canvas is applied as the A-Frame sky texture for VR viewing.
 */

'use strict';

/* ─── Constants ─────────────────────────────────────────────────────────── */

const DEFAULT_TILE_ZOOM       = 4;    // 16×8 tiles → 8192×4096 panorama (CBK Street View)
const PHOTO_SPHERE_WIDTH      = 8192; // fallback request width for Photo Sphere when native size is unknown
const PHOTO_SPHERE_HEIGHT     = 4096; // fallback request height (2:1 aspect ratio)

/* ─── State ─────────────────────────────────────────────────────────────── */

let streetViewService = null;
let currentPanoData   = null;
let isVRMode          = false;

/* ─── DOM references ─────────────────────────────────────────────────────── */

const $urlInput       = document.getElementById('url-input');
const $statusBar      = document.getElementById('status-bar');
const $uiOverlay      = document.getElementById('ui-overlay');
const $vrScene        = document.getElementById('vr-scene');
const $loadBtn        = document.getElementById('load-btn');
const $panoramaCanvas = document.getElementById('panorama-canvas');

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function setStatus(message, type = 'info') {
  $statusBar.textContent = message;
  $statusBar.className   = `status-${type}`;
  $statusBar.classList.remove('hidden');
}

function clearStatus() {
  $statusBar.classList.add('hidden');
  $statusBar.textContent = '';
}

function setLoading(loading) {
  $loadBtn.disabled = loading;
  $loadBtn.textContent = loading ? 'Loading…' : 'Load';
  if (loading) setStatus('Fetching panorama…', 'info');
}

/** Return (creating if needed) the shared StreetViewService instance. */
function getService() {
  if (!streetViewService) {
    streetViewService = new StreetViewService({
      proxyUrl: '/api',
      tileZoom: DEFAULT_TILE_ZOOM,
    });
  }
  return streetViewService;
}

/** Short URL services that can be resolved server-side before parsing. */
const SHORT_URL_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 't.co']);

/**
 * Attempt to resolve a URL via the server-side redirect-follower.
 * Only sends URLs from known short-link services to avoid unnecessary requests.
 * Returns the final (resolved) URL string, or null on failure.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function resolveShortUrl(url) {
  try {
    const parsed = new URL(url);
    if (!SHORT_URL_HOSTS.has(parsed.hostname)) return null;
  } catch {
    return null;
  }
  try {
    const res = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.url || null;
  } catch {
    return null;
  }
}

/* ─── Panorama loading ───────────────────────────────────────────────────── */

/**
 * Parse the pasted Google Maps URL and load the corresponding Street View panorama.
 * @param {string} input – Raw URL pasted by the user.
 */
async function loadFromUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return;

  setLoading(true);
  clearStatus();

  try {
    let urlToParse = trimmed;
    let parsed = StreetViewService.parseGoogleMapsUrl(urlToParse);

    // If direct parsing failed, try resolving URL redirects (e.g. short links
    // like maps.app.goo.gl or t.co) and parse the final destination URL.
    if (!parsed) {
      setStatus('Resolving URL…', 'info');
      const resolved = await resolveShortUrl(urlToParse);
      if (resolved && resolved !== urlToParse) {
        urlToParse = resolved;
        parsed = StreetViewService.parseGoogleMapsUrl(urlToParse);
      }
    }

    if (!parsed) {
      throw new Error(
        'Could not read location from that URL. Please paste a Google Maps Street View link.'
      );
    }

    const svc = getService();
    setStatus('Fetching panorama data…', 'info');
    const panoData = await svc.fetchPanoData(parsed);

    await loadPanorama(panoData);

  } catch (err) {
    console.error('[VRStreetView] Load error:', err);
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

/**
 * Load a panorama by its panoId (used when navigating via VR arrows).
 * @param {string} panoId
 */
async function navigateToPano(panoId) {
  try {
    showVRLoadingIndicator(true);
    const svc = getService();
    const panoData = await svc.fetchPanoData({ panoId });
    await loadPanorama(panoData, /* showScene= */ false);
  } catch (err) {
    console.error('[VRStreetView] Navigation error:', err);
  } finally {
    showVRLoadingIndicator(false);
  }
}

/**
 * Core panorama-loading routine:
 *  1. For standard Street View panos: stitch CBK tiles onto the shared canvas.
 *  2. For user-contributed Photo Spheres: fetch the equirectangular image directly.
 *  3. Apply canvas as VR sky texture.
 *  4. Build navigation arrows.
 *  5. Show the VR scene (first load only).
 *
 * @param {PanoramaData} panoData
 * @param {boolean}      showScene – transition from 2-D UI to 3-D scene.
 */
async function loadPanorama(panoData, showScene = true) {
  currentPanoData = panoData;
  const svc = getService();

  if (panoData.photoUrl) {
    // User-contributed Photo Sphere: load the equirectangular image directly.
    setStatus('Loading panorama image…', 'info');
    await loadPhotoSphereImage(panoData.photoUrl, panoData.photoWidth, panoData.photoHeight);
    console.info(`[VRStreetView] Loaded photo sphere (${panoData.panoId})`);
  } else {
    setStatus(`Stitching panorama tiles…`, 'info');

    let tilesLoaded = 0;
    const totalTiles = Math.pow(2, DEFAULT_TILE_ZOOM) * Math.pow(2, DEFAULT_TILE_ZOOM - 1);

    await svc.stitchPanorama(panoData.panoId, $panoramaCanvas, (loaded, total) => {
      tilesLoaded = loaded;
      const pct = Math.round((loaded / total) * 100);
      setStatus(`Loading tiles: ${pct}%`, 'info');
      if (isVRMode) showVRLoadingIndicator(true, `Loading ${pct}%`);
    });

    console.info(`[VRStreetView] Loaded "${panoData.description}" (${panoData.panoId}), ${tilesLoaded} tiles`);
  }

  if (showScene) {
    transitionToVRScene();
  } else {
    // Already in scene – just refresh.
    applyPanoramaToScene(panoData);
  }

  clearStatus();
  showVRLoadingIndicator(false);
}

/**
 * Load a user-contributed Photo Sphere by fetching its equirectangular image
 * via the /api/photo proxy and drawing it onto the shared canvas.
 *
 * The image is requested at its native resolution when `width` and `height`
 * are provided (extracted from the `!7i` / `!8i` segments of the Maps URL).
 * This ensures we never ask Google's image-serving for a size larger than the
 * source, which causes it to return an error.  When no native size is known,
 * the request falls back to `PHOTO_SPHERE_WIDTH × PHOTO_SPHERE_HEIGHT`.
 *
 * @param {string} photoUrl – Base Google Photos URL (without size parameters).
 * @param {number} [width]  – Native image width (optional; falls back to constant).
 * @param {number} [height] – Native image height (optional; falls back to constant).
 * @returns {Promise<void>}
 */
function loadPhotoSphereImage(photoUrl, width, height) {
  const reqWidth  = (width  > 0) ? width  : PHOTO_SPHERE_WIDTH;
  const reqHeight = (height > 0) ? height : PHOTO_SPHERE_HEIGHT;
  const proxyUrl  = `/api/photo?url=${encodeURIComponent(photoUrl + `=w${reqWidth}-h${reqHeight}-k-no`)}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      $panoramaCanvas.width  = img.naturalWidth  || reqWidth;
      $panoramaCanvas.height = img.naturalHeight || reqHeight;
      const ctx = $panoramaCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = () => {
      console.error('[VRStreetView] Photo sphere image failed to load:', proxyUrl);
      reject(new Error('Failed to load panorama image.'));
    };
    img.src = proxyUrl;
  });
}

/* ─── Scene management ───────────────────────────────────────────────────── */

/** Show the 2-D UI overlay so the user can paste a new URL. */
function showUIOverlay() {
  $uiOverlay.classList.remove('fade-out');
  $uiOverlay.style.display = '';
  isVRMode = false;
}

/** Swap from the 2-D search UI to the immersive A-Frame scene. */
function transitionToVRScene() {
  $uiOverlay.classList.add('fade-out');

  setTimeout(() => {
    $uiOverlay.style.display = 'none';

    // The a-scene is always in the DOM and already initialised; dispatch a
    // resize event so A-Frame/Three.js recomputes canvas dimensions now that
    // the overlay is gone.
    window.dispatchEvent(new Event('resize'));

    registerSceneComponents();
    applyPanoramaToScene(currentPanoData);

    isVRMode = true;

    // Automatically enter immersive VR mode once the panorama is ready.
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (!supported) return;
        const scene = document.getElementById('vr-scene');
        // Render the XR framebuffer at 1.5× the device-recommended resolution
        // for sharper output; must be called before the session is created.
        if (scene && scene.renderer && scene.renderer.xr) {
          scene.renderer.xr.setFramebufferScaleFactor(1.5);
        }
        try {
          if (scene && !scene.is('vr-mode')) scene.enterVR();
        } catch (err) {
          console.error('[VRStreetView] Auto enter VR error:', err);
        }
      }).catch((err) => {
        console.error('[VRStreetView] isSessionSupported error:', err);
      });
    }
  }, 400);
}

/**
 * Register A-Frame components on the scene (must happen after it is visible).
 * Guards against double-registration.
 */
function registerSceneComponents() {
  const scene = document.getElementById('vr-scene');
  if (!scene.components['street-view-scene']) {
    scene.setAttribute('street-view-scene', '');
  }
  if (!scene.components['loading-overlay']) {
    scene.setAttribute('loading-overlay', '');
  }
}

/** Apply panoData to the live A-Frame scene. */
function applyPanoramaToScene(panoData) {
  const scene = document.getElementById('vr-scene');
  if (!scene || !scene.components['street-view-scene']) return;

  scene.components['street-view-scene'].loadPanorama(
    panoData,
    $panoramaCanvas,
    /* heading= */ 0
  );
}

/** Show or hide the in-VR loading text. */
function showVRLoadingIndicator(show, message = 'Loading panorama…') {
  const scene = document.getElementById('vr-scene');
  if (!scene || !scene.components['loading-overlay']) return;

  if (show) {
    scene.components['loading-overlay'].show(message);
  } else {
    scene.components['loading-overlay'].hide();
  }
}

/* ─── Event wiring ───────────────────────────────────────────────────────── */

/** "Load" button: parse URL and fetch the panorama. */
$loadBtn.addEventListener('click', () => {
  const url = $urlInput.value.trim();
  if (!url) {
    setStatus('Paste a Google Maps Street View URL first.', 'error');
    return;
  }
  loadFromUrl(url);
});

$urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    loadFromUrl($urlInput.value);
  }
});

/** When the user exits VR (X button on controller, or any other means), return to the URL input UI. */
document.getElementById('vr-scene').addEventListener('exit-vr', () => {
  showUIOverlay();
});

/** VR arrow navigation event (bubbled from nav-arrow component). */
document.getElementById('vr-scene').addEventListener('load-pano-by-id', (evt) => {
  const panoId = evt.detail && evt.detail.panoId;
  if (panoId) navigateToPano(panoId);
});

/* ─── Init ───────────────────────────────────────────────────────────────── */

(function init() {
  // ── Startup checks (console only) ─────────────────────────────────────
  if (typeof StreetViewService === 'undefined') {
    console.warn('[VRStreetView] StreetViewService is not defined — street-view-service.js may not have loaded');
  }
  if (typeof AFRAME === 'undefined') {
    console.warn('[VRStreetView] A-Frame is not defined — check network connectivity or content blocker');
  }
  // ──────────────────────────────────────────────────────────────────────

  // Auto-load from URL fragment if launched from Android with a Maps URL:
  // e.g. http://localhost:3000/#mapsurl=https%3A%2F%2Fwww.google.com%2Fmaps%2F...
  const fragment = window.location.hash;
  if (fragment) {
    const params = new URLSearchParams(fragment.slice(1));
    const mapsUrl = params.get('mapsurl');
    if (mapsUrl) {
      $urlInput.value = mapsUrl;
      loadFromUrl(mapsUrl);
      return;
    }
  }

  // Focus the URL input for quick paste.
  $urlInput.focus();

  console.info('[VRStreetView] App ready. Paste a Google Maps Street View URL to begin.');
})();
