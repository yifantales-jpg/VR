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

  // Side length of the crop square (panoW/16).
  const SIDE = Math.floor(4096 / 16); // 256

  test('looking forward with sky rotation y=-90° crops at u=0 (north)', () => {
    // u=0 → srcX = 0*4096 - 256/2 = -128 → wraps: draws from panoW-128=3968
    const { inst, drawCalls } = buildSnapshotInstance(-90, { x: 0, y: 0, z: -1 });
    inst._updateSnapshotCanvas();

    expect(drawCalls.length).toBe(2); // horizontal seam wrap
    // First call: the wrapped left slice starting at panoW + srcX
    expect(drawCalls[0][1]).toBeCloseTo(4096 - SIDE / 2, 0);
  });

  test('looking backward with sky rotation y=-90° crops at u=0.5 (south)', () => {
    // u=0.5 → srcX = 0.5*4096 - 128 = 2048-128 = 1920 → no wrap
    const { inst, drawCalls } = buildSnapshotInstance(-90, { x: 0, y: 0, z: 1 });
    inst._updateSnapshotCanvas();

    expect(drawCalls.length).toBe(1);
    expect(drawCalls[0][1]).toBeCloseTo(0.5 * 4096 - SIDE / 2, 0);
  });

  test('looking forward with no sky rotation crops at u=0.75', () => {
    // skyYRad=0, forward -Z → sky local -Z → phi=3π/2 → u=0.75
    // srcX = 0.75*4096 - 128 = 3072-128 = 2944 → no wrap (2944+256=3200 < 4096)
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

  test('horizontally flips the crop to match inside-sphere mirroring', () => {
    const { inst, snapCtx } = buildSnapshotInstance(0, { x: 0, y: 0, z: -1 });
    inst._updateSnapshotCanvas();

    expect(snapCtx.save).toHaveBeenCalled();
    expect(snapCtx.translate).toHaveBeenCalledWith(512, 0);
    expect(snapCtx.scale).toHaveBeenCalledWith(-1, 1);
    expect(snapCtx.restore).toHaveBeenCalled();
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
    instance._zoomSteps       = [1, 0.7, 0.5, 0.35];
    instance._zoomLevel       = 0;
    instance._lastZoom        = 0;
    // Use plain objects as hand references so identity checks work.
    instance._leftHand  = { _id: 'left-hand' };
    instance._rightHand = { _id: 'right-hand' };
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
    inst._factsTextEl  = { setAttribute: jest.fn() };
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

  test('_showFactsFrame: shows loading bar and clears text when called without text', () => {
    const inst = buildInstance();
    inst._factsTextEl = { setAttribute: jest.fn() };
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
    // Previous text should be cleared.
    expect(inst._factsTextEl.setAttribute).toHaveBeenCalledWith('value', '');
    expect(inst._factsLines).toEqual([]);
    expect(inst._factsScrollLine).toBe(0);
  });

  test('_updateFactsText strips markdown and renders visible window', () => {
    const inst = buildInstance();
    inst._factsTextEl = { setAttribute: jest.fn() };
    inst._factsLines = [];
    inst._factsScrollLine = 0;
    inst._factsMaxVisible = 12;

    const cases = [
      {
        input: 'First sentence.\nSecond sentence.',
        expected: 'First sentence.\nSecond sentence.',
      },
      {
        input: 'First sentence.\n\n  Second sentence.',
        expected: 'First sentence.\n\nSecond sentence.',
      },
      {
        input: 'First  sentence.  Second  sentence.',
        expected: 'First sentence. Second sentence.',
      },
      {
        input: 'Single sentence only.',
        expected: 'Single sentence only.',
      },
      {
        input: '',
        expected: '',
      },
      {
        input: '## Heading\n\n**bold** and *italic*',
        expected: 'Heading\n\nbold and italic',
      },
    ];

    cases.forEach(({ input, expected }) => {
      inst._updateFactsText(input);
      expect(inst._factsTextEl.setAttribute).toHaveBeenLastCalledWith('value', expected);
    });
  });

  test('_updateFactsText preserves non-string inputs', () => {
    const inst = buildInstance();
    inst._factsTextEl = { setAttribute: jest.fn() };
    inst._factsLines = [];
    inst._factsScrollLine = 0;
    inst._factsMaxVisible = 12;

    inst._updateFactsText(42);

    expect(inst._factsTextEl.setAttribute).toHaveBeenCalledWith('value', 42);
  });

  test('_setupFactsFrame creates text panel with background and loading bar', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);
    inst._cameraEl = { appendChild: jest.fn() };

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

    expect(inst._factsFrameEl.attributes.position).toBe('0 -0.18 -0.7');

    // Background panel is created.
    expect(inst._factsBgEl).toBeDefined();
    expect(inst._factsBgEl.tag).toBe('a-plane');
    expect(inst._factsBgEl.attributes.width).toBe('0.62');
    expect(inst._factsBgEl.attributes.height).toBe('0.42');

    // Text element attributes (no outline-color / outline-width).
    expect(inst._factsTextEl.attributes.align).toBe('left');
    expect(inst._factsTextEl.attributes.anchor).toBe('center');
    expect(inst._factsTextEl.attributes.baseline).toBe('top');
    expect(inst._factsTextEl.attributes.color).toBe('#ffffff');
    expect(inst._factsTextEl.attributes.position).toBe('0 0.17 0.002');
    expect(inst._factsTextEl.attributes.width).toBe('0.55');
    expect(inst._factsTextEl.attributes['wrap-count']).toBe('55');
    expect(inst._factsTextEl.attributes['outline-color']).toBeUndefined();
    expect(inst._factsTextEl.attributes['outline-width']).toBeUndefined();

    // Loading bar is created.
    expect(inst._loadingBarEl).toBeDefined();
    expect(inst._loadingBarEl.tag).toBe('a-plane');
    expect(inst._loadingBarEl.attributes.visible).toBe(false);

    expect(inst._cameraEl.appendChild).toHaveBeenCalledWith(inst._factsFrameEl);

    global.document = originalDocument;
  });

  // ── Scrolling ───────────────────────────────────────────────────────────

  test('_wrapText breaks long text into lines of at most maxChars', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    const lines = inst._wrapText('one two three four five six', 10);
    expect(lines).toEqual(['one two', 'three four', 'five six']);
  });

  test('_wrapText collapses consecutive blank lines into a single blank line for paragraph spacing', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    const lines = inst._wrapText('para one\n\n\npara two', 55);
    expect(lines).toEqual(['para one', '', 'para two']);
  });

  test('_stripMarkdown removes heading markers, bold, italic, inline code, and links', () => {
    const comp = registeredComponents['vr-controller-input'];
    const inst = Object.create(comp.Component.prototype);

    expect(inst._stripMarkdown('## Heading')).toBe('Heading');
    expect(inst._stripMarkdown('**bold**')).toBe('bold');
    expect(inst._stripMarkdown('*italic*')).toBe('italic');
    expect(inst._stripMarkdown('`code`')).toBe('code');
    expect(inst._stripMarkdown('[link](http://example.com)')).toBe('link');
    expect(inst._stripMarkdown('- item')).toBe('• item');
  });

  test('_scrollFacts scrolls down and clamps at end', () => {
    const inst = buildInstance();
    inst._factsTextEl = { setAttribute: jest.fn() };
    // 15 lines total, 12 visible → max start = 3
    inst._factsLines = Array.from({ length: 15 }, (_, i) => `Line ${i}`);
    inst._factsScrollLine = 0;

    inst._scrollFacts(3);
    expect(inst._factsScrollLine).toBe(3);

    inst._scrollFacts(3); // would go to 6, clamp to 3
    expect(inst._factsScrollLine).toBe(3);
  });

  test('_scrollFacts scrolls up and clamps at beginning', () => {
    const inst = buildInstance();
    inst._factsTextEl = { setAttribute: jest.fn() };
    inst._factsLines = Array.from({ length: 15 }, (_, i) => `Line ${i}`);
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
    inst._resetZoom   = jest.fn();

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
    expect(inst._resetZoom).not.toHaveBeenCalled();
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
    inst._factsLines = ['Line 1', 'Line 2', 'Line 3'];
    const writeText = jest.fn(() => Promise.resolve());
    global.navigator = { clipboard: { writeText } };

    inst._copyFactsToClipboard();

    expect(writeText).toHaveBeenCalledWith('Line 1\nLine 2\nLine 3');
    delete global.navigator;
  });

  test('_copyFactsToClipboard does nothing when clipboard API is unavailable', () => {
    const inst = buildInstance();
    inst._factsLines = ['Line 1'];
    global.navigator = {};

    // Should not throw
    inst._copyFactsToClipboard();
    delete global.navigator;
  });

  // ── Thumbstick up / down → stepped zoom (both controllers) ─────────────

  test('_onThumbstick: stick up steps closer (both controllers)', () => {
    const inst = buildInstance();
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };

    // Left controller
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._leftHand });
    expect(inst._zoomLevel).toBe(1);
    expect(inst.el.setAttribute).toHaveBeenCalledWith('scale', { x: 0.7, y: 0.7, z: 0.7 });

    // Right controller
    inst._lastZoom = 0;
    inst._onThumbstick({ detail: { x: 0, y: -0.9 }, target: inst._rightHand });
    expect(inst._zoomLevel).toBe(2);
    expect(inst.el.setAttribute).toHaveBeenCalledWith('scale', { x: 0.5, y: 0.5, z: 0.5 });
  });

  test('_onThumbstick: stick down resets zoom to default', () => {
    const inst = buildInstance();
    inst._zoomLevel = 2;
    inst.el = {
      getAttribute: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
      setAttribute: jest.fn(),
    };

    inst._onThumbstick({ detail: { x: 0, y: 0.9 }, target: inst._leftHand });
    expect(inst._zoomLevel).toBe(0);
    expect(inst.el.setAttribute).toHaveBeenCalledWith('scale', { x: 1, y: 1, z: 1 });
  });

  test('_stepCloser does not exceed maximum zoom level', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 3; // already at max

    inst._stepCloser();
    expect(inst._zoomLevel).toBe(3);
    expect(inst.el.setAttribute).not.toHaveBeenCalled();
  });

  test('_resetZoom does nothing when already at default', () => {
    const inst = buildInstance();
    inst.el = { setAttribute: jest.fn() };
    inst._zoomLevel = 0;

    inst._resetZoom();
    expect(inst.el.setAttribute).not.toHaveBeenCalled();
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
