/**
 * app.js
 *
 * Main application logic for VR Street View.
 * Wires together the UI, StreetViewService, and the A-Frame scene.
 */

'use strict';

/* ─── Constants ─────────────────────────────────────────────────────────── */

const STORAGE_KEY_API  = 'vrstreetview_api_key';
const DEFAULT_TILE_ZOOM = 3;   // 8×4 tiles → 4096×2048 panorama

/* ─── State ─────────────────────────────────────────────────────────────── */

let streetViewService = null;
let currentPanoData   = null;
let isVRMode          = false;

/* ─── DOM references ─────────────────────────────────────────────────────── */

const $locationInput = document.getElementById('location-input');
const $searchBtn     = document.getElementById('search-btn');
const $statusBar     = document.getElementById('status-bar');
const $uiOverlay     = document.getElementById('ui-overlay');
const $vrScene       = document.getElementById('vr-scene');
const $enterVRPanel  = document.getElementById('enter-vr-panel');
const $enterVRBtn    = document.getElementById('enter-vr-btn');
const $apiKeyInput   = document.getElementById('api-key-input');
const $saveApiKey    = document.getElementById('save-api-key');
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
  $searchBtn.disabled   = loading;
  $searchBtn.textContent = loading ? 'Loading…' : 'Explore';
  if (loading) setStatus('Fetching panorama…', 'info');
}

/** Persist and return the currently saved API key. */
function getSavedApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEY_API, key);
}

/** Initialise (or re-initialise) the StreetViewService with the current API key. */
function initService() {
  const key = getSavedApiKey();
  streetViewService = new StreetViewService({
    apiKey:   key,
    proxyUrl: '/api',
    tileZoom: DEFAULT_TILE_ZOOM,
  });
  return streetViewService;
}

/* ─── Panorama loading ───────────────────────────────────────────────────── */

/**
 * Search for and load a Street View panorama by address / place query.
 * @param {string} query
 */
async function searchAndLoad(query) {
  if (!query.trim()) return;

  setLoading(true);
  clearStatus();

  try {
    const svc = initService();
    await svc.loadMapsAPI();

    setStatus('Geocoding location…', 'info');
    const panoData = await svc.findPanoramaByQuery(query);

    await loadPanorama(panoData);

  } catch (err) {
    console.error('[VRStreetView] Search error:', err);
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
    const svc = initService();
    const panoData = await svc.findPanoramaById(panoId);
    await loadPanorama(panoData, /* showScene= */ false);
  } catch (err) {
    console.error('[VRStreetView] Navigation error:', err);
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
  const svc = streetViewService;

  setStatus(`Stitching panorama tiles for "${panoData.description}"…`, 'info');

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
    $vrScene.classList.remove('hidden');
    $vrScene.style.display   = 'block';

    // Register components now that the scene is visible.
    registerSceneComponents();
    applyPanoramaToScene(currentPanoData);

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

/** Search button and Enter key. */
$searchBtn.addEventListener('click', () => searchAndLoad($locationInput.value));
$locationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchAndLoad($locationInput.value);
});

/** Quick-link buttons. */
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const location = btn.dataset.location;
    $locationInput.value = location;
    searchAndLoad(location);
  });
});

/** API key save. */
$saveApiKey.addEventListener('click', () => {
  const key = $apiKeyInput.value.trim();
  if (key) {
    saveApiKey(key);
    initService();
    $saveApiKey.textContent = 'Saved ✓';
    setTimeout(() => { $saveApiKey.textContent = 'Save Key'; }, 2000);
  }
});

/** Enter VR button (triggers A-Frame's VR mode). */
$enterVRBtn.addEventListener('click', () => {
  const scene = document.getElementById('vr-scene');
  if (scene && scene.xrSession) {
    scene.exitVR();
  } else if (scene) {
    scene.enterVR();
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
  // Pre-populate the API key input from localStorage.
  const savedKey = getSavedApiKey();
  if (savedKey) {
    $apiKeyInput.value = savedKey;
    initService();
  }

  // Focus the search field for quick keyboard entry.
  $locationInput.focus();

  console.info('[VRStreetView] App ready. Quest 3 WebXR mode supported.');
})();
