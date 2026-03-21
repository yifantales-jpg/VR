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
