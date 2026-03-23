/**
 * panorama-components.js
 *
 * Custom A-Frame components for the VR Street View experience:
 *
 *  panorama-texture  – Updates the <a-sky> canvas texture on demand.
 *  nav-arrow         – 3-D direction arrow that navigates to an adjacent panorama.
 *  street-view-scene – Top-level scene component wiring navigation arrows together.
 */

'use strict';

/* ─── panorama-texture ───────────────────────────────────────────────────── */

/**
 * Signals the <a-sky> to refresh its texture from the shared canvas element.
 * Call `el.components['panorama-texture'].refresh()` after painting the canvas.
 */
AFRAME.registerComponent('panorama-texture', {
  schema: {
    canvasId: { type: 'string', default: 'panorama-canvas' },
  },

  init() {
    this._canvas = document.getElementById(this.data.canvasId);
    if (!this._canvas) {
      console.warn('[panorama-texture] Canvas not found:', this.data.canvasId);
    }
  },

  /** Force the material to pick up changes painted onto the canvas. */
  refresh() {
    const mesh = this.el.getObject3D('mesh');
    if (mesh && mesh.material && mesh.material.map) {
      mesh.material.map.needsUpdate = true;
    }
  },
});

/* ─── nav-arrow ─────────────────────────────────────────────────────────── */

/**
 * Renders a navigational arrow on the ground plane that the user can gaze at
 * (or point a controller at) to travel to the adjacent panorama.
 *
 * Properties:
 *   heading    – compass bearing toward the linked panorama (degrees, 0 = north).
 *   panoId     – panorama ID to load on activation.
 *   label      – optional text label shown above the arrow.
 *   distance   – radius from origin to place the arrow (metres).
 */
AFRAME.registerComponent('nav-arrow', {
  schema: {
    heading:  { type: 'number',  default: 0 },
    panoId:   { type: 'string',  default: '' },
    label:    { type: 'string',  default: '' },
    distance: { type: 'number',  default: 4 },
  },

  init() {
    const d    = this.data;
    const el   = this.el;
    const rad  = THREE.MathUtils.degToRad(d.heading);

    // Position on ground plane, rotated to the correct compass bearing.
    const x = Math.sin(rad) * d.distance;
    const z = -Math.cos(rad) * d.distance;
    el.setAttribute('position', { x, y: 0.01, z });
    el.setAttribute('rotation', { x: 0, y: -d.heading, z: 0 });

    // Arrow disc
    const disc = document.createElement('a-entity');
    disc.setAttribute('geometry', 'primitive: circle; radius: 0.35; segments: 32');
    disc.setAttribute('material', 'color: #4fc3f7; opacity: 0.8; shader: flat; side: double');
    disc.setAttribute('rotation', '-90 0 0');
    el.appendChild(disc);

    // Arrow chevron (triangle pointing forward / north in local space)
    const chevron = document.createElement('a-entity');
    chevron.setAttribute('geometry', 'primitive: triangle; vertexA: 0 0.28 0; vertexB: -0.18 -0.14 0; vertexC: 0.18 -0.14 0');
    chevron.setAttribute('material', 'color: #ffffff; shader: flat; side: double');
    chevron.setAttribute('rotation', '-90 0 0');
    chevron.setAttribute('position', '0 0.002 0');
    el.appendChild(chevron);

    // Text label (slightly above the disc)
    if (d.label) {
      const text = document.createElement('a-text');
      text.setAttribute('value', d.label);
      text.setAttribute('align', 'center');
      text.setAttribute('color', '#ffffff');
      text.setAttribute('position', '0 0.6 0');
      text.setAttribute('scale', '0.6 0.6 0.6');
      text.setAttribute('look-at', '[camera]');
      el.appendChild(text);
    }

    // Hover / gaze animations
    el.addEventListener('mouseenter', () => {
      disc.setAttribute('material', 'color: #81d4fa; opacity: 1; shader: flat; side: double');
      el.setAttribute('animation', 'property: scale; to: 1.2 1.2 1.2; dur: 150; easing: easeOutQuad');
    });
    el.addEventListener('mouseleave', () => {
      disc.setAttribute('material', 'color: #4fc3f7; opacity: 0.8; shader: flat; side: double');
      el.setAttribute('animation', 'property: scale; to: 1 1 1; dur: 150; easing: easeOutQuad');
    });

    // Navigate on click or after gaze fuse
    el.addEventListener('click', () => {
      if (d.panoId) {
        el.emit('navigate', { panoId: d.panoId });
      }
    });
  },
});

/* ─── street-view-scene ─────────────────────────────────────────────────── */

/**
 * Top-level component attached to <a-scene>.
 * Listens for 'navigate' events bubbled from nav-arrows and loads the new panorama.
 *
 * It also exposes:
 *   el.components['street-view-scene'].loadPanorama(panoData, canvas, onProgress)
 */
AFRAME.registerComponent('street-view-scene', {
  init() {
    // Sequence counter for reverse-geocoding requests: incremented with each
    // panorama load so that stale responses from a previous pano are discarded.
    this._geocodeSeq = 0;

    // Listen for navigation events from arrows.
    this.el.addEventListener('navigate', (evt) => {
      const panoId = evt.detail && evt.detail.panoId;
      if (panoId) {
        this.el.emit('load-pano-by-id', { panoId });
      }
    });
  },

  /**
   * Update the VR scene with new panorama data.
   * @param {PanoramaData}   panoData  – Normalised panorama metadata.
   * @param {HTMLCanvasElement} canvas – Already-painted panorama canvas.
   * @param {number}         heading   – Initial look-at heading (degrees).
   */
  loadPanorama(panoData, canvas, heading = 0) {
    // Refresh the sky texture.
    const sky = this.el.querySelector('#panorama-sky');
    if (sky) {
      const applyTexture = () => {
        const mesh = sky.getObject3D('mesh');
        if (!mesh) return; // mesh not yet ready; will be applied via 'loaded' event
        const map = new THREE.CanvasTexture(canvas);
        // Three.js r152+ deprecated texture.encoding in favour of texture.colorSpace.
        // Use SRGBColorSpace (replaces sRGBEncoding) to match A-Frame 1.5.0's own
        // renderer color-management pipeline (renderer.outputColorSpace = SRGBColorSpace).
        map.colorSpace    = THREE.SRGBColorSpace;
        // Bilinear filtering without mipmaps: the GPU always samples from the
        // full-resolution panorama texture.  Trilinear + mipmaps can select an
        // overly-blurred mip level for the sky sphere, reducing apparent sharpness.
        map.minFilter     = THREE.LinearFilter;
        map.generateMipmaps = false;
        const renderer = this.el.sceneEl && this.el.sceneEl.renderer;
        if (renderer) {
          map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
        mesh.material.map = map;
        mesh.material.needsUpdate = true;
      };

      if (sky.getObject3D('mesh')) {
        applyTexture();
      } else {
        // Mesh not ready yet (scene just became visible); wait for A-Frame to finish.
        sky.addEventListener('loaded', applyTexture, { once: true });
      }

      // Rotate so the street faces the viewer's initial direction.
      sky.setAttribute('rotation', { x: 0, y: -(heading + 90), z: 0 });
    }

    // Update the in-VR location label and store coordinates for AI requests.
    const label = this.el.querySelector('#location-text');
    if (label) {
      // Always update the description so stale text from a previous panorama
      // is cleared when the new one has no description.
      label.setAttribute('value', panoData.description || '');

      if (panoData.latLng && typeof panoData.latLng.lat === 'number' && typeof panoData.latLng.lng === 'number' &&
          (panoData.latLng.lat !== 0 || panoData.latLng.lng !== 0)) {
        label.dataset.lat = String(panoData.latLng.lat);
        label.dataset.lng = String(panoData.latLng.lng);

        // Reverse-geocode coordinates to a human-readable address so the AI
        // receives a precise street/city name rather than just raw GPS numbers.
        // The sequence counter guards against stale responses when the user
        // navigates to a new panorama before geocoding completes.
        this._geocodeSeq = (this._geocodeSeq || 0) + 1;
        const seq = this._geocodeSeq;
        const { lat, lng } = panoData.latLng;
        fetch(`/api/geocode?lat=${lat}&lng=${lng}`)
          .then((r) => r.json())
          .then((data) => {
            if (data.address && this._geocodeSeq === seq) {
              label.setAttribute('value', data.address);
            }
          })
          .catch(() => {}); // geocoding is best-effort; fail silently
      } else {
        delete label.dataset.lat;
        delete label.dataset.lng;
      }
    }

    // Rebuild navigation arrows.
    this._rebuildNavArrows(panoData.links || []);
  },

  /** Remove old nav arrows and create new ones for the current panorama. */
  _rebuildNavArrows(links) {
    const container = this.el.querySelector('#nav-links');
    if (!container) return;

    // Remove existing arrows.
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    links.forEach(link => {
      const arrow = document.createElement('a-entity');
      arrow.setAttribute('class', 'nav-arrow');
      arrow.setAttribute('nav-arrow', {
        heading:  link.heading,
        panoId:   link.panoId,
        label:    link.description,
        distance: 4,
      });
      container.appendChild(arrow);
    });
  },
});

/* ─── loading-overlay ───────────────────────────────────────────────────── */

/**
 * Shows / hides a VR loading indicator while tiles are fetching.
 * Usage: AFRAME.scenes[0].components['loading-overlay'].show('Loading…')
 *        AFRAME.scenes[0].components['loading-overlay'].hide()
 */
AFRAME.registerComponent('loading-overlay', {
  init() {
    this._el = this.el.querySelector('#vr-loading');
  },

  show(message = 'Loading panorama…') {
    if (this._el) {
      this._el.setAttribute('visible', true);
      const text = this._el.querySelector('a-text');
      if (text) text.setAttribute('value', message);
    }
  },

  hide() {
    if (this._el) this._el.setAttribute('visible', false);
  },
});

/* ─── vr-controller-input ───────────────────────────────────────────────── */

/**
 * Handles Quest controller input while in VR:
 *   - Left / right thumbstick left / right → rotate camera rig in discrete steps.
 *   - Left / right thumbstick up           → zoom in (canvas-based zoom plane).
 *   - Left / right thumbstick down         → zoom out / reset to default.
 *   - B button (right hand)                → request AI facts about the current view;
 *                                            tap again to dismiss (copies text to clipboard).
 *   - X button (left hand)                 → exit VR.
 *
 * Attach to the #camera-rig entity: <a-entity vr-controller-input …>
 */
AFRAME.registerComponent('vr-controller-input', {
  schema: {
    turnStep:    { type: 'number', default: 45  },  // degrees per lateral step
    turnCooldown:{ type: 'number', default: 350 },  // ms between turns
    deadzone:    { type: 'number', default: 0.5 },  // thumbstick axis threshold
  },

  init() {
    this._lastTurn    = 0;
    this._factsActive = false;

    // Stepped zoom state: a canvas plane in front of the camera shows a
    // cropped portion of the panorama texture — smaller crop = more zoom.
    this._zoomSteps      = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35];
    this._zoomLevel      = 0;        // index into _zoomSteps (0 = no zoom)
    this._zoomAxisNeutral = true;    // true when y-axis was last in the deadzone
    this._zoomCanvas     = null;     // off-screen canvas for zoom texture
    this._zoomTexture    = null;     // THREE.CanvasTexture wrapping _zoomCanvas
    this._zoomPlaneEl    = null;     // a-plane covering the camera FOV

    // Facts-panel scroll state.
    this._factsLines       = [];   // all wrapped lines of the current AI response
    this._factsScrollLine  = 0;    // index of the first visible line
    this._factsMaxVisible  = 12;   // how many lines fit in the panel
    this._lastFactsScroll  = 0;    // cooldown timestamp for scroll steps

    this._panoramaCanvas = document.getElementById('panorama-canvas');

    // Off-screen canvas used for AI facts snapshot.
    this._snapshotCanvas        = document.createElement('canvas');
    this._snapshotCanvas.width  = 512;
    this._snapshotCanvas.height = 512;

    // Off-screen canvas used for markdown-formatted facts text rendering.
    this._factsCanvas        = document.createElement('canvas');
    this._factsCanvas.width  = 1024;
    this._factsCanvas.height = 512;
    this._factsTexture       = null;

    // Cache frequently-accessed DOM elements to avoid per-frame queries.
    this._cameraEl   = this.el.querySelector('[camera]');
    this._skyEl      = document.getElementById('panorama-sky');
    this._gazeCursor = document.getElementById('gaze-cursor');

    // Pre-allocate THREE objects reused every tick to avoid per-frame GC pressure.
    this._worldDir  = new THREE.Vector3();
    this._worldQuat = new THREE.Quaternion();
    this._camWorldPos    = new THREE.Vector3();
    this._cursorWorldPos = new THREE.Vector3();

    this._onThumbstick = this._onThumbstick.bind(this);
    this._onXButton    = this._onXButton.bind(this);
    this._onBButton    = this._onBButton.bind(this);

    this._leftHand  = document.getElementById('left-hand');
    this._rightHand = document.getElementById('right-hand');

    if (this._leftHand) {
      this._leftHand.addEventListener('thumbstickmoved', this._onThumbstick);
      this._leftHand.addEventListener('xbuttondown',    this._onXButton);
    }
    if (this._rightHand) {
      this._rightHand.addEventListener('thumbstickmoved', this._onThumbstick);
      this._rightHand.addEventListener('bbuttondown',    this._onBButton);
    }

    this._setupFactsFrame();
    this._setupZoomPlane();
  },

  /**
   * Create a floating panel that shows AI facts about the current view.
   * Uses a canvas texture on an a-plane for markdown-formatted rendering.
   * Also parented to the camera entity so it tracks head movement.
   */
  _setupFactsFrame() {
    const camera = this._cameraEl;
    if (!camera) return;

    this._factsFrameEl = document.createElement('a-entity');
    this._factsFrameEl.setAttribute('position', '0 -0.18 -0.7');
    this._factsFrameEl.setAttribute('visible', false);

    // A-plane displaying the markdown-formatted canvas texture.
    // No background panel — text has its own outline border drawn on canvas.
    this._factsPlaneEl = document.createElement('a-plane');
    this._factsPlaneEl.setAttribute('width',    '0.60');
    this._factsPlaneEl.setAttribute('height',   '0.30');
    this._factsPlaneEl.setAttribute('position', '0 0 0.001');
    this._factsPlaneEl.setAttribute('material', 'shader: flat; transparent: true; side: front');
    this._factsFrameEl.appendChild(this._factsPlaneEl);

    // Loading bar – a thin horizontal plane pulsing while AI facts load.
    this._loadingBarEl = document.createElement('a-plane');
    this._loadingBarEl.setAttribute('width',    '0.30');
    this._loadingBarEl.setAttribute('height',   '0.004');
    this._loadingBarEl.setAttribute('position', '0 0 0.002');
    this._loadingBarEl.setAttribute('material', 'shader: flat; color: #4fc3f7; opacity: 0.9; transparent: true');
    this._loadingBarEl.setAttribute('visible',  false);
    this._factsFrameEl.appendChild(this._loadingBarEl);

    camera.appendChild(this._factsFrameEl);

    // Attach the canvas as a Three.js texture once the mesh is ready.
    if (this._factsPlaneEl.getObject3D) {
      const self = this;
      const applyTexture = () => {
        const mesh = self._factsPlaneEl && self._factsPlaneEl.getObject3D &&
                     self._factsPlaneEl.getObject3D('mesh');
        if (!mesh) return;
        self._factsTexture = new THREE.CanvasTexture(self._factsCanvas);
        mesh.material.map = self._factsTexture;
        mesh.material.needsUpdate = true;
      };
      if (this._factsPlaneEl.getObject3D('mesh')) {
        applyTexture();
      } else if (this._factsPlaneEl.addEventListener) {
        this._factsPlaneEl.addEventListener('loaded', applyTexture, { once: true });
      }
    }
  },

  /**
   * Create a large a-plane attached to the camera that fills the user's FOV.
   * When zoomed in, it displays a cropped region of the panorama texture,
   * producing a canvas-based digital zoom effect that works in WebXR.
   */
  _setupZoomPlane() {
    const camera = this._cameraEl;
    if (!camera) return;

    this._zoomCanvas        = document.createElement('canvas');
    this._zoomCanvas.width  = 512;
    this._zoomCanvas.height = 512;

    // A 2 m × 2 m plane at 0.5 m covers ~127° — enough for Quest 3's FOV.
    this._zoomPlaneEl = document.createElement('a-plane');
    this._zoomPlaneEl.setAttribute('width',    '2');
    this._zoomPlaneEl.setAttribute('height',   '2');
    this._zoomPlaneEl.setAttribute('position', '0 0 -0.5');
    this._zoomPlaneEl.setAttribute('material', 'shader: flat; transparent: false; side: front');
    this._zoomPlaneEl.setAttribute('visible',  false);
    camera.appendChild(this._zoomPlaneEl);

    if (this._zoomPlaneEl.getObject3D) {
      const self = this;
      const applyTexture = () => {
        const mesh = self._zoomPlaneEl && self._zoomPlaneEl.getObject3D &&
                     self._zoomPlaneEl.getObject3D('mesh');
        if (!mesh) return;
        self._zoomTexture = new THREE.CanvasTexture(self._zoomCanvas);
        mesh.material.map = self._zoomTexture;
        mesh.material.needsUpdate = true;
      };
      if (this._zoomPlaneEl.getObject3D('mesh')) {
        applyTexture();
      } else if (this._zoomPlaneEl.addEventListener) {
        this._zoomPlaneEl.addEventListener('loaded', applyTexture, { once: true });
      }
    }
  },

  /**
   * Sample a cropped region of the equirectangular panorama centred on the
   * camera's look direction and paint it onto _zoomCanvas.
   * The crop size is determined by the current zoom level: a smaller crop
   * produces a higher zoom factor when stretched to fill the plane.
   */
  _updateZoomCanvas() {
    const camera = this._cameraEl;
    if (!camera || !this._panoramaCanvas || !this._zoomCanvas) return;

    const cameraObj = camera.object3D;
    if (!cameraObj) return;

    // Derive the camera look direction from its world quaternion.
    // This is the most reliable method during tick() updates since the
    // camera's world transform is always current with the WebXR head pose.
    this._worldDir.set(0, 0, -1);
    this._worldDir.applyQuaternion(cameraObj.getWorldQuaternion(this._worldQuat));
    const worldDir = this._worldDir;

    let skyYRad = 0;
    if (this._skyEl && this._skyEl.object3D) {
      skyYRad = this._skyEl.object3D.rotation.y || 0;
    }

    const cosA = Math.cos(skyYRad);
    const sinA = Math.sin(skyYRad);
    const texX = worldDir.x * cosA - worldDir.z * sinA;
    const texZ = worldDir.x * sinA + worldDir.z * cosA;
    const texY = worldDir.y;

    const azimuth   = Math.atan2(texZ, -texX);
    const elevation = Math.asin(Math.max(-1, Math.min(1, texY)));
    const u = ((azimuth / (Math.PI * 2)) + 1) % 1;
    const v = 0.5 - elevation / Math.PI;

    const panoW = this._panoramaCanvas.width;
    const panoH = this._panoramaCanvas.height;
    // Crop width: panoW/4 at zoom level 1 gives ~90° (matches typical HMD FOV),
    // scaled by the zoom step → levels 1/2/3 (steps 0.7/0.5/0.35) give 1.4×/2×/2.9×.
    const side = Math.floor(panoW / 4 * this._zoomSteps[this._zoomLevel]);
    const srcW = side;
    const srcH = side;
    const srcX = u * panoW - srcW / 2;
    const srcY = Math.max(0, Math.min(panoH - srcH, v * panoH - srcH / 2));

    const ctx  = this._zoomCanvas.getContext('2d');
    const dstW = this._zoomCanvas.width;
    const dstH = this._zoomCanvas.height;
    ctx.clearRect(0, 0, dstW, dstH);

    // Flip horizontally: inside-sphere mapping mirrors left ↔ right.
    ctx.save();
    ctx.translate(dstW, 0);
    ctx.scale(-1, 1);

    if (srcX < 0) {
      const wW = -srcX;
      const rW = srcW - wW;
      ctx.drawImage(this._panoramaCanvas, panoW + srcX, srcY, wW, srcH,
        0, 0, (wW / srcW) * dstW, dstH);
      ctx.drawImage(this._panoramaCanvas, 0, srcY, rW, srcH,
        (wW / srcW) * dstW, 0, (rW / srcW) * dstW, dstH);
    } else if (srcX + srcW > panoW) {
      const lW = panoW - srcX;
      const rW = srcW - lW;
      ctx.drawImage(this._panoramaCanvas, srcX, srcY, lW, srcH,
        0, 0, (lW / srcW) * dstW, dstH);
      ctx.drawImage(this._panoramaCanvas, 0, srcY, rW, srcH,
        (lW / srcW) * dstW, 0, (rW / srcW) * dstW, dstH);
    } else {
      ctx.drawImage(this._panoramaCanvas, srcX, srcY, srcW, srcH,
        0, 0, dstW, dstH);
    }

    ctx.restore();
    if (this._zoomTexture) this._zoomTexture.needsUpdate = true;
  },

  remove() {
    if (this._leftHand) {
      this._leftHand.removeEventListener('thumbstickmoved', this._onThumbstick);
      this._leftHand.removeEventListener('xbuttondown',    this._onXButton);
    }
    if (this._rightHand) {
      this._rightHand.removeEventListener('thumbstickmoved', this._onThumbstick);
      this._rightHand.removeEventListener('bbuttondown',    this._onBButton);
    }
    if (this._factsFrameEl && this._factsFrameEl.parentNode) {
      this._factsFrameEl.parentNode.removeChild(this._factsFrameEl);
    }
    if (this._zoomPlaneEl && this._zoomPlaneEl.parentNode) {
      this._zoomPlaneEl.parentNode.removeChild(this._zoomPlaneEl);
    }
  },

  tick() {
    if (this._zoomLevel > 0) {
      this._updateZoomCanvas();
    }
  },

  _onThumbstick(evt) {
    const now      = Date.now();
    const { x, y } = evt.detail;
    const dz       = this.data.deadzone;

    // ── Left / Right → stepped yaw rotation (both controllers) ───────────
    if (Math.abs(x) >= dz && now - this._lastTurn >= this.data.turnCooldown) {
      const rotation = this.el.getAttribute('rotation');
      // Positive x = thumbstick right → turn right (decrease y-rotation)
      const step = x > 0 ? -this.data.turnStep : this.data.turnStep;
      this.el.setAttribute('rotation', {
        x: rotation.x,
        y: rotation.y + step,
        z: rotation.z,
      });
      this._lastTurn = now;
    }

    // ── Up / Down on left stick while facts panel is open → scroll ────────
    if (evt.target === this._leftHand && this._factsActive) {
      if (Math.abs(y) >= dz && now - this._lastFactsScroll >= this.data.turnCooldown) {
        if (y < -dz) {
          // Stick up → scroll text down (show later lines)
          this._scrollFacts(3);
        } else {
          // Stick down → scroll text up (show earlier lines)
          this._scrollFacts(-3);
        }
        this._lastFactsScroll = now;
      }
      return; // don't step zoom while facts panel is open
    }

    // ── Up / Down → stepped zoom (both controllers) ──────────────────────
    // Edge-triggered: require the stick to return to the deadzone between steps
    // so each physical push of the thumbstick advances exactly one zoom level.
    if (Math.abs(y) < dz) {
      this._zoomAxisNeutral = true;
    } else if (this._zoomAxisNeutral) {
      this._zoomAxisNeutral = false;
      if (y < -dz) {
        // Stick up → step closer
        this._stepCloser();
      } else {
        // Stick down → step farther (one level at a time)
        this._stepFarther();
      }
    }
  },

  /** Zoom in one step by showing a smaller crop of the panorama. */
  _stepCloser() {
    if (this._zoomLevel < this._zoomSteps.length - 1) {
      this._zoomLevel++;
      this._applyZoom();
    }
  },

  /** Zoom out one step toward the default (no zoom) view. */
  _stepFarther() {
    if (this._zoomLevel > 0) {
      this._zoomLevel--;
      this._applyZoom();
    }
  },

  /** Reset to the default (no zoom) view immediately. */
  _resetZoom() {
    if (this._zoomLevel !== 0) {
      this._zoomLevel = 0;
      this._applyZoom();
    }
  },

  /**
   * Show or hide the zoom plane based on the current zoom level.
   * The plane's texture is updated every tick via _updateZoomCanvas().
   */
  _applyZoom() {
    if (!this._zoomPlaneEl) return;
    if (this._zoomLevel === 0) {
      this._zoomPlaneEl.setAttribute('visible', false);
    } else {
      this._updateZoomCanvas();
      this._zoomPlaneEl.setAttribute('visible', true);
    }
  },

  /**
   * Sample a crop of the equirectangular panorama centred on the camera's
   * world-space look direction and paint it onto _snapshotCanvas.
   * Used internally for AI-facts image capture.
   */
  _updateSnapshotCanvas() {
    const camera = this._cameraEl;
    if (!camera || !this._panoramaCanvas || !this._snapshotCanvas) return;

    const cameraObj = camera.object3D;
    if (!cameraObj) return;

    // Use the gaze-cursor world position to compute the actual look direction.
    // The cursor sits at (0,0,-0.75) in camera-local space; its world position
    // reflects the full WebXR head-tracking transform, so the crop stays
    // aligned with the true centre of the user's view.
    let worldDir;
    const cursor = this._gazeCursor && this._gazeCursor.object3D;
    if (cursor && typeof cursor.getWorldPosition === 'function') {
      cursor.getWorldPosition(this._cursorWorldPos);
      cameraObj.getWorldPosition(this._camWorldPos);
      this._worldDir.copy(this._cursorWorldPos).sub(this._camWorldPos).normalize();
      worldDir = this._worldDir;
    } else {
      // Fallback: derive direction from camera quaternion.
      this._worldDir.set(0, 0, -1);
      this._worldDir.applyQuaternion(cameraObj.getWorldQuaternion(this._worldQuat));
      worldDir = this._worldDir;
    }

    // Read the sky's actual Object3D Y-rotation (radians) so the crop uses
    // the exact same transform that Three.js applies when rendering the sphere.
    let skyYRad = 0;
    if (this._skyEl && this._skyEl.object3D) {
      skyYRad = this._skyEl.object3D.rotation.y || 0;
    }

    // Rotate direction by the inverse of the sky's Y rotation to get the
    // direction in the equirectangular texture's coordinate frame.
    // The inverse of R_y(skyYRad) is R_y(-skyYRad), whose matrix elements
    // use cos(skyYRad) and -sin(skyYRad) — note the sign is the OPPOSITE of
    // the forward rotation.
    const cosA = Math.cos(skyYRad);
    const sinA = Math.sin(skyYRad);
    const texX = worldDir.x * cosA - worldDir.z * sinA;
    const texZ = worldDir.x * sinA + worldDir.z * cosA;
    const texY = worldDir.y;

    // Map to equirectangular UV [0,1]×[0,1].
    // Three.js SphereGeometry places u=0 at local -X (phi=0) and increases
    // phi = atan2(z, -x), so azimuth must be computed from (texZ, -texX).
    const azimuth   = Math.atan2(texZ, -texX);                       // [-π, π]
    const elevation = Math.asin(Math.max(-1, Math.min(1, texY)));
    const u = ((azimuth / (Math.PI * 2)) + 1) % 1;
    const v = 0.5 - elevation / Math.PI;

    // Crop region: square in angular space → no aspect-ratio distortion when
    // displayed in the square zoom window.  panoW/16 pixels ≈ 22.5°, giving
    // roughly 3-4× visual zoom at the 0.5 m window distance.
    const panoW = this._panoramaCanvas.width;
    const panoH = this._panoramaCanvas.height;
    const side  = Math.floor(panoW / 16);   // equal angular size in both axes
    const srcW  = side;
    const srcH  = side;
    const srcX  = u * panoW - srcW / 2;
    // Clamp vertically (no vertical wrap on equirectangular).
    const srcY  = Math.max(0, Math.min(panoH - srcH, v * panoH - srcH / 2));

    const ctx  = this._snapshotCanvas.getContext('2d');
    const dstW = this._snapshotCanvas.width;
    const dstH = this._snapshotCanvas.height;
    ctx.clearRect(0, 0, dstW, dstH);

    // Flip horizontally: the equirectangular texture is mapped to the inside
    // of the sky sphere, so the flat-image crop is left–right mirrored
    // relative to what the user sees in VR.
    ctx.save();
    ctx.translate(dstW, 0);
    ctx.scale(-1, 1);

    // Handle horizontal wrap at the ±180° seam.
    if (srcX < 0) {
      const wW = -srcX;
      const rW = srcW - wW;
      ctx.drawImage(this._panoramaCanvas, panoW + srcX, srcY, wW, srcH,
        0, 0, (wW / srcW) * dstW, dstH);
      ctx.drawImage(this._panoramaCanvas, 0, srcY, rW, srcH,
        (wW / srcW) * dstW, 0, (rW / srcW) * dstW, dstH);
    } else if (srcX + srcW > panoW) {
      const lW = panoW - srcX;
      const rW = srcW - lW;
      ctx.drawImage(this._panoramaCanvas, srcX, srcY, lW, srcH,
        0, 0, (lW / srcW) * dstW, dstH);
      ctx.drawImage(this._panoramaCanvas, 0, srcY, rW, srcH,
        (lW / srcW) * dstW, 0, (rW / srcW) * dstW, dstH);
    } else {
      ctx.drawImage(this._panoramaCanvas, srcX, srcY, srcW, srcH,
        0, 0, dstW, dstH);
    }

    ctx.restore();
  },

  // ── B button (right hand): AI facts window ───────────────────────────────

  _onBButton() {
    if (this._factsActive) {
      this._copyFactsToClipboard();
      this._hideFactsFrame();
      return;
    }
    this._factsActive = true;
    this._showFactsFrame();
    this._fetchAIFacts();
  },

  _showFactsFrame(text) {
    if (!this._factsFrameEl) return;
    if (text) {
      this._updateFactsText(text);
      this._hideLoadingBar();
    } else {
      // Clear previous text when showing the loading bar.
      this._factsLines      = [];
      this._factsScrollLine = 0;
      this._clearFactsCanvas();
      this._showLoadingBar();
    }
    // Remove any lingering hide/show animations before restarting so the
    // show animation always fires even when the panel was previously closed.
    this._factsFrameEl.removeAttribute('animation__hide');
    this._factsFrameEl.removeAttribute('animation__show');
    this._factsFrameEl.setAttribute('scale', '0.01 0.01 0.01');
    this._factsFrameEl.setAttribute('visible', true);
    this._factsFrameEl.setAttribute('animation__show',
      'property: scale; from: 0.01 0.01 0.01; to: 1 1 1; dur: 250; easing: easeOutBack');
  },

  _hideFactsFrame() {
    this._factsActive = false;
    this._factsLines      = [];
    this._factsScrollLine = 0;
    this._hideLoadingBar();
    if (!this._factsFrameEl) return;
    this._factsFrameEl.setAttribute('animation__hide',
      'property: scale; from: 1 1 1; to: 0.01 0.01 0.01; dur: 200; easing: easeInBack');
    const frameEl = this._factsFrameEl;
    setTimeout(() => { if (frameEl) frameEl.setAttribute('visible', false); }, 220);
  },

  _showLoadingBar() {
    if (!this._loadingBarEl) return;
    this._loadingBarEl.setAttribute('visible', true);
    this._loadingBarEl.setAttribute('animation__pulse',
      'property: scale; from: 0.3 1 1; to: 1 1 1; dur: 1600; loop: true; dir: alternate; easing: easeInOutQuad');
  },

  _hideLoadingBar() {
    if (!this._loadingBarEl) return;
    this._loadingBarEl.removeAttribute('animation__pulse');
    this._loadingBarEl.setAttribute('visible', false);
  },

  /**
   * Copy the current facts text to the system clipboard, if available.
   */
  _copyFactsToClipboard() {
    const text = this._factsLines.map(l => (l && l.text != null) ? l.text : '').join('\n');
    if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  },

  /**
   * Clear the facts canvas (transparent) and update the texture.
   */
  _clearFactsCanvas() {
    if (!this._factsCanvas) return;
    const ctx = this._factsCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, this._factsCanvas.width, this._factsCanvas.height);
    if (this._factsTexture) this._factsTexture.needsUpdate = true;
  },

  /**
   * Parse markdown text into structured, word-wrapped lines.
   *
   * Returns an array of line objects:
   *   { text: string, type: 'heading'|'bullet'|'ordered'|'text'|'blank'|'rule',
   *     headingLevel?: number }
   *
   * The `text` field retains inline markdown markers (**bold**, *italic*,
   * `code`) so the canvas renderer can apply proper fonts.
   *
   * @param {string} text     – Raw markdown text.
   * @param {number} maxChars – Max visible characters per line for wrapping.
   * @returns {Array<Object>}
   */
  _formatMarkdown(text, maxChars) {
    // When the facts canvas is available, use pixel-based line widths so the
    // text fills the panel properly for any language (including CJK scripts
    // whose characters do not delimit words with spaces).
    const ctx = this._factsCanvas ? this._factsCanvas.getContext('2d') : null;
    const PAD_X            = 32;
    const FONT_SIZE        = 24;
    const HEADING_FONT_SIZE = 28;
    // Pixel width of the usable text area, or char-count fallback.
    const maxWidth = ctx
      ? (this._factsCanvas.width - 2 * PAD_X)
      : (maxChars || 65);

    const srcLines = text.split('\n');
    const result   = [];
    let lastWasBlank = false;

    for (const raw of srcLines) {
      const trimmed = raw.trim();

      // Blank line → paragraph spacing.
      if (trimmed.length === 0) {
        if (!lastWasBlank && result.length > 0) {
          result.push({ text: '', type: 'blank' });
        }
        lastWasBlank = true;
        continue;
      }
      lastWasBlank = false;

      // Horizontal rule.
      if (/^[-*_]{3,}\s*$/.test(trimmed)) {
        result.push({ text: '', type: 'rule' });
        continue;
      }

      // Heading: ## Title
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch) {
        const level   = headingMatch[1].length;
        const content = this._cleanLinks(headingMatch[2]);
        this._wrapLine(content, maxWidth, 'heading', result, level, '', ctx, HEADING_FONT_SIZE);
        continue;
      }

      // Unordered list: - item  or  * item
      const ulMatch = trimmed.match(/^[-*]\s+(.*)/);
      if (ulMatch) {
        const content = this._cleanLinks(ulMatch[1]);
        // Char-based: reduce budget by bullet prefix length; pixel-based:
        // measureText already accounts for the prefix in the line.
        const ulWidth = ctx ? maxWidth : maxWidth - 2;
        this._wrapLine(content, ulWidth, 'bullet', result, 0, '• ', ctx, FONT_SIZE);
        continue;
      }

      // Ordered list: 1. item
      const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
      if (olMatch) {
        const prefix  = olMatch[1] + '. ';
        const content = this._cleanLinks(olMatch[2]);
        const olWidth = ctx ? maxWidth : maxWidth - prefix.length;
        this._wrapLine(content, olWidth, 'ordered', result, 0, prefix, ctx, FONT_SIZE);
        continue;
      }

      // Regular paragraph text.
      const content = this._cleanLinks(trimmed);
      this._wrapLine(content, maxWidth, 'text', result, 0, '', ctx, FONT_SIZE);
    }
    return result;
  },

  /** Strip link / image markdown syntax but keep everything else. */
  _cleanLinks(text) {
    return text
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  },

  /**
   * Word-wrap a single content line and push result objects into `output`.
   * Inline markdown markers (**bold**, *italic*, `code`) are preserved in the
   * text.
   *
   * When `ctx` (a canvas 2D context) is provided, wrapping is pixel-based via
   * measureText and handles CJK (Chinese/Japanese/Korean) characters that must
   * be split at every character boundary rather than on spaces.  When `ctx` is
   * absent the function falls back to a character-count estimate using
   * `maxWidth` as the maximum number of visible characters per line.
   */
  _wrapLine(content, maxWidth, type, output, headingLevel, prefix, ctx, fontSize) {
    headingLevel = headingLevel || 0;
    prefix       = prefix || '';
    fontSize     = fontSize || 24;
    const indent = ' '.repeat(prefix.length);

    // Detect CJK characters. Covered blocks:
    //   U+3000–U+9FFF  CJK Symbols & Punctuation, Hiragana, Katakana, Bopomofo,
    //                  Hangul Compatibility Jamo, and CJK Unified Ideographs
    //   U+AC00–U+D7AF  Hangul Syllables
    //   U+F900–U+FAFF  CJK Compatibility Ideographs
    //   U+FF01–U+FFEE  Halfwidth and Fullwidth Forms
    const isCJKChar = (ch) =>
      /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff\uff01-\uffee]/.test(ch);

    // Tokenise: CJK characters become individual tokens (no spaces between them
    // in the source); Latin words are split on whitespace.
    const tokens = [];
    let word = '';
    for (const ch of content) {
      if (isCJKChar(ch)) {
        if (word) { tokens.push({ text: word, cjk: false }); word = ''; }
        tokens.push({ text: ch, cjk: true });
      } else if (ch === ' ' || ch === '\t') {
        if (word) { tokens.push({ text: word, cjk: false }); word = ''; }
      } else {
        word += ch;
      }
    }
    if (word) tokens.push({ text: word, cjk: false });

    if (tokens.length === 0) {
      output.push({ text: prefix, type, headingLevel });
      return;
    }

    // Set the base font for measureText so wrapping measurements are accurate.
    // (Each segment in _drawFormattedLine resets the font to apply bold/italic.)
    if (ctx) ctx.font = fontSize + 'px sans-serif';
    const plainLen = (s) =>
      s.replace(/\*{1,3}/g, '').replace(/_{1,3}/g, '').replace(/`/g, '').length;

    let line            = '';
    let lineEndsWithCJK = false;
    let isFirst         = true;

    for (const token of tokens) {
      // CJK tokens are joined without a space; Latin tokens get a space separator.
      const sep      = (!line || token.cjk || lineEndsWithCJK) ? '' : ' ';
      const testLine = line + sep + token.text;
      const testFull = (isFirst ? prefix : indent) + testLine;

      const fits = ctx
        ? ctx.measureText(testFull).width <= maxWidth
        : plainLen(testLine) <= maxWidth;

      if (fits || !line) {
        line            = testLine;
        lineEndsWithCJK = token.cjk;
      } else {
        output.push({ text: (isFirst ? prefix : indent) + line, type, headingLevel });
        isFirst         = false;
        line            = token.text;
        lineEndsWithCJK = token.cjk;
      }
    }

    if (line || isFirst) {
      output.push({ text: (isFirst ? prefix : indent) + line, type, headingLevel });
    }
  },

  _updateFactsText(text) {
    if (!this._factsCanvas) return;
    if (typeof text !== 'string') {
      this._factsLines = [{ text: String(text), type: 'text', headingLevel: 0 }];
      this._factsScrollLine = 0;
      this._renderFactsWindow();
      return;
    }
    this._factsLines = this._formatMarkdown(text.trim(), 50);
    this._factsScrollLine = 0;
    this._renderFactsWindow();
  },

  /**
   * Render the currently visible window of formatted facts lines onto the
   * canvas and flag the texture for an update.
   */
  _renderFactsWindow() {
    if (!this._factsCanvas) return;
    const ctx = this._factsCanvas.getContext('2d');
    if (!ctx) return;

    const W = this._factsCanvas.width;
    const H = this._factsCanvas.height;
    const PAD_X = 32;
    const PAD_Y = 10;
    const LINE_H = 32;
    const PARA_GAP = 20;
    const FONT_SIZE = 24;
    const HEADING_FONT_SIZE = 28;

    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'top';

    const start = this._factsScrollLine;
    const end   = Math.min(start + this._factsMaxVisible, this._factsLines.length);
    let y = PAD_Y;

    for (let i = start; i < end; i++) {
      const line = this._factsLines[i];
      if (!line) { y += LINE_H; continue; }

      if (line.type === 'blank') { y += LINE_H + PARA_GAP; continue; }

      if (line.type === 'rule') {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_X, y + LINE_H / 2);
        ctx.lineTo(W - PAD_X, y + LINE_H / 2);
        ctx.stroke();
        y += LINE_H;
        continue;
      }

      const fontSize  = line.type === 'heading' ? HEADING_FONT_SIZE : FONT_SIZE;
      const lineIsBold = line.type === 'heading';
      this._drawFormattedLine(ctx, line.text, PAD_X, y, fontSize, lineIsBold);
      y += LINE_H;
    }

    if (this._factsTexture) this._factsTexture.needsUpdate = true;
  },

  /**
   * Draw a single text line onto the canvas with inline markdown formatting.
   * Supports **bold**, *italic*, ***bold-italic***, and `code`.
   */
  _drawFormattedLine(ctx, text, x, y, fontSize, lineIsBold) {
    // Parse inline markdown into segments:
    //   ***bold-italic*** | **bold** | *italic* | `code`
    const segments = [];
    const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) segments.push({ t: text.slice(last, m.index), b: lineIsBold, i: false });
      if      (m[2]) segments.push({ t: m[2], b: true,  i: true  });  // ***bold-italic***
      else if (m[3]) segments.push({ t: m[3], b: true,  i: false });  // **bold**
      else if (m[4]) segments.push({ t: m[4], b: false, i: true  });  // *italic*
      else if (m[5]) segments.push({ t: m[5], b: false, i: false });  // `code`
      last = m.index + m[0].length;
    }
    if (last < text.length) segments.push({ t: text.slice(last), b: lineIsBold, i: false });
    if (segments.length === 0) segments.push({ t: text, b: lineIsBold, i: false });

    let curX = x;
    for (const seg of segments) {
      const weight = (seg.b || lineIsBold) ? 'bold ' : '';
      const style  = seg.i ? 'italic ' : '';
      ctx.font = style + weight + fontSize + 'px sans-serif';

      // Fill.
      ctx.fillStyle = '#ffffff';
      ctx.fillText(seg.t, curX, y);

      curX += ctx.measureText(seg.t).width;
    }
  },

  /**
   * Scroll the facts panel by `delta` lines (positive = down, negative = up).
   */
  _scrollFacts(delta) {
    if (this._factsLines.length === 0) return;
    const maxStart = Math.max(0, this._factsLines.length - this._factsMaxVisible);
    this._factsScrollLine = Math.max(0, Math.min(maxStart, this._factsScrollLine + delta));
    this._renderFactsWindow();
  },

  /**
   * Capture a JPEG snapshot of the current view, POST it to /api/ai-facts,
   * and display the returned facts in the panel incrementally as SSE chunks arrive.
   */
  _fetchAIFacts() {
    // Render the snapshot canvas once to get the current view.
    this._updateSnapshotCanvas();
    const snapshot = this._snapshotCanvas.toDataURL('image/jpeg', 0.85);

    const locTextEl   = document.getElementById('location-text');
    const description = locTextEl ? (locTextEl.getAttribute('value') || '') : '';

    const langEl   = document.getElementById('ai-language');
    const language = langEl ? langEl.value : 'English';

    const rawLat = locTextEl && locTextEl.dataset.lat;
    const rawLng = locTextEl && locTextEl.dataset.lng;
    const lat = rawLat !== undefined && rawLat !== '' ? parseFloat(rawLat) : null;
    const lng = rawLng !== undefined && rawLng !== '' ? parseFloat(rawLng) : null;
    const coordinates = (lat !== null && !isNaN(lat) && lng !== null && !isNaN(lng))
      ? { lat, lng }
      : null;

    fetch('/api/ai-facts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: snapshot, description, language, coordinates }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (this._factsActive) {
        this._hideLoadingBar();
        if (!res.ok || data.error) {
          this._updateFactsText(data.error || 'Could not get facts. Try again.');
        } else {
          this._updateFactsText(data.text || 'No facts available.');
        }
      }
    }).catch(() => {
      if (this._factsActive) {
        this._hideLoadingBar();
        this._updateFactsText('Network error. Check connection.');
      }
    });
  },

  _onXButton() {
    const scene = this.el.sceneEl;
    if (scene && scene.is('vr-mode')) scene.exitVR();
  },
});

/* ─── Patch: oculus-touch-controls quaternion guard ─────────────────────── */

/**
 * A-Frame 1.5.0 has a bug in oculus-touch-controls where button events for
 * the 'none' mapped slot (WebXR button index 2) reach onButtonChangedV3orPROorPlus
 * and attempt to read buttonObjects['none'].quaternion — but buttonObjects['none']
 * is undefined, producing:
 *   "Uncaught TypeError: Cannot read properties of undefined (reading 'quaternion')"
 *
 * Similarly, updateThumbstickTouchV3orPROorPlus accesses buttonObjects.thumbstickXAxis
 * and .thumbstickYAxis without checking they exist (e.g. before the model loads).
 *
 * Fix: wrap both methods with guards that bail out when the referenced
 * buttonObjects entry is absent.
 */
(function patchOculusTouchControls() {
  const registration = AFRAME.components['oculus-touch-controls'];
  if (!registration) { return; }

  const proto = registration.Component.prototype;

  // ── onButtonChangedV3orPROorPlus ───────────────────────────────────────
  const _origButtonChanged = proto.onButtonChangedV3orPROorPlus;
  proto.onButtonChangedV3orPROorPlus = function (evt) {
    const button = this.mapping[this.data.hand].buttons[evt.detail.id];
    if (!this.buttonObjects || !this.buttonObjects[button]) { return; }
    _origButtonChanged.call(this, evt);
  };

  // ── updateThumbstickTouchV3orPROorPlus ────────────────────────────────
  const _origThumbstick = proto.updateThumbstickTouchV3orPROorPlus;
  proto.updateThumbstickTouchV3orPROorPlus = function (evt) {
    if (!this.buttonObjects ||
        !this.buttonObjects.thumbstickXAxis ||
        !this.buttonObjects.thumbstickYAxis) { return; }
    _origThumbstick.call(this, evt);
  };
}());
