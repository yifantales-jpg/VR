/**
 * street-view-service.test.js
 *
 * Unit tests for the StreetViewService class (browser/Node.js shared code).
 * We test the public interface without making real network calls.
 */

'use strict';

const { StreetViewService } = require('../public/js/street-view-service');

describe('StreetViewService constructor', () => {
  it('sets defaults when no options provided', () => {
    const svc = new StreetViewService();
    expect(svc.apiKey).toBe('');
    expect(svc.proxyUrl).toBe('/api');
    expect(svc.tileZoom).toBe(3);
  });

  it('accepts custom options', () => {
    const svc = new StreetViewService({ apiKey: 'test-key', proxyUrl: '/proxy', tileZoom: 2 });
    expect(svc.apiKey).toBe('test-key');
    expect(svc.proxyUrl).toBe('/proxy');
    expect(svc.tileZoom).toBe(2);
  });

  it('clamps tileZoom below minimum to 1', () => {
    const svc = new StreetViewService({ tileZoom: 0 });
    expect(svc.tileZoom).toBe(1);
  });

  it('clamps tileZoom above maximum to 4', () => {
    const svc = new StreetViewService({ tileZoom: 99 });
    expect(svc.tileZoom).toBe(4);
  });
});

describe('StreetViewService._tileUrl', () => {
  it('builds a proxy tile URL with correct params', () => {
    const svc = new StreetViewService({ proxyUrl: '/api' });
    const url = svc._tileUrl('PANO123', 3, 4, 2);
    expect(url).toBe('/api/tile?panoid=PANO123&zoom=3&x=4&y=2');
  });

  it('URL-encodes the panoId', () => {
    const svc = new StreetViewService({ proxyUrl: '/api' });
    const url = svc._tileUrl('pano/with+special', 2, 0, 0);
    expect(url).toContain('panoid=pano%2Fwith%2Bspecial');
  });
});

describe('StreetViewService.loadMapsAPI', () => {
  it('rejects when no API key is provided and google is not loaded', async () => {
    const svc = new StreetViewService({ apiKey: '' });
    // Simulate browser environment where google.maps is not available.
    const originalGoogle = global.google;
    delete global.google;

    await expect(svc.loadMapsAPI()).rejects.toThrow('Google Maps API key is required');

    global.google = originalGoogle;
  });

  it('resolves immediately when google.maps is already loaded', async () => {
    const svc = new StreetViewService({ apiKey: 'dummy' });
    // Simulate already-loaded Maps SDK.
    global.google = { maps: {} };
    svc._mapsReady = true;

    await expect(svc.loadMapsAPI()).resolves.toBeUndefined();

    delete global.google;
  });
});

describe('StreetViewService._normalisePanoData', () => {
  it('extracts panoId, description, latLng, and links', () => {
    const svc = new StreetViewService();
    const raw = {
      location: {
        pano: 'ABCDEF',
        description: 'Eiffel Tower, Paris',
        latLng: { lat: () => 48.858, lng: () => 2.294 },
      },
      links: [
        { pano: 'LINK1', heading: 45, description: 'North' },
        { pano: 'LINK2', heading: 270, description: 'West' },
      ],
      copyright: '© Google',
      tiles: null,
    };

    const result = svc._normalisePanoData(raw);

    expect(result.panoId).toBe('ABCDEF');
    expect(result.description).toBe('Eiffel Tower, Paris');
    expect(result.latLng).toEqual({ lat: 48.858, lng: 2.294 });
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toEqual({ panoId: 'LINK1', heading: 45, description: 'North' });
    expect(result.copyright).toBe('© Google');
  });

  it('handles missing links gracefully', () => {
    const svc = new StreetViewService();
    const raw = {
      location: {
        pano: 'XYZ',
        description: '',
        latLng: { lat: () => 0, lng: () => 0 },
      },
      copyright: '',
      tiles: null,
      // no `links` property
    };

    const result = svc._normalisePanoData(raw);
    expect(result.links).toEqual([]);
  });
});
