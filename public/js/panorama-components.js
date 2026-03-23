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

    // Update the in-VR location label.
    const label = this.el.querySelector('#location-text');
    if (label && panoData.description) {
      label.setAttribute('value', panoData.description);
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
 *   - Left thumbstick left / right → rotate camera rig in discrete steps.
 *   - Left thumbstick up (held)    → show a magnification frame (4× zoom crop
 *                                    of the panorama centred on the gaze direction).
 *                                    Releasing the stick fades the frame out.
 *   - Right thumbstick left / right→ also rotates (same as left).
 *   - Y button (left hand)         → request Meta AI facts about the current view;
 *                                    tap again to dismiss.
 *   - X button (left hand)         → exit VR.
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
    this._zoomActive  = false;
    this._factsActive = false;

    // Facts-panel scroll state.
    this._factsLines       = [];   // all wrapped lines of the current AI response
    this._factsScrollLine  = 0;    // index of the first visible line
    this._factsMaxVisible  = 12;   // how many lines fit in the panel
    this._lastFactsScroll  = 0;    // cooldown timestamp for scroll steps

    this._panoramaCanvas = document.getElementById('panorama-canvas');

    // Off-screen canvas painted with a zoomed crop of the panorama.
    this._zoomCanvas        = document.createElement('canvas');
    this._zoomCanvas.width  = 512;
    this._zoomCanvas.height = 512;
    this._zoomTexture       = null;

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
    this._onYButton    = this._onYButton.bind(this);

    this._leftHand  = document.getElementById('left-hand');
    this._rightHand = document.getElementById('right-hand');

    if (this._leftHand) {
      this._leftHand.addEventListener('thumbstickmoved', this._onThumbstick);
      this._leftHand.addEventListener('xbuttondown',    this._onXButton);
      this._leftHand.addEventListener('ybuttondown',    this._onYButton);
    }
    if (this._rightHand) {
      this._rightHand.addEventListener('thumbstickmoved', this._onThumbstick);
    }

    this._setupZoomFrame();
    this._setupFactsFrame();
  },

  /**
   * Create a square floating frame that displays a zoomed crop of the
   * panorama canvas centred on the camera's look direction.  The frame is
   * parented to the camera entity so it follows head movement naturally.
   */
  _setupZoomFrame() {
    const camera = this._cameraEl;
    if (!camera) return;

    // Container entity – positioned 0.5 m in front of the camera.
    this._zoomFrameEl = document.createElement('a-entity');
    this._zoomFrameEl.setAttribute('position', '0 0 -0.5');
    this._zoomFrameEl.setAttribute('visible', false);

    // Thin dark border (slightly larger than the image).
    const border = document.createElement('a-plane');
    border.setAttribute('width',    '0.62');
    border.setAttribute('height',   '0.62');
    border.setAttribute('material', 'shader: flat; color: #111111; opacity: 0.35; transparent: true');
    this._zoomFrameEl.appendChild(border);

    // Image plane – carries the CanvasTexture.
    this._zoomPlaneEl = document.createElement('a-plane');
    this._zoomPlaneEl.setAttribute('width',    '0.60');
    this._zoomPlaneEl.setAttribute('height',   '0.60');
    this._zoomPlaneEl.setAttribute('position', '0 0 0.001');
    this._zoomPlaneEl.setAttribute('material', 'shader: flat; side: front');
    this._zoomFrameEl.appendChild(this._zoomPlaneEl);

    camera.appendChild(this._zoomFrameEl);

    // Attach the zoom canvas as a Three.js texture once the mesh is ready.
    const applyZoomTexture = () => {
      const mesh = this._zoomPlaneEl && this._zoomPlaneEl.getObject3D('mesh');
      if (!mesh) return;
      this._zoomTexture = new THREE.CanvasTexture(this._zoomCanvas);
      mesh.material.map = this._zoomTexture;
      mesh.material.needsUpdate = true;
    };

    if (this._zoomPlaneEl.getObject3D('mesh')) {
      applyZoomTexture();
    } else {
      this._zoomPlaneEl.addEventListener('loaded', applyZoomTexture, { once: true });
    }
  },

  /**
   * Create a floating text panel that shows Meta AI facts about the current
   * view.  Also parented to the camera entity so it tracks head movement.
   */
  _setupFactsFrame() {
    const camera = this._cameraEl;
    if (!camera) return;

    this._factsFrameEl = document.createElement('a-entity');
    this._factsFrameEl.setAttribute('position', '0 0 -0.7');
    this._factsFrameEl.setAttribute('visible', false);

    this._factsPanelEl = document.createElement('a-plane');
    this._factsPanelEl.setAttribute('width',    '0.60');
    this._factsPanelEl.setAttribute('height',   '0.40');
    this._factsPanelEl.setAttribute('material', 'shader: flat; color: #111111; opacity: 0.4; transparent: true');
    this._factsFrameEl.appendChild(this._factsPanelEl);

    this._factsTextEl = document.createElement('a-text');
    this._factsTextEl.setAttribute('value',      '');
    this._factsTextEl.setAttribute('align',      'left');
    this._factsTextEl.setAttribute('anchor',     'center');
    this._factsTextEl.setAttribute('baseline',   'top');
    this._factsTextEl.setAttribute('color',      '#e8e8e8');
    this._factsTextEl.setAttribute('outline-color', '#4fc3f7');
    this._factsTextEl.setAttribute('outline-width', '0.02');
    this._factsTextEl.setAttribute('position',   '0 0.17 0.002');
    this._factsTextEl.setAttribute('width',      '0.55');
    this._factsTextEl.setAttribute('wrap-count', '55');
    this._factsFrameEl.appendChild(this._factsTextEl);

    camera.appendChild(this._factsFrameEl);
  },

  /** Update zoom canvas every frame while the magnification frame is visible. */
  tick() {
    if (this._zoomActive) {
      this._updateZoomCanvas();
    }
  },

  remove() {
    if (this._leftHand) {
      this._leftHand.removeEventListener('thumbstickmoved', this._onThumbstick);
      this._leftHand.removeEventListener('xbuttondown',    this._onXButton);
      this._leftHand.removeEventListener('ybuttondown',    this._onYButton);
    }
    if (this._rightHand) {
      this._rightHand.removeEventListener('thumbstickmoved', this._onThumbstick);
    }
    if (this._zoomFrameEl && this._zoomFrameEl.parentNode) {
      this._zoomFrameEl.parentNode.removeChild(this._zoomFrameEl);
    }
    if (this._factsFrameEl && this._factsFrameEl.parentNode) {
      this._factsFrameEl.parentNode.removeChild(this._factsFrameEl);
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
          // Stick up → scroll text up (show earlier lines)
          this._scrollFacts(-3);
        } else {
          // Stick down → scroll text down (show later lines)
          this._scrollFacts(3);
        }
        this._lastFactsScroll = now;
      }
      return; // don't toggle zoom while facts panel is open
    }

    // ── Up → magnification frame (left controller only) ───────────────────
    if (evt.target === this._leftHand) {
      if (y < -dz) {
        if (!this._zoomActive) this._showZoomFrame();
        this._zoomActive = true;
      } else if (this._zoomActive) {
        this._zoomActive = false;
        this._hideZoomFrame();
      }
    }
  },

  _showZoomFrame() {
    if (!this._zoomFrameEl) return;
    this._updateZoomCanvas();
    // Remove any lingering hide/show animations before restarting so the
    // show animation always fires even when the frame was previously closed.
    this._zoomFrameEl.removeAttribute('animation__hide');
    this._zoomFrameEl.removeAttribute('animation__show');
    this._zoomFrameEl.setAttribute('scale', '0.01 0.01 0.01');
    this._zoomFrameEl.setAttribute('visible', true);
    this._zoomFrameEl.setAttribute('animation__show',
      'property: scale; from: 0.01 0.01 0.01; to: 1 1 1; dur: 200; easing: easeOutBack');
  },

  _hideZoomFrame() {
    if (!this._zoomFrameEl) return;
    this._zoomFrameEl.setAttribute('animation__hide',
      'property: scale; from: 1 1 1; to: 0.01 0.01 0.01; dur: 200; easing: easeInBack');
    const frameEl = this._zoomFrameEl;
    setTimeout(() => { if (frameEl) frameEl.setAttribute('visible', false); }, 220);
  },

  /**
   * Sample a zoomed crop of the equirectangular panorama centred on the
   * camera's world-space look direction, and paint it onto _zoomCanvas.
   *
   * The sky sphere may be rotated (heading offset), so the camera direction
   * is un-rotated by the sky's Y rotation before the UV lookup.
   * Horizontal wrapping at the ±180° seam is handled explicitly.
   *
   * The crop is a square region in angular space (srcW = srcH in pixels,
   * since equirectangular has equal angular resolution in both axes for a
   * 2:1 canvas), so the image is displayed without aspect-ratio distortion
   * in the square zoom window.
   */
  _updateZoomCanvas() {
    const camera = this._cameraEl;
    if (!camera || !this._panoramaCanvas || !this._zoomCanvas) return;

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

    const ctx  = this._zoomCanvas.getContext('2d');
    const dstW = this._zoomCanvas.width;
    const dstH = this._zoomCanvas.height;
    ctx.clearRect(0, 0, dstW, dstH);

    // Flip the crop horizontally so it matches the inside-sphere view.
    // The equirectangular texture is mirrored when rendered on the inside of
    // the sky sphere; applying the same mirror here keeps the zoom window
    // consistent with the surrounding panorama.
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

    if (this._zoomTexture) this._zoomTexture.needsUpdate = true;
  },

  // ── Y button: Meta AI facts window ──────────────────────────────────────

  _onYButton() {
    if (this._factsActive) {
      this._hideFactsFrame();
      return;
    }
    this._factsActive = true;
    this._showFactsFrame('Asking Meta AI…');
    this._fetchAIFacts();
  },

  _showFactsFrame(text) {
    if (!this._factsFrameEl) return;
    if (text) this._updateFactsText(text);
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
    if (!this._factsFrameEl) return;
    this._factsFrameEl.setAttribute('animation__hide',
      'property: scale; from: 1 1 1; to: 0.01 0.01 0.01; dur: 200; easing: easeInBack');
    const frameEl = this._factsFrameEl;
    setTimeout(() => { if (frameEl) frameEl.setAttribute('visible', false); }, 220);
  },

  /**
   * Word-wrap `text` into lines of at most `maxChars` characters.
   * Splits on whitespace boundaries; words longer than maxChars are kept intact
   * on their own line.
   */
  _wrapText(text, maxChars) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (!word) continue;
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= maxChars) {
        line += ' ' + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  },

  _updateFactsText(text) {
    if (!this._factsTextEl) return;
    if (typeof text !== 'string') {
      this._factsTextEl.setAttribute('value', text);
      return;
    }
    const clean = text.replace(/\s+/g, ' ').trim();
    this._factsLines = this._wrapText(clean, 55);
    this._factsScrollLine = 0;
    this._renderFactsWindow();
  },

  /**
   * Render the currently visible window of facts lines into the text element.
   */
  _renderFactsWindow() {
    if (!this._factsTextEl) return;
    const start = this._factsScrollLine;
    const end   = Math.min(start + this._factsMaxVisible, this._factsLines.length);
    const visible = this._factsLines.slice(start, end).join('\n');
    this._factsTextEl.setAttribute('value', visible);
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
   * Capture a JPEG snapshot of the zoomed view (what the user is looking at),
   * POST it to /api/ai-facts, and display the returned facts in the panel.
   */
  _fetchAIFacts() {
    // Render the zoom canvas once to get the current view snapshot.
    this._updateZoomCanvas();
    const snapshot = this._zoomCanvas.toDataURL('image/jpeg', 0.85);

    const locTextEl   = document.getElementById('location-text');
    const description = locTextEl ? (locTextEl.getAttribute('value') || '') : '';

    fetch('/api/ai-facts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: snapshot, description }),
    }).then((res) => {
      if (!res.ok) {
        return res.json().catch(() => ({})).then((err) => {
          if (this._factsActive) {
            this._updateFactsText(err.error || 'Could not get facts. Try again.');
          }
        });
      }
      return res.json().then((data) => {
        if (this._factsActive) {
          this._updateFactsText(data.facts || 'No facts available.');
        }
      });
    }).catch(() => {
      if (this._factsActive) this._updateFactsText('Network error. Check connection.');
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
