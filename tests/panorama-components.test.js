/**
 * panorama-components.test.js
 *
 * Unit tests for the custom A-Frame components in panorama-components.js.
 * We mock the global AFRAME and THREE objects so the file can be loaded
 * in a Node.js environment without a real browser.
 */

'use strict';

// ── Mock THREE ──────────────────────────────────────────────────────────────

class MockObject3D {
  constructor() {
    this.rotation = { reorder: jest.fn(), x: 0, y: 0, z: 0 };
    this.position = { y: 0 };
    this.quaternion = { setFromEuler: jest.fn() };
    this.add = jest.fn();
  }
}

class MockVector3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
}

class MockQuaternion {
  constructor() {}
  setFromEuler() { return this; }
  multiply() { return this; }
  setFromAxisAngle() { return this; }
}

class MockEuler {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set() { return this; }
  setFromQuaternion() {}
}

class MockDeviceOrientationControls {
  constructor(object) {
    this.object = object;
    this.enabled = true;
  }
  connect() {}
  disconnect() {}
  update() {}
}

global.THREE = {
  Object3D: MockObject3D,
  Vector3: MockVector3,
  Quaternion: MockQuaternion,
  Euler: MockEuler,
  DeviceOrientationControls: MockDeviceOrientationControls,
  MathUtils: { degToRad: (d) => d * Math.PI / 180, clamp: (v, mn, mx) => Math.min(Math.max(v, mn), mx) },
  CanvasTexture: class {
    constructor() {
      this.colorSpace      = null;
      this.encoding        = null;
      this.minFilter       = null;
      this.generateMipmaps = true;  // Three.js default is true
      this.anisotropy      = 1;
    }
  },
  // Modern color-space constants (Three.js r152+)
  SRGBColorSpace:        'srgb',
  LinearSRGBColorSpace:  'srgb-linear',
  // Filter constants
  LinearFilter:                 1006,
  LinearMipmapLinearFilter:     1008,
};

// ── Mock AFRAME ─────────────────────────────────────────────────────────────

// Registry of components, populated by registerComponent calls.
const registeredComponents = {};

global.AFRAME = {
  registerComponent: jest.fn((name, definition) => {
    // Simulate A-Frame's registration: create a constructor whose prototype
    // holds the definition methods.
    function MockComponent(el) { this.el = el; this.data = {}; }
    Object.keys(definition).forEach((key) => {
      MockComponent.prototype[key] = definition[key];
    });
    registeredComponents[name] = { Component: MockComponent };
  }),
  get components() { return registeredComponents; },
};

// ── Pre-register mock oculus-touch-controls (as A-Frame would have done) ─────
// The patch in panorama-components.js wraps the methods of this component.
// We register a mock version with the buggy A-Frame 1.5.0 implementations so
// the patch has something to fix.

function buildBuggyOculusTouchMethods() {
  return {
    onButtonChangedV3orPROorPlus(evt) {
      const button = this.mapping[this.data.hand].buttons[evt.detail.id];
      // Original A-Frame 1.5.0 code — no guard → crashes on 'none'.
      this.buttonObjects[button].quaternion.slerpQuaternions();
    },
    updateThumbstickTouchV3orPROorPlus() {
      // Original A-Frame 1.5.0 code — no guard → crashes if objects missing.
      this.buttonObjects.thumbstickXAxis.quaternion.slerpQuaternions();
      this.buttonObjects.thumbstickYAxis.quaternion.slerpQuaternions();
    },
  };
}

function MockOculusTouchComponent(el) { this.el = el; this.data = {}; }
Object.assign(MockOculusTouchComponent.prototype, buildBuggyOculusTouchMethods());
registeredComponents['oculus-touch-controls'] = { Component: MockOculusTouchComponent };

// ── Load the module under test ───────────────────────────────────────────────

// Clear the module cache so each test suite gets a fresh load.
beforeAll(() => {
  jest.resetModules();
  require('../public/js/panorama-components');
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('patchOculusTouchControls', () => {
  // Build a minimal mock of the oculus-touch-controls component as it looks
  // *before* the patch is applied, mimicking the A-Frame 1.5.0 behaviour.
  function buildMockProto() {
    return {
      data: { hand: 'left' },
      mapping: {
        left: {
          // WebXR mapping: index 2 → 'none'
          buttons: ['trigger', 'grip', 'none', 'thumbstick', 'xbutton', 'ybutton', 'surface'],
        },
      },
      // Original (buggy) implementation that crashes on 'none'.
      onButtonChangedV3orPROorPlus: jest.fn(function (evt) {
        const button = this.mapping[this.data.hand].buttons[evt.detail.id];
        // Original code has no guard — would crash on undefined buttonObjects entry.
        this.buttonObjects[button].quaternion.slerpQuaternions();
      }),
      // Original implementation that crashes when thumbstick objects are missing.
      updateThumbstickTouchV3orPROorPlus: jest.fn(function () {
        this.buttonObjects.thumbstickXAxis.quaternion.slerpQuaternions();
        this.buttonObjects.thumbstickYAxis.quaternion.slerpQuaternions();
      }),
      buttonObjects: null,
      buttonRanges: {},
    };
  }

  test('patch is applied when oculus-touch-controls is registered', () => {
    expect(registeredComponents['oculus-touch-controls']).toBeDefined();
    const proto = registeredComponents['oculus-touch-controls'].Component.prototype;
    // The patch wraps the original method, so the function reference should differ.
    // We just confirm the key methods exist.
    expect(typeof proto.onButtonChangedV3orPROorPlus).toBe('function');
    expect(typeof proto.updateThumbstickTouchV3orPROorPlus).toBe('function');
  });

  test("onButtonChangedV3orPROorPlus: 'none' button does not throw when buttonObjects is null", () => {
    const proto = registeredComponents['oculus-touch-controls'].Component.prototype;
    const instance = Object.create(proto);
    instance.data = { hand: 'left' };
    instance.mapping = {
      left: { buttons: ['trigger', 'grip', 'none', 'thumbstick', 'xbutton', 'ybutton', 'surface'] },
    };
    instance.buttonObjects = null;

    // Button index 2 → 'none'; buttonObjects is null → should return silently.
    expect(() => {
      instance.onButtonChangedV3orPROorPlus({ detail: { id: 2, state: { value: 0.5 } } });
    }).not.toThrow();
  });

  test("onButtonChangedV3orPROorPlus: 'none' button does not throw when buttonObjects['none'] is absent", () => {
    const proto = registeredComponents['oculus-touch-controls'].Component.prototype;
    const instance = Object.create(proto);
    instance.data = { hand: 'left' };
    instance.mapping = {
      left: { buttons: ['trigger', 'grip', 'none', 'thumbstick', 'xbutton', 'ybutton', 'surface'] },
    };
    // buttonObjects exists but does NOT have a 'none' key.
    instance.buttonObjects = { trigger: {}, grip: {} };

    expect(() => {
      instance.onButtonChangedV3orPROorPlus({ detail: { id: 2, state: { value: 0.5 } } });
    }).not.toThrow();
  });

  test('onButtonChangedV3orPROorPlus: valid button with matching buttonObjects entry proceeds normally', () => {
    const proto = registeredComponents['oculus-touch-controls'].Component.prototype;
    const instance = Object.create(proto);
    instance.data = { hand: 'left' };
    instance.mapping = {
      left: { buttons: ['trigger', 'grip', 'none', 'thumbstick', 'xbutton', 'ybutton', 'surface'] },
    };

    const triggerObj = {
      quaternion: { slerpQuaternions: jest.fn() },
      position: { lerpVectors: jest.fn() },
    };
    instance.buttonObjects = { trigger: triggerObj };
    instance.buttonRanges = {
      trigger: {
        min: { quaternion: {}, position: {} },
        max: { quaternion: {}, position: {} },
      },
    };

    // Button index 0 → 'trigger'; buttonObjects['trigger'] exists.
    expect(() => {
      instance.onButtonChangedV3orPROorPlus({ detail: { id: 0, state: { value: 0.8 } } });
    }).not.toThrow();
  });

  test('updateThumbstickTouchV3orPROorPlus: does not throw when buttonObjects is null', () => {
    const proto = registeredComponents['oculus-touch-controls'].Component.prototype;
    const instance = Object.create(proto);
    instance.buttonObjects = null;

    expect(() => {
      instance.updateThumbstickTouchV3orPROorPlus({ detail: { x: 0.5, y: -0.5 } });
    }).not.toThrow();
  });

  test('updateThumbstickTouchV3orPROorPlus: does not throw when thumbstick axis objects are missing', () => {
    const proto = registeredComponents['oculus-touch-controls'].Component.prototype;
    const instance = Object.create(proto);
    instance.buttonObjects = {};   // no thumbstickXAxis / thumbstickYAxis

    expect(() => {
      instance.updateThumbstickTouchV3orPROorPlus({ detail: { x: 0.3, y: 0.3 } });
    }).not.toThrow();
  });
});

/* ─── street-view-scene: panorama texture sharpness settings ─────────────── */

describe('street-view-scene panorama texture settings', () => {
  /**
   * Build a minimal mock environment that lets us call loadPanorama()
   * and capture the THREE.CanvasTexture that gets created.
   */
  function buildSceneInstance() {
    const createdTextures = [];

    // Capture every CanvasTexture instantiation.
    const OrigCanvasTexture = global.THREE.CanvasTexture;
    const CapturingCanvasTexture = class extends OrigCanvasTexture {
      constructor(...args) {
        super(...args);
        createdTextures.push(this);
      }
    };
    global.THREE.CanvasTexture = CapturingCanvasTexture;

    const material = { map: null, needsUpdate: false };
    const mesh = { material };

    const sky = {
      getObject3D: jest.fn(() => mesh),
      setAttribute: jest.fn(),
      addEventListener: jest.fn(),
    };

    const mockRenderer = {
      capabilities: { getMaxAnisotropy: () => 16 },
    };

    const sceneEl = {
      renderer: mockRenderer,
      querySelector: jest.fn((sel) => {
        if (sel === '#panorama-sky') return sky;
        return null;
      }),
      addEventListener: jest.fn(),
    };

    const comp = registeredComponents['street-view-scene'];
    const instance = Object.create(comp.Component.prototype);
    instance.el = { ...sceneEl, sceneEl };

    const canvas = { width: 8192, height: 4096 };

    return {
      instance,
      sky,
      material,
      canvas,
      createdTextures,
      restore() { global.THREE.CanvasTexture = OrigCanvasTexture; },
    };
  }

  test('panorama texture uses LinearFilter (bilinear, no mipmaps) for sharpest output', () => {
    const { instance, canvas, createdTextures, restore } = buildSceneInstance();

    try {
      instance.loadPanorama({ description: '', links: [] }, canvas, 0);
    } finally {
      restore();
    }

    expect(createdTextures).toHaveLength(1);
    const tex = createdTextures[0];
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    expect(tex.generateMipmaps).toBe(false);
  });

  test('panorama texture uses SRGBColorSpace (modern API)', () => {
    const { instance, canvas, createdTextures, restore } = buildSceneInstance();

    try {
      instance.loadPanorama({ description: '', links: [] }, canvas, 0);
    } finally {
      restore();
    }

    expect(createdTextures).toHaveLength(1);
    expect(createdTextures[0].colorSpace).toBe(THREE.SRGBColorSpace);
  });

  test('panorama texture uses maximum anisotropy from renderer capabilities', () => {
    const { instance, canvas, createdTextures, restore } = buildSceneInstance();

    try {
      instance.loadPanorama({ description: '', links: [] }, canvas, 0);
    } finally {
      restore();
    }

    expect(createdTextures[0].anisotropy).toBe(16);
  });
});

/* ─── vr-controller-input: VR zoom hook ─────────────────────────────────── */

describe('vr-controller-input VR zoom hook', () => {
  /**
   * Build a minimal vr-controller-input instance wired to a mock sky mesh.
   * Returns the instance and a helper to invoke the vrZoomHook directly.
   */
  function buildVRZoomInstance({ baseFov = 90, currentFov = 90 } = {}) {
    // Build a mock projection matrix with asymmetry terms (simulating a
    // real WebXR left-eye camera: m02 > 0, m12 ≈ 0).
    function makeProjectionMatrix(m00, m11, m02, m12) {
      // column-major Float32Array layout used by Three.js Matrix4:
      // [m00, 0, 0, 0,  0, m11, 0, 0,  m02, m12, m22, -1,  0, 0, m23, 0]
      // indices: 0   1  2  3    4   5   6   7    8    9   10  11  12  13  14  15
      const el = new Float32Array(16);
      el[0]  = m00;
      el[5]  = m11;
      el[8]  = m02;
      el[9]  = m12;
      el[10] = -1;   // m22 (typical near/far packed value, not important here)
      el[11] = -1;   // perspective divide row
      el[14] = -0.1; // m23 (near plane, not tested here)
      return { elements: el };
    }

    // Two eye cameras with opposite asymmetry signs (left/right eye IPD offset).
    const leftEye = {
      projectionMatrix: makeProjectionMatrix(1.5, 1.5, 0.15, 0.0),
      projectionMatrixInverse: { copy: jest.fn().mockReturnThis(), invert: jest.fn() },
    };
    const rightEye = {
      projectionMatrix: makeProjectionMatrix(1.5, 1.5, -0.15, 0.0),
      projectionMatrixInverse: { copy: jest.fn().mockReturnThis(), invert: jest.fn() },
    };

    const xrCamera = { cameras: [leftEye, rightEye] };
    const mockRenderer = {
      xr: {
        isPresenting: true,
        getCamera: jest.fn(() => xrCamera),
      },
    };

    const mesh = { onBeforeRender: null };
    const skyEl = {
      getObject3D: jest.fn(() => mesh),
      addEventListener: jest.fn(),
    };

    // Mock document.getElementById used by init().
    const origGetElementById = global.document && global.document.getElementById;
    if (!global.document) global.document = {};
    global.document.getElementById = jest.fn((id) => {
      if (id === 'panorama-sky') return skyEl;
      return null;
    });

    const sceneEl = { addEventListener: jest.fn(), is: jest.fn(() => false) };
    const el = {
      sceneEl,
      querySelector: jest.fn(() => ({
        getAttribute: jest.fn(() => ({ fov: baseFov })),
        setAttribute: jest.fn(),
      })),
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };

    const comp = registeredComponents['vr-controller-input'];
    const instance = Object.create(comp.Component.prototype);
    instance.el   = el;
    instance.data = {
      turnStep: 45, turnCooldown: 350,
      zoomStep: 5,  zoomCooldown: 200,
      fovMin: 30,   fovMax: 120,
      deadzone: 0.5,
    };
    instance.init();

    // Override current FOV to simulate a zoomed state.
    instance._fov = currentFov;

    // Retrieve the installed hook and the mock mesh so callers can invoke it.
    return {
      instance,
      leftEye,
      rightEye,
      mockRenderer,
      mesh,
      invokeHook() {
        instance._vrZoomApplied = false; // reset per-frame flag
        mesh.onBeforeRender(mockRenderer, {}, {});
      },
      restore() {
        if (origGetElementById !== undefined) {
          global.document.getElementById = origGetElementById;
        }
      },
    };
  }

  test('zoom hook scales focal terms (elements[0] and [5]) by zoomScale', () => {
    const { leftEye, invokeHook, restore } = buildVRZoomInstance({ baseFov: 90, currentFov: 45 });
    try {
      const origM00 = leftEye.projectionMatrix.elements[0];
      const origM11 = leftEye.projectionMatrix.elements[5];
      invokeHook();
      const expectedScale = 90 / 45; // zoomScale = baseFov / currentFov = 2
      expect(leftEye.projectionMatrix.elements[0]).toBeCloseTo(origM00 * expectedScale, 5);
      expect(leftEye.projectionMatrix.elements[5]).toBeCloseTo(origM11 * expectedScale, 5);
    } finally {
      restore();
    }
  });

  test('zoom hook scales asymmetry terms (elements[8] and [9]) by the same zoomScale', () => {
    // This is the critical fix: asymmetry terms must be scaled to prevent
    // gaze-direction drift and head-turn distortion.
    const { leftEye, rightEye, invokeHook, restore } = buildVRZoomInstance({ baseFov: 90, currentFov: 45 });
    try {
      const origLeftM02  = leftEye.projectionMatrix.elements[8];
      const origLeftM12  = leftEye.projectionMatrix.elements[9];
      const origRightM02 = rightEye.projectionMatrix.elements[8];
      const origRightM12 = rightEye.projectionMatrix.elements[9];
      invokeHook();
      const expectedScale = 90 / 45; // 2×
      expect(leftEye.projectionMatrix.elements[8]).toBeCloseTo(origLeftM02  * expectedScale, 5);
      expect(leftEye.projectionMatrix.elements[9]).toBeCloseTo(origLeftM12  * expectedScale, 5);
      expect(rightEye.projectionMatrix.elements[8]).toBeCloseTo(origRightM02 * expectedScale, 5);
      expect(rightEye.projectionMatrix.elements[9]).toBeCloseTo(origRightM12 * expectedScale, 5);
    } finally {
      restore();
    }
  });

  test('zoom preserves the m02/m00 ratio (zoom centre stays on gaze axis)', () => {
    // The zoom centre in NDC is at -m02 (for x).  After scaling both m00 and
    // m02 by the same factor, the camera-space direction of the zoom centre
    // (-m02 / m00) is unchanged, so head turning does not distort the view.
    const { leftEye, invokeHook, restore } = buildVRZoomInstance({ baseFov: 90, currentFov: 60 });
    try {
      const origRatio = leftEye.projectionMatrix.elements[8] / leftEye.projectionMatrix.elements[0];
      invokeHook();
      const newRatio  = leftEye.projectionMatrix.elements[8] / leftEye.projectionMatrix.elements[0];
      expect(newRatio).toBeCloseTo(origRatio, 5);
    } finally {
      restore();
    }
  });

  test('zoom hook is a no-op when FOV equals baseFov (zoomScale ≈ 1)', () => {
    const { leftEye, invokeHook, restore } = buildVRZoomInstance({ baseFov: 90, currentFov: 90 });
    try {
      const origM00 = leftEye.projectionMatrix.elements[0];
      const origM02 = leftEye.projectionMatrix.elements[8];
      invokeHook();
      expect(leftEye.projectionMatrix.elements[0]).toBeCloseTo(origM00, 5);
      expect(leftEye.projectionMatrix.elements[8]).toBeCloseTo(origM02, 5);
    } finally {
      restore();
    }
  });

  test('zoom hook fires only once per frame even though onBeforeRender is called per eye', () => {
    const { mockRenderer, mesh, instance, restore } = buildVRZoomInstance({ baseFov: 90, currentFov: 45 });
    try {
      instance._vrZoomApplied = false;
      const getCamera = mockRenderer.xr.getCamera;
      // Simulate two calls (one per eye) without resetting the flag in between.
      mesh.onBeforeRender(mockRenderer, {}, {});
      mesh.onBeforeRender(mockRenderer, {}, {});
      // getCamera should have been called exactly once (second call bailed early).
      expect(getCamera).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
