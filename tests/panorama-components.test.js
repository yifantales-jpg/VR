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

  test('loadPanorama stores lat/lng as data attributes on the location-text label', () => {
    const { instance, canvas, restore } = buildSceneInstance();

    // Extend the querySelector mock to also return a label element.
    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: {} };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    const origFetch = global.fetch;
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({}) }));

    try {
      instance.loadPanorama(
        { description: 'Eiffel Tower', links: [], latLng: { lat: 48.858370, lng: 2.294481 } },
        canvas,
        0
      );
    } finally {
      restore();
      global.fetch = origFetch;
    }

    expect(label.dataset.lat).toBe('48.85837');
    expect(label.dataset.lng).toBe('2.294481');
  });

  test('loadPanorama clears lat/lng data attributes when latLng is absent', () => {
    const { instance, canvas, restore } = buildSceneInstance();

    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: { lat: '48.85', lng: '2.29' } };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    try {
      instance.loadPanorama({ description: 'Unknown', links: [] }, canvas, 0);
    } finally {
      restore();
    }

    expect(label.dataset.lat).toBeUndefined();
    expect(label.dataset.lng).toBeUndefined();
  });

  test('loadPanorama always sets the label value even when description is empty (clears stale text)', () => {
    const { instance, canvas, restore } = buildSceneInstance();

    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: {} };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    try {
      // No description field → value should be set to '' to clear any previous text.
      instance.loadPanorama({ description: '', links: [] }, canvas, 0);
    } finally {
      restore();
    }

    expect(label.setAttribute).toHaveBeenCalledWith('value', '');
  });

  test('loadPanorama fires a geocoding request when valid coordinates are available', () => {
    const { instance, canvas, restore } = buildSceneInstance();
    instance._geocodeSeq = 0;

    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: {} };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    const mockFetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({}) }));
    const origFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      instance.loadPanorama(
        { description: 'Paris', links: [], latLng: { lat: 48.8566, lng: 2.3522 } },
        canvas,
        0
      );
    } finally {
      restore();
      global.fetch = origFetch;
    }

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/geocode');
    expect(calledUrl).toContain('lat=48.8566');
    expect(calledUrl).toContain('lng=2.3522');
  });

  test('loadPanorama updates label with geocoded address when geocoding succeeds', async () => {
    const { instance, canvas, restore } = buildSceneInstance();
    instance._geocodeSeq = 0;

    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: {} };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    const mockFetch = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ address: 'Rue de Rivoli, Paris, France' }) })
    );
    const origFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      instance.loadPanorama(
        { description: 'Paris', links: [], latLng: { lat: 48.8566, lng: 2.3522 } },
        canvas,
        0
      );
    } finally {
      restore();
      global.fetch = origFetch;
    }

    // Wait for the async geocoding promise to resolve (fetch → .json() → .then chain).
    await new Promise((resolve) => setImmediate(resolve));

    expect(label.setAttribute).toHaveBeenCalledWith('value', 'Rue de Rivoli, Paris, France');
  });

  test('loadPanorama restarts location-label fade after geocoded address is applied', async () => {
    const { instance, canvas, restore } = buildSceneInstance();
    instance._geocodeSeq = 0;

    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: {} };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    // Also expose the label to _startLocationLabelFade which uses getElementById.
    const origDocument = global.document;
    global.document = {
      ...origDocument,
      getElementById: jest.fn((id) => (id === 'location-text' ? label : null)),
    };

    const mockFetch = jest.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ address: 'Tour Eiffel, Paris, France' }) })
    );
    const origFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      instance.loadPanorama(
        { description: 'Paris', links: [], latLng: { lat: 48.8566, lng: 2.3522 } },
        canvas,
        0
      );
    } finally {
      restore();
      global.fetch = origFetch;
      // NOTE: do NOT restore global.document here — the geocoding promise must
      // still find the label via getElementById when it resolves below.
    }

    // Count animation__locfade setAttribute calls before geocoding resolves.
    const fadeCallsBefore = label.setAttribute.mock.calls.filter(
      ([attr]) => attr === 'animation__locfade'
    ).length;

    // Let the geocoding promise resolve.
    await new Promise((resolve) => setImmediate(resolve));

    // Restore document after the promise chain settles.
    global.document = origDocument;

    // After geocoding, _startLocationLabelFade must have been called again.
    const fadeCallsAfter = label.setAttribute.mock.calls.filter(
      ([attr]) => attr === 'animation__locfade'
    ).length;
    expect(fadeCallsAfter).toBeGreaterThan(fadeCallsBefore);
  });

  test('loadPanorama discards stale geocoding response when user has navigated away', async () => {
    const { instance, canvas, restore } = buildSceneInstance();
    instance._geocodeSeq = 0;

    const label = { setAttribute: jest.fn(), removeAttribute: jest.fn(), dataset: {} };
    const origQuery = instance.el.querySelector;
    instance.el.querySelector = jest.fn((sel) => {
      if (sel === '#location-text') return label;
      return origQuery(sel);
    });

    // First panorama: geocoding resolves slowly (after seq is already > 1)
    let resolveFirstGeocode;
    const firstGeocodeProm = new Promise((resolve) => { resolveFirstGeocode = resolve; });
    const mockFetch = jest.fn()
      .mockReturnValueOnce(firstGeocodeProm.then(() => ({
        json: () => Promise.resolve({ address: 'Old Address, Paris' }),
      })))
      .mockReturnValue(
        Promise.resolve({ json: () => Promise.resolve({ address: 'New Address, Tokyo' }) })
      );
    const origFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      // Load panorama A (seq = 1)
      instance.loadPanorama(
        { description: 'Paris', links: [], latLng: { lat: 48.8566, lng: 2.3522 } },
        canvas, 0
      );
      // Immediately load panorama B (seq = 2) — simulates quick navigation
      instance.loadPanorama(
        { description: 'Tokyo', links: [], latLng: { lat: 35.6762, lng: 139.6503 } },
        canvas, 0
      );
    } finally {
      restore();
      global.fetch = origFetch;
    }

    // Now resolve geocoding for A (stale — seq is 2 now)
    resolveFirstGeocode();
    await new Promise((resolve) => setImmediate(resolve));

    // The label should NOT have been updated with the stale result for A
    const setCalls = label.setAttribute.mock.calls;
    const addressCalls = setCalls.filter(([attr, val]) => attr === 'value' && val === 'Old Address, Paris');
    expect(addressCalls).toHaveLength(0);
  });
});

/* ─── vr-controller-input: _updateSnapshotCanvas UV mapping ─────────────── */

describe('_updateSnapshotCanvas UV mapping', () => {
  /**
   * Build a minimal instance wired for UV-mapping tests.
   * worldDir is the desired camera look direction in world space.
   * skyYDeg is the sky sphere's Y rotation in degrees.
   */
  function buildSnapshotInstance(skyYDeg, worldDir) {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    const panoCanvas = { width: 4096, height: 2048 };
    const drawCalls  = [];
    const snapCtx    = {
      clearRect: jest.fn(),
      drawImage: jest.fn((...args) => drawCalls.push(args)),
      save:      jest.fn(),
      restore:   jest.fn(),
      translate: jest.fn(),
      scale:     jest.fn(),
    };
    const snapCanvas = {
      width: 512, height: 512,
      getContext: () => snapCtx,
    };

    // Mock _worldDir: set() initialises it, applyQuaternion() delivers worldDir.
    inst._worldDir = {
      x: 0, y: 0, z: -1,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
      applyQuaternion() {
        this.x = worldDir.x; this.y = worldDir.y; this.z = worldDir.z;
        return this;
      },
    };
    inst._worldQuat = {};
    inst._cameraEl  = { object3D: { getWorldQuaternion: () => inst._worldQuat } };
    inst._skyEl     = { object3D: { rotation: { y: skyYDeg * Math.PI / 180 } } };
    inst._panoramaCanvas = panoCanvas;
    inst._snapshotCanvas = snapCanvas;

    return { inst, drawCalls, snapCtx };
  }

  // Side length of the crop square (panoW/4 = 90° FOV).
  const SIDE = Math.floor(4096 / 4); // 1024

  test('looking forward with sky rotation y=-90° crops at u=0.5 (center)', () => {
    // With scale(-1,1,1) and skyYRad=-π/2, forward -Z → phi=π → u=0.5 (center of panorama).
    // srcX = 0.5*4096 - 512 = 1536 → no seam wrap (1536+1024=2560 < 4096)
    const { inst, drawCalls } = buildSnapshotInstance(-90, { x: 0, y: 0, z: -1 });
    inst._updateSnapshotCanvas();

    expect(drawCalls.length).toBe(1); // no horizontal seam wrap
    expect(drawCalls[0][1]).toBeCloseTo(0.5 * 4096 - SIDE / 2, 0);
  });

  test('looking backward with sky rotation y=-90° crops at u=0 (seam)', () => {
    // With scale(-1,1,1) and skyYRad=-π/2, backward +Z → phi=0 → u=0 (left edge/seam).
    // srcX = 0*4096 - 512 = -512 → horizontal seam wrap (2 drawCalls)
    const { inst, drawCalls } = buildSnapshotInstance(-90, { x: 0, y: 0, z: 1 });
    inst._updateSnapshotCanvas();

    expect(drawCalls.length).toBe(2); // horizontal seam wrap
    // First draw: right portion of panorama from panoW + srcX = 4096-512 = 3584
    expect(drawCalls[0][1]).toBeCloseTo(4096 - SIDE / 2, 0);
  });

  test('looking forward with no sky rotation crops at u=0.75', () => {
    // skyYRad=0, forward -Z → texX=0, texZ=-1 → phi=atan2(-1,0)=-π/2 → u=0.75
    // srcX = 0.75*4096 - 512 = 3072-512 = 2560 → no wrap (2560+1024=3584 < 4096)
    const { inst, drawCalls } = buildSnapshotInstance(0, { x: 0, y: 0, z: -1 });
    inst._updateSnapshotCanvas();

    expect(drawCalls.length).toBe(1);
    expect(drawCalls[0][1]).toBeCloseTo(0.75 * 4096 - SIDE / 2, 0);
  });

  test('returns early when panorama canvas is absent', () => {
    const { inst, snapCtx } = buildSnapshotInstance(-90, { x: 0, y: 0, z: -1 });
    inst._panoramaCanvas = null;
    inst._updateSnapshotCanvas();

    expect(snapCtx.clearRect).not.toHaveBeenCalled();
    expect(snapCtx.drawImage).not.toHaveBeenCalled();
  });

  test('does not horizontally flip the crop (<a-sky> scale(-1,1,1) handles mirroring)', () => {
    const { inst, snapCtx } = buildSnapshotInstance(0, { x: 0, y: 0, z: -1 });
    inst._updateSnapshotCanvas();

    // The canvas flip was removed because <a-sky>'s default scale(-1,1,1) already
    // corrects inside-sphere left-right mirroring; a second flip would be wrong.
    expect(snapCtx.scale).not.toHaveBeenCalledWith(-1, 1);
    expect(snapCtx.drawImage).toHaveBeenCalled();
  });

  test('uses the entity object3D for gaze direction', () => {
    const { inst } = buildSnapshotInstance(0, { x: 0, y: 0, z: -1 });
    const entityObj = { getWorldQuaternion: jest.fn(() => inst._worldQuat) };
    inst._cameraEl = {
      getObject3D: jest.fn(name => (name === 'camera' ? { getWorldQuaternion: jest.fn() } : null)),
      object3D: entityObj,
    };

    inst._updateSnapshotCanvas();

    expect(entityObj.getWorldQuaternion).toHaveBeenCalled();
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
    instance._lastTurn        = 0;
    instance._factsActive     = false;
    instance._factsLines      = [];
    instance._factsScrollLine = 0;
    instance._factsMaxVisible = 12;
    instance._lastFactsScroll = 0;
    instance._zoomSteps        = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35];
    instance._zoomLevel        = 0;
    instance._zoomAxisNeutral  = true;
    // Use plain objects as hand references so identity checks work.
    instance._leftHand  = { _id: 'left-hand' };
    instance._rightHand = { _id: 'right-hand' };
    // Mock canvas for facts rendering (returns the SAME context every call).
    const mockCtx = {
      clearRect: jest.fn(),
      fillText: jest.fn(),
      strokeText: jest.fn(),
      measureText: jest.fn((t) => ({ width: t.length * 12 })),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
      fillRect: jest.fn(),
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      lineJoin: '',
      textBaseline: '',
      globalCompositeOperation: 'source-over',
    };
    instance._factsCanvas = {
      width: 1024, height: 853,
      getContext: jest.fn(() => mockCtx),
    };
    instance._factsTexture = null;
    instance._zoomPlaneEl  = { setAttribute: jest.fn() };
    return instance;
  }

  // ── B button ─────────────────────────────────────────────────────────────

  test('_onBButton: first press sets _factsActive and calls _showFactsFrame without text', () => {
    const inst = buildInstance();
    inst._showFactsFrame = jest.fn();
    inst._fetchAIFacts   = jest.fn();

    inst._onBButton();

    expect(inst._factsActive).toBe(true);
    expect(inst._showFactsFrame).toHaveBeenCalledWith();
    expect(inst._fetchAIFacts).toHaveBeenCalled();
  });

  test('_onBButton: second press copies facts and calls _hideFactsFrame', () => {
    const inst = buildInstance();
    inst._factsActive         = true;
    inst._hideFactsFrame      = jest.fn();
    inst._copyFactsToClipboard = jest.fn();

    inst._onBButton();

    expect(inst._copyFactsToClipboard).toHaveBeenCalled();
    expect(inst._hideFactsFrame).toHaveBeenCalled();
  });

  // ── A button ─────────────────────────────────────────────────────────────

  test('_onAButton restores label opacity and schedules auto-fade', () => {
    const inst = buildInstance();

    const label = { removeAttribute: jest.fn(), setAttribute: jest.fn() };
    const origDocument = global.document;
    global.document = {
      getElementById: jest.fn((id) => (id === 'location-text' ? label : null)),
    };

    try {
      inst._onAButton();
    } finally {
      global.document = origDocument;
    }

    // _startLocationLabelFade cancels any in-progress animation and resets opacity.
    expect(label.removeAttribute).toHaveBeenCalledWith('animation__locfade');
    expect(label.setAttribute).toHaveBeenCalledWith('text', 'opacity: 1');
    // Then schedules the fade-out animation.
    expect(label.setAttribute).toHaveBeenCalledWith(
      'animation__locfade',
      expect.stringContaining('text.opacity')
    );
  });

  test('remove() detaches abuttondown listener from right hand', () => {
    const inst = buildInstance();
    const rightHand = { removeEventListener: jest.fn() };
    const leftHand  = { removeEventListener: jest.fn() };
    inst._rightHand    = rightHand;
    inst._leftHand     = leftHand;
    inst._factsFrameEl = null;
    inst._zoomPlaneEl  = null;

    inst.remove();

    expect(rightHand.removeEventListener).toHaveBeenCalledWith('abuttondown', expect.any(Function));
  });

  // ── Y button ─────────────────────────────────────────────────────────────

  test('_onYButton emits load-random-pano on the scene', () => {
    const inst = buildInstance();
    const scene = { emit: jest.fn() };
    inst.el = { sceneEl: scene };

    inst._onYButton();

    expect(scene.emit).toHaveBeenCalledWith('load-random-pano');
  });

  test('_onYButton does nothing when sceneEl is absent', () => {
    const inst = buildInstance();
    inst.el = { sceneEl: null };

    expect(() => inst._onYButton()).not.toThrow();
  });

  test('remove() detaches ybuttondown listener from left hand', () => {
    const inst = buildInstance();
    const rightHand = { removeEventListener: jest.fn() };
    const leftHand  = { removeEventListener: jest.fn() };
    inst._rightHand    = rightHand;
    inst._leftHand     = leftHand;
    inst._factsFrameEl = null;
    inst._zoomPlaneEl  = null;

    inst.remove();

    expect(leftHand.removeEventListener).toHaveBeenCalledWith('ybuttondown', expect.any(Function));
  });

  // ── _fetchAIFacts: includes coordinates when stored on location-text ──────

  test('_fetchAIFacts sends coordinates from location-text data attributes', () => {
    const inst = buildInstance();
    inst._updateSnapshotCanvas = jest.fn();
    inst._snapshotCanvas = { toDataURL: jest.fn(() => 'data:image/jpeg;base64,abc') };
    inst._hideLoadingBar = jest.fn();
    inst._updateFactsText = jest.fn();

    const mockFetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ facts: 'ok' }) }));
    const origFetch = global.fetch;
    global.fetch = mockFetch;

    const locEl = { getAttribute: () => 'Paris', dataset: { lat: '48.8566', lng: '2.3522' } };
    const langEl = { value: 'English' };
    const origGetById = global.document && global.document.getElementById;
    global.document = {
      getElementById: jest.fn((id) => {
        if (id === 'location-text') return locEl;
        if (id === 'ai-language') return langEl;
        return null;
      }),
    };

    inst._fetchAIFacts();

    global.fetch = origFetch;
    if (origGetById !== undefined) global.document.getElementById = origGetById;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.coordinates).toEqual({ lat: 48.8566, lng: 2.3522 });
  });

  test('_fetchAIFacts sends null coordinates when data attributes are absent', () => {
    const inst = buildInstance();
    inst._updateSnapshotCanvas = jest.fn();
    inst._snapshotCanvas = { toDataURL: jest.fn(() => 'data:image/jpeg;base64,abc') };
    inst._hideLoadingBar = jest.fn();
    inst._updateFactsText = jest.fn();

    const mockFetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ facts: 'ok' }) }));
    const origFetch = global.fetch;
    global.fetch = mockFetch;

    const locEl = { getAttribute: () => 'Paris', dataset: {} };
    global.document = {
      getElementById: jest.fn((id) => {
        if (id === 'location-text') return locEl;
        if (id === 'ai-language') return { value: 'English' };
        return null;
      }),
    };

    inst._fetchAIFacts();

    global.fetch = origFetch;

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.coordinates).toBeNull();
  });

  test('_hideFactsFrame sets _factsActive false', () => {
    const inst = buildInstance();
    inst._factsActive  = true;
    inst._factsFrameEl = null; // no DOM element needed for this assertion

    inst._hideFactsFrame();

    expect(inst._factsActive).toBe(false);
  });

  // ── _showFactsFrame animation reset ────────────────────────────────────

  test('_showFactsFrame: removes old animations and resets scale before showing', () => {
    const inst = buildInstance();
    const calls = [];
    inst._loadingBarEl = {
      setAttribute:    jest.fn(),
      removeAttribute: jest.fn(),
    };
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
    // Loading bar should be hidden when text is provided.
    expect(inst._loadingBarEl.setAttribute).toHaveBeenCalledWith('visible', false);
  });

  test('_showFactsFrame: shows loading bar and clears canvas when called without text', () => {
    const inst = buildInstance();
    inst._loadingBarEl = {
      setAttribute:    jest.fn(),
      removeAttribute: jest.fn(),
    };
    inst._factsFrameEl = {
      removeAttribute: jest.fn(),
      setAttribute:    jest.fn(),
    };

    inst._showFactsFrame();

    expect(inst._loadingBarEl.setAttribute).toHaveBeenCalledWith('visible', true);
    // Canvas should be cleared.
    const ctx = inst._factsCanvas.getContext();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(inst._factsLines).toEqual([]);
    expect(inst._factsScrollLine).toBe(0);
  });

  test('_updateFactsText formats markdown and renders canvas', () => {
    const inst = buildInstance();

    inst._updateFactsText('## Heading\n\n**bold** and *italic*\n\n- item one\n- item two');

    // Should produce structured lines (heading, blank, text with inline md, blank, bullets).
    expect(inst._factsLines.length).toBeGreaterThan(0);
    expect(inst._factsLines[0].type).toBe('heading');
    expect(inst._factsLines[0].text).toContain('Heading');
    // Canvas should have been rendered (clearRect called).
    const ctx = inst._factsCanvas.getContext();
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  test('_updateFactsText handles non-string input', () => {
    const inst = buildInstance();

    inst._updateFactsText(42);

    expect(inst._factsLines).toEqual([{ text: '42', type: 'text', headingLevel: 0 }]);
  });

  test('_setupFactsFrame creates plane (no background) with loading bar', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);
    inst._cameraEl = { appendChild: jest.fn() };
    inst._factsCanvas = { width: 1024, height: 512, getContext: jest.fn(() => ({})) };

    const originalDocument = global.document;
    const created = [];
    global.document = {
      createElement: jest.fn((tag) => {
        const el = {
          tag,
          attributes: {},
          setAttribute: jest.fn(function setAttr(name, value) { this.attributes[name] = value; }),
          appendChild: jest.fn(),
        };
        created.push(el);
        return el;
      }),
    };

    inst._setupFactsFrame();

    expect(inst._factsFrameEl.attributes.position).toBe('0 -0.25 -0.7');

    // No background panel — uses canvas-based text rendering on a plane.
    expect(inst._factsBgEl).toBeUndefined();

    // Facts plane (a-plane) for canvas texture.
    expect(inst._factsPlaneEl).toBeDefined();
    expect(inst._factsPlaneEl.tag).toBe('a-plane');
    expect(inst._factsPlaneEl.attributes.width).toBe('0.60');
    expect(inst._factsPlaneEl.attributes.height).toBe('0.50');
    expect(inst._factsPlaneEl.attributes.material).toContain('transparent: true');

    // Loading bar is created.
    expect(inst._loadingBarEl).toBeDefined();
    expect(inst._loadingBarEl.tag).toBe('a-plane');
    expect(inst._loadingBarEl.attributes.visible).toBe(false);

    expect(inst._cameraEl.appendChild).toHaveBeenCalledWith(inst._factsFrameEl);

    global.document = originalDocument;
  });

  // ── Scrolling ───────────────────────────────────────────────────────────

  test('_formatMarkdown parses headings, bullets, and text', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    const lines = inst._formatMarkdown('## Title\n\nHello world\n\n- one\n- two', 50);
    expect(lines[0]).toEqual(expect.objectContaining({ type: 'heading', headingLevel: 2 }));
    expect(lines[0].text).toContain('Title');
    // blank
    expect(lines[1]).toEqual(expect.objectContaining({ type: 'blank' }));
    // text
    expect(lines[2]).toEqual(expect.objectContaining({ type: 'text' }));
    expect(lines[2].text).toContain('Hello world');
    // blank
    expect(lines[3]).toEqual(expect.objectContaining({ type: 'blank' }));
    // bullets
    expect(lines[4]).toEqual(expect.objectContaining({ type: 'bullet' }));
    expect(lines[4].text).toContain('• one');
    expect(lines[5]).toEqual(expect.objectContaining({ type: 'bullet' }));
    expect(lines[5].text).toContain('• two');
  });

  test('_formatMarkdown preserves inline **bold** and *italic* markers in text', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    const lines = inst._formatMarkdown('This is **bold** and *italic*', 50);
    expect(lines[0].text).toContain('**bold**');
    expect(lines[0].text).toContain('*italic*');
  });

  test('_formatMarkdown collapses consecutive blank lines', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    const lines = inst._formatMarkdown('para one\n\n\npara two', 50);
    expect(lines).toEqual([
      expect.objectContaining({ text: 'para one', type: 'text' }),
      expect.objectContaining({ type: 'blank' }),
      expect.objectContaining({ text: 'para two', type: 'text' }),
    ]);
  });

  test('_scrollFacts scrolls down and clamps at end', () => {
    const inst = buildInstance();
    // 15 lines total, 12 visible → max start = 3
    inst._factsLines = Array.from({ length: 15 }, (_, i) => ({ text: `Line ${i}`, type: 'text', headingLevel: 0 }));
    inst._factsScrollLine = 0;

    inst._scrollFacts(3);
    expect(inst._factsScrollLine).toBe(3);

    inst._scrollFacts(3); // would go to 6, clamp to 3
    expect(inst._factsScrollLine).toBe(3);
  });

  test('_scrollFacts scrolls up and clamps at beginning', () => {
    const inst = buildInstance();
    inst._factsLines = Array.from({ length: 15 }, (_, i) => ({ text: `Line ${i}`, type: 'text', headingLevel: 0 }));
    inst._factsScrollLine = 3;

    inst._scrollFacts(-3);
    expect(inst._factsScrollLine).toBe(0);

    inst._scrollFacts(-3); // already at 0, stays 0
    expect(inst._factsScrollLine).toBe(0);
  });

  test('_onThumbstick: left stick up/down scrolls facts when panel is active (reversed direction)', () => {
    const inst = buildInstance();
    inst._factsActive = true;
    inst._scrollFacts = jest.fn();
    inst._stepCloser  = jest.fn();
    inst._stepFarther = jest.fn();

    // Stick up (y < -dz) → scroll down (show later lines)
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._leftHand });
    expect(inst._scrollFacts).toHaveBeenCalledWith(3);

    inst._scrollFacts.mockClear();
    inst._lastFactsScroll = 0; // reset cooldown
    // Stick down (y > dz) → scroll up (show earlier lines)
    inst._onThumbstick({ detail: { x: 0, y: 0.9 }, target: inst._leftHand });
    expect(inst._scrollFacts).toHaveBeenCalledWith(-3);

    // Zoom should NOT be triggered
    expect(inst._stepCloser).not.toHaveBeenCalled();
    expect(inst._stepFarther).not.toHaveBeenCalled();
  });

  test('_onThumbstick: right stick up/down also scrolls facts when panel is active', () => {
    const inst = buildInstance();
    inst._factsActive = true;
    inst._scrollFacts = jest.fn();
    inst._stepCloser  = jest.fn();
    inst._stepFarther = jest.fn();

    // Stick up (y < -dz) → scroll down (show later lines)
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._rightHand });
    expect(inst._scrollFacts).toHaveBeenCalledWith(3);

    inst._scrollFacts.mockClear();
    inst._lastFactsScroll = 0; // reset cooldown
    // Stick down (y > dz) → scroll up (show earlier lines)
    inst._onThumbstick({ detail: { x: 0, y: 0.9 }, target: inst._rightHand });
    expect(inst._scrollFacts).toHaveBeenCalledWith(-3);

    // Zoom should NOT be triggered
    expect(inst._stepCloser).not.toHaveBeenCalled();
    expect(inst._stepFarther).not.toHaveBeenCalled();
  });

  test('_renderFactsWindow adds bottom fade gradient when more lines exist below', () => {
    const inst = buildInstance();
    inst._factsMaxVisible = 5;
    inst._factsLines = Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i}`, type: 'text', headingLevel: 0 }));
    inst._factsScrollLine = 0; // 0 + 5 < 10 → hasMoreBelow = true

    inst._renderFactsWindow();

    const ctx = inst._factsCanvas.getContext();
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  test('_renderFactsWindow always adds bottom fade gradient even when all lines are visible', () => {
    const inst = buildInstance();
    inst._factsMaxVisible = 12;
    inst._factsLines = Array.from({ length: 5 }, (_, i) => ({ text: `Line ${i}`, type: 'text', headingLevel: 0 }));
    inst._factsScrollLine = 0; // 0 + 12 >= 5 → all lines visible

    inst._renderFactsWindow();

    // Gradient is always drawn to give the panel a polished faded-bottom appearance.
    const ctx = inst._factsCanvas.getContext();
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  test('_renderFactsWindow restores globalCompositeOperation and fillStyle after bottom fade', () => {
    const inst = buildInstance();
    inst._factsMaxVisible = 5;
    inst._factsLines = Array.from({ length: 10 }, (_, i) => ({ text: `Line ${i}`, type: 'text', headingLevel: 0 }));
    inst._factsScrollLine = 0;

    // Capture assignments to globalCompositeOperation to verify save/restore.
    const ctx = inst._factsCanvas.getContext();
    const compositeOps = [];
    Object.defineProperty(ctx, 'globalCompositeOperation', {
      get: () => compositeOps.length ? compositeOps[compositeOps.length - 1] : 'source-over',
      set: (v) => compositeOps.push(v),
      configurable: true,
    });

    inst._renderFactsWindow();

    // Should have set 'destination-out' then restored back to 'source-over'.
    expect(compositeOps).toContain('destination-out');
    const lastOp = compositeOps[compositeOps.length - 1];
    expect(lastOp).toBe('source-over');
  });

  test('_hideFactsFrame resets scroll state and hides loading bar', () => {
    const inst = buildInstance();
    inst._factsLines = ['a', 'b', 'c'];
    inst._factsScrollLine = 2;
    inst._factsActive = true;
    inst._factsFrameEl = null;
    inst._loadingBarEl = null;

    inst._hideFactsFrame();

    expect(inst._factsLines).toEqual([]);
    expect(inst._factsScrollLine).toBe(0);
    expect(inst._factsActive).toBe(false);
  });

  // ── Loading bar ──────────────────────────────────────────────────────────

  test('_showLoadingBar makes bar visible with pulse animation', () => {
    const inst = buildInstance();
    inst._loadingBarEl = {
      setAttribute: jest.fn(),
    };

    inst._showLoadingBar();

    expect(inst._loadingBarEl.setAttribute).toHaveBeenCalledWith('visible', true);
    expect(inst._loadingBarEl.setAttribute).toHaveBeenCalledWith('animation__pulse',
      expect.stringContaining('loop: true'));
  });

  test('_hideLoadingBar hides bar and removes animation', () => {
    const inst = buildInstance();
    inst._loadingBarEl = {
      setAttribute:    jest.fn(),
      removeAttribute: jest.fn(),
    };

    inst._hideLoadingBar();

    expect(inst._loadingBarEl.removeAttribute).toHaveBeenCalledWith('animation__pulse');
    expect(inst._loadingBarEl.setAttribute).toHaveBeenCalledWith('visible', false);
  });

  // ── Clipboard copy ───────────────────────────────────────────────────────

  test('_copyFactsToClipboard writes joined lines to navigator.clipboard', () => {
    const inst = buildInstance();
    inst._factsLines = [
      { text: 'Line 1', type: 'text' },
      { text: 'Line 2', type: 'text' },
      { text: 'Line 3', type: 'text' },
    ];
    const writeText = jest.fn(() => Promise.resolve());
    global.navigator = { clipboard: { writeText } };

    inst._copyFactsToClipboard();

    expect(writeText).toHaveBeenCalledWith('Line 1\nLine 2\nLine 3');
    delete global.navigator;
  });

  test('_copyFactsToClipboard does nothing when clipboard API is unavailable', () => {
    const inst = buildInstance();
    inst._factsLines = [{ text: 'Line 1', type: 'text' }];
    global.navigator = {};

    // Should not throw
    inst._copyFactsToClipboard();
    delete global.navigator;
  });

  // ── Thumbstick up / down → stepped zoom (both controllers) ─────────────

  test('_onThumbstick: stick up steps closer (both controllers, edge-triggered)', () => {
    const inst = buildInstance();
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };
    inst._updateZoomCanvas = jest.fn();

    // Left controller: first push (axis was neutral → steps in)
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._leftHand });
    expect(inst._zoomLevel).toBe(1);
    expect(inst._zoomAxisNeutral).toBe(false);
    expect(inst._zoomPlaneEl.setAttribute).toHaveBeenCalledWith('visible', true);

    // Holding the stick up without returning to neutral → no further step
    inst._zoomPlaneEl.setAttribute.mockClear();
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._leftHand });
    expect(inst._zoomLevel).toBe(1);

    // Return to neutral (axis reset)
    inst._onThumbstick({ detail: { x: 0, y: 0.0 }, target: inst._leftHand });
    expect(inst._zoomAxisNeutral).toBe(true);

    // Right controller: second push after neutral → steps in again
    inst._zoomPlaneEl.setAttribute.mockClear();
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._rightHand });
    expect(inst._zoomLevel).toBe(2);
    expect(inst._zoomPlaneEl.setAttribute).toHaveBeenCalledWith('visible', true);
  });

  test('_onThumbstick: stick down steps zoom out one level (edge-triggered)', () => {
    const inst = buildInstance();
    inst._zoomLevel = 2;
    inst._zoomAxisNeutral = true;
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };
    inst._updateZoomCanvas = jest.fn();

    inst._onThumbstick({ detail: { x: 0, y: 0.9 }, target: inst._leftHand });
    expect(inst._zoomLevel).toBe(1); // stepped down one level (not reset to 0)
    expect(inst._zoomPlaneEl.setAttribute).toHaveBeenCalledWith('visible', true);
  });

  test('_stepCloser does not exceed maximum zoom level', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 7; // already at max (8 steps: indices 0-7)

    inst._stepCloser();
    expect(inst._zoomLevel).toBe(7);
    expect(inst._zoomPlaneEl.setAttribute).not.toHaveBeenCalled();
  });

  test('_resetZoom does nothing when already at default', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 0;

    inst._resetZoom();
    expect(inst._zoomPlaneEl.setAttribute).not.toHaveBeenCalled();
  });

  test('_stepFarther decrements zoom level by one', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 3;
    inst._updateZoomCanvas = jest.fn();

    inst._stepFarther();
    expect(inst._zoomLevel).toBe(2);
    expect(inst._zoomPlaneEl.setAttribute).toHaveBeenCalledWith('visible', true);
  });

  test('_stepFarther hides plane when returning to level 0', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 1;
    inst._updateZoomCanvas = jest.fn();

    inst._stepFarther();
    expect(inst._zoomLevel).toBe(0);
    expect(inst._zoomPlaneEl.setAttribute).toHaveBeenCalledWith('visible', false);
  });

  test('_stepFarther does nothing when already at level 0', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 0;

    inst._stepFarther();
    expect(inst._zoomLevel).toBe(0);
    expect(inst._zoomPlaneEl.setAttribute).not.toHaveBeenCalled();
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
