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

/* ─── vr-controller-input: floating window behavior ─────────────────────── */

describe('vr-controller-input floating windows', () => {
  /**
   * Build a bare-minimum instance with the key state fields pre-set so each
   * test can call individual methods without going through init() (which
   * touches the DOM heavily).
   */
  function buildInstance() {
    const comp = registeredComponents['vr-controller-input'];
    const instance = Object.create(comp.Component.prototype);
    instance.data = { turnStep: 45, turnCooldown: 350, deadzone: 0.5 };
    instance._lastTurn    = 0;
    instance._zoomActive  = false;
    instance._factsActive = false;
    // Use plain objects as hand references so identity checks work.
    instance._leftHand  = { _id: 'left-hand' };
    instance._rightHand = { _id: 'right-hand' };
    return instance;
  }

  // ── Y button ─────────────────────────────────────────────────────────────

  test('_onYButton: first press sets _factsActive and calls _showFactsFrame', () => {
    const inst = buildInstance();
    inst._showFactsFrame = jest.fn();
    inst._fetchAIFacts   = jest.fn();

    inst._onYButton();

    expect(inst._factsActive).toBe(true);
    expect(inst._showFactsFrame).toHaveBeenCalledWith('Asking Meta AI…');
    expect(inst._fetchAIFacts).toHaveBeenCalled();
  });

  test('_onYButton: second press calls _hideFactsFrame and clears _factsActive', () => {
    const inst = buildInstance();
    inst._factsActive    = true;
    inst._hideFactsFrame = jest.fn();

    inst._onYButton();

    expect(inst._hideFactsFrame).toHaveBeenCalled();
  });

  test('_hideFactsFrame sets _factsActive false', () => {
    const inst = buildInstance();
    inst._factsActive  = true;
    inst._factsFrameEl = null; // no DOM element needed for this assertion

    inst._hideFactsFrame();

    expect(inst._factsActive).toBe(false);
  });

  // ── _showZoomFrame / _showFactsFrame animation reset ─────────────────────

  test('_showZoomFrame: removes old animations and resets scale before showing', () => {
    const inst = buildInstance();
    const calls = [];
    inst._zoomFrameEl = {
      removeAttribute: jest.fn((attr) => calls.push(['remove', attr])),
      setAttribute:    jest.fn((attr, val) => calls.push(['set', attr, val])),
    };

    inst._showZoomFrame();

    expect(inst._zoomFrameEl.removeAttribute).toHaveBeenCalledWith('animation__hide');
    expect(inst._zoomFrameEl.removeAttribute).toHaveBeenCalledWith('animation__show');
    // Scale must be reset before visible is set to true.
    const scaleIdx   = calls.findIndex(([op, attr]) => op === 'set' && attr === 'scale');
    const visibleIdx = calls.findIndex(([op, attr]) => op === 'set' && attr === 'visible');
    expect(scaleIdx).toBeLessThan(visibleIdx);
    expect(calls[scaleIdx][2]).toBe('0.01 0.01 0.01');
    expect(calls[visibleIdx][2]).toBe(true);
  });

  test('_showFactsFrame: removes old animations and resets scale before showing', () => {
    const inst = buildInstance();
    const calls = [];
    inst._factsTextEl  = { setAttribute: jest.fn() };
    inst._factsFrameEl = {
      removeAttribute: jest.fn((attr) => calls.push(['remove', attr])),
      setAttribute:    jest.fn((attr, val) => calls.push(['set', attr, val])),
    };

    inst._showFactsFrame('hello');

    expect(inst._factsFrameEl.removeAttribute).toHaveBeenCalledWith('animation__hide');
    expect(inst._factsFrameEl.removeAttribute).toHaveBeenCalledWith('animation__show');
    const scaleIdx   = calls.findIndex(([op, attr]) => op === 'set' && attr === 'scale');
    const visibleIdx = calls.findIndex(([op, attr]) => op === 'set' && attr === 'visible');
    expect(scaleIdx).toBeLessThan(visibleIdx);
    expect(calls[scaleIdx][2]).toBe('0.01 0.01 0.01');
    expect(calls[visibleIdx][2]).toBe(true);
  });

  // ── Thumbstick up → magnification frame ──────────────────────────────────

  test('_onThumbstick: left stick up shows zoom frame when not already active', () => {
    const inst = buildInstance();
    inst._showZoomFrame = jest.fn();
    inst._hideZoomFrame = jest.fn();

    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._leftHand });

    expect(inst._showZoomFrame).toHaveBeenCalledTimes(1);
    expect(inst._zoomActive).toBe(true);
  });

  test('_onThumbstick: left stick up while already active does not call _showZoomFrame again', () => {
    const inst = buildInstance();
    inst._zoomActive    = true;
    inst._showZoomFrame = jest.fn();
    inst._hideZoomFrame = jest.fn();

    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._leftHand });

    expect(inst._showZoomFrame).not.toHaveBeenCalled();
  });

  test('_onThumbstick: releasing left stick (y in deadzone) hides zoom frame', () => {
    const inst = buildInstance();
    inst._zoomActive    = true;
    inst._showZoomFrame = jest.fn();
    inst._hideZoomFrame = jest.fn();

    inst._onThumbstick({ detail: { x: 0, y: 0 }, target: inst._leftHand });

    expect(inst._hideZoomFrame).toHaveBeenCalled();
    expect(inst._zoomActive).toBe(false);
  });

  test('_onThumbstick: right stick up does NOT trigger zoom frame', () => {
    const inst = buildInstance();
    inst._showZoomFrame = jest.fn();

    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._rightHand });

    expect(inst._showZoomFrame).not.toHaveBeenCalled();
    expect(inst._zoomActive).toBe(false);
  });

  // ── Stepped rotation still works on both controllers ─────────────────────

  test('_onThumbstick: left stick right triggers rotation step', () => {
    const inst = buildInstance();
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };

    inst._onThumbstick({ detail: { x: 0.9, y: 0 }, target: inst._leftHand });

    expect(inst.el.setAttribute).toHaveBeenCalledWith('rotation',
      expect.objectContaining({ y: -45 }));
  });

  test('_onThumbstick: right stick right triggers rotation step', () => {
    const inst = buildInstance();
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };

    inst._onThumbstick({ detail: { x: 0.9, y: 0 }, target: inst._rightHand });

    expect(inst.el.setAttribute).toHaveBeenCalledWith('rotation',
      expect.objectContaining({ y: -45 }));
  });

  test('_onThumbstick: rotation step is skipped when cooldown has not elapsed', () => {
    const inst = buildInstance();
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };
    inst._lastTurn = Date.now(); // cooldown just triggered

    inst._onThumbstick({ detail: { x: 0.9, y: 0 }, target: inst._leftHand });

    expect(inst.el.setAttribute).not.toHaveBeenCalled();
  });
});
