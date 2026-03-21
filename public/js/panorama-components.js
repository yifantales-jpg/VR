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
        map.encoding = THREE.sRGBEncoding;
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
 *   - Thumbstick left / right → rotate camera rig in discrete steps (stepped turn).
 *   - Thumbstick up / down    → zoom the camera by adjusting its field-of-view.
 *   - X button (left hand)    → exit VR.
 *
 * Attach to the #camera-rig entity: <a-entity vr-controller-input …>
 */
AFRAME.registerComponent('vr-controller-input', {
  schema: {
    turnStep:    { type: 'number', default: 45  },  // degrees per lateral step
    turnCooldown:{ type: 'number', default: 350 },  // ms between turns
    zoomStep:    { type: 'number', default: 5   },  // FOV degrees per zoom step
    zoomCooldown:{ type: 'number', default: 200 },  // ms between zoom steps
    fovMin:      { type: 'number', default: 30  },  // narrowest (most zoomed-in) FOV
    fovMax:      { type: 'number', default: 120 },  // widest (most zoomed-out) FOV
    deadzone:    { type: 'number', default: 0.5 },  // thumbstick axis threshold
  },

  init() {
    this._lastTurn = 0;
    this._lastZoom = 0;

    this._onThumbstick = this._onThumbstick.bind(this);
    this._onXButton    = this._onXButton.bind(this);

    this._leftHand  = document.getElementById('left-hand');
    this._rightHand = document.getElementById('right-hand');

    if (this._leftHand) {
      this._leftHand.addEventListener('thumbstickmoved', this._onThumbstick);
      this._leftHand.addEventListener('xbuttondown', this._onXButton);
    }
    if (this._rightHand) {
      this._rightHand.addEventListener('thumbstickmoved', this._onThumbstick);
    }
  },

  remove() {
    if (this._leftHand) {
      this._leftHand.removeEventListener('thumbstickmoved', this._onThumbstick);
      this._leftHand.removeEventListener('xbuttondown',    this._onXButton);
    }
    if (this._rightHand) {
      this._rightHand.removeEventListener('thumbstickmoved', this._onThumbstick);
    }
  },

  _onThumbstick(evt) {
    const now      = Date.now();
    const { x, y } = evt.detail;
    const dz       = this.data.deadzone;

    // ── Left / Right → stepped yaw rotation ─────────────────────────────
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

    // ── Up / Down → zoom (FOV) ──────────────────────────────────────────
    if (Math.abs(y) >= dz && now - this._lastZoom >= this.data.zoomCooldown) {
      const camera = this.el.querySelector('[camera]');
      if (camera) {
        const currentFov = parseFloat(camera.getAttribute('fov')) || 90;
        // Positive y = thumbstick down → zoom out (increase FOV)
        const newFov = THREE.MathUtils.clamp(
          currentFov + (y > 0 ? this.data.zoomStep : -this.data.zoomStep),
          this.data.fovMin,
          this.data.fovMax
        );
        camera.setAttribute('fov', newFov);
      }
      this._lastZoom = now;
    }
  },

  _onXButton() {
    const scene = this.el.sceneEl;
    if (scene && scene.is('vr-mode')) {
      scene.exitVR();
    }
  },
});
