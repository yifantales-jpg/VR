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

/* ─── On-page debug log ──────────────────────────────────────────────────── */

/**
 * Append a message to the always-visible #debug-log panel.
 * Works even when the main UI overlay is hidden or JS initialisation has failed.
 * @param {string} message
 * @param {'error'|'warn'|'info'} [type]
 */
function showDebug(message, type = 'error') {
  if (window._vrDebug) window._vrDebug.show(message, type);
}

// Forward console.error calls to the debug panel so A-Frame / library errors
// are visible on the page without requiring DevTools to be open.
(function mirrorConsoleError() {
  const orig = console.error.bind(console);
  console.error = function (...args) {
    orig(...args);
    const text = args
      .map(a => (a instanceof Error ? (a.stack || a.message) : String(a)))
      .join(' ');
    showDebug(text);
  };
}());

/* ─── Constants ─────────────────────────────────────────────────────────── */

const DEFAULT_TILE_ZOOM = 3;   // 8×4 tiles → 4096×2048 panorama

/* ─── State ─────────────────────────────────────────────────────────────── */

let streetViewService = null;
let currentPanoData   = null;
let isVRMode          = false;

/* ─── DOM references ─────────────────────────────────────────────────────── */

const $urlInput       = document.getElementById('url-input');
const $loadBtn        = document.getElementById('load-btn');
const $statusBar      = document.getElementById('status-bar');
const $uiOverlay      = document.getElementById('ui-overlay');
const $vrScene        = document.getElementById('vr-scene');
const $enterVRPanel   = document.getElementById('enter-vr-panel');
const $enterVRBtn     = document.getElementById('enter-vr-btn');
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
  $loadBtn.disabled    = loading;
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
    const parsed = StreetViewService.parseGoogleMapsUrl(trimmed);
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
    showDebug('Navigation error: ' + err.message);
  } finally {
    showVRLoadingIndicator(false);
  }
}

/**
 * Core panorama-loading routine:
 *  1. Stitch tiles onto the shared canvas.
 *  2. Apply canvas as VR sky texture.
 *  3. Build navigation arrows.
 *  4. Show the VR scene (first load only).
 *
 * @param {PanoramaData} panoData
 * @param {boolean}      showScene – transition from 2-D UI to 3-D scene.
 */
async function loadPanorama(panoData, showScene = true) {
  currentPanoData = panoData;
  const svc = getService();

  setStatus(`Stitching panorama tiles…`, 'info');

  let tilesLoaded = 0;
  const totalTiles = Math.pow(2, DEFAULT_TILE_ZOOM) * Math.pow(2, DEFAULT_TILE_ZOOM - 1);

  await svc.stitchPanorama(panoData.panoId, $panoramaCanvas, (loaded, total) => {
    tilesLoaded = loaded;
    const pct = Math.round((loaded / total) * 100);
    setStatus(`Loading tiles: ${pct}%`, 'info');
    if (isVRMode) showVRLoadingIndicator(true, `Loading ${pct}%`);
  });

  if (showScene) {
    transitionToVRScene();
  } else {
    // Already in scene – just refresh.
    applyPanoramaToScene(panoData);
  }

  clearStatus();
  showVRLoadingIndicator(false);

  console.info(`[VRStreetView] Loaded "${panoData.description}" (${panoData.panoId}), ${tilesLoaded} tiles`);
}

/* ─── Scene management ───────────────────────────────────────────────────── */

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

    // The enter-VR panel lives outside the UI overlay so it is still
    // reachable once the overlay is hidden.
    $enterVRPanel.classList.remove('hidden');

    isVRMode = true;
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

/** Load button and Enter key. */
$loadBtn.addEventListener('click', () => {
  showDebug('Load button clicked', 'info');
  loadFromUrl($urlInput.value);
});
$urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    showDebug('Enter key pressed in URL input', 'info');
    loadFromUrl($urlInput.value);
  }
});

/** Enter VR button (triggers A-Frame's VR mode). */
$enterVRBtn.addEventListener('click', () => {
  showDebug('Enter VR button clicked', 'info');
  const scene = document.getElementById('vr-scene');
  if (!scene) {
    showDebug('VR scene element not found');
    return;
  }

  if (!navigator.xr) {
    const msg =
      'WebXR is not available. Access this page over HTTPS or from localhost to use VR.';
    setStatus(msg, 'error');
    showDebug('WebXR not available (navigator.xr is undefined)');
    $uiOverlay.style.display = '';
    $uiOverlay.classList.remove('fade-out');
    return;
  }

  try {
    if (scene.is('vr-mode')) {
      scene.exitVR();
    } else {
      scene.enterVR();
    }
  } catch (err) {
    console.error('[VRStreetView] Enter VR error:', err);
    showDebug('Enter VR error: ' + err.message);
  }
});

/** Listen for A-Frame VR enter/exit events to update the UI. */
document.getElementById('vr-scene').addEventListener('enter-vr', () => {
  $enterVRBtn.textContent = '⬅ Exit VR';
});
document.getElementById('vr-scene').addEventListener('exit-vr', () => {
  $enterVRBtn.textContent = '🥽 Enter VR';
});

/** VR arrow navigation event (bubbled from nav-arrow component). */
document.getElementById('vr-scene').addEventListener('load-pano-by-id', (evt) => {
  const panoId = evt.detail && evt.detail.panoId;
  if (panoId) navigateToPano(panoId);
});

/* ─── Init ───────────────────────────────────────────────────────────────── */

(function init() {
  // ── Startup diagnostics ────────────────────────────────────────────────
  if (typeof StreetViewService === 'undefined') {
    showDebug('StreetViewService is not defined — street-view-service.js may not have loaded', 'warn');
  }
  if (typeof AFRAME === 'undefined') {
    showDebug('A-Frame is not defined — check network connectivity or content blocker', 'warn');
  }
  [
    'url-input', 'load-btn', 'status-bar', 'ui-overlay',
    'vr-scene', 'enter-vr-panel', 'enter-vr-btn', 'panorama-canvas',
  ].forEach(id => {
    if (!document.getElementById(id)) {
      showDebug('Required DOM element #' + id + ' was not found', 'warn');
    }
  });
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
