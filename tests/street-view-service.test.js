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
    expect(svc.proxyUrl).toBe('/api');
    expect(svc.tileZoom).toBe(3);
  });

  it('accepts custom options', () => {
    const svc = new StreetViewService({ proxyUrl: '/proxy', tileZoom: 2 });
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

describe('StreetViewService.parseGoogleMapsUrl', () => {
  it('extracts panoId from data parameter', () => {
    const url = 'https://www.google.com/maps/@48.8584,2.2945,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sABC123XYZ!2e0!7i13312!8i6656';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).toEqual({ panoId: 'ABC123XYZ' });
  });

  it('extracts panoId from panoid query parameter', () => {
    const url = 'https://maps.google.com/maps?q=48.858,2.294&layer=c&panoid=MYPANOID';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).toEqual({ panoId: 'MYPANOID' });
  });

  it('extracts lat/lng from @ in pathname', () => {
    const url = 'https://www.google.com/maps/@48.8584,2.2945,17z';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result.lat).toBeCloseTo(48.8584);
    expect(result.lng).toBeCloseTo(2.2945);
  });

  it('extracts heading from pathname when present', () => {
    const url = 'https://www.google.com/maps/@48.8584,2.2945,3a,75y,135h,90t';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result.heading).toBeCloseTo(135);
  });

  it('extracts heading when it appears at the end of the pathname', () => {
    const url = 'https://www.google.com/maps/@48.8584,2.2945,3a,75y,270h';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result.heading).toBeCloseTo(270);
  });

  it('extracts lat/lng from cbll parameter', () => {
    const url = 'https://maps.google.com/maps?q=eiffel+tower&layer=c&cbll=48.858,2.294';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result.lat).toBeCloseTo(48.858);
    expect(result.lng).toBeCloseTo(2.294);
  });

  it('extracts lat/lng from bare q parameter', () => {
    const url = 'https://maps.google.com/maps?q=48.858,2.294';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result.lat).toBeCloseTo(48.858);
    expect(result.lng).toBeCloseTo(2.294);
  });

  it('returns null for an invalid URL', () => {
    expect(StreetViewService.parseGoogleMapsUrl('not a url')).toBeNull();
  });

  it('returns null when no location info is present', () => {
    const url = 'https://www.google.com/maps/place/Eiffel+Tower';
    expect(StreetViewService.parseGoogleMapsUrl(url)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(StreetViewService.parseGoogleMapsUrl('')).toBeNull();
  });
});

describe('StreetViewService._normaliseCbkData', () => {
  it('extracts panoId, description, latLng, and links', () => {
    const svc = new StreetViewService();
    const raw = {
      Location: {
        panoId:      'ABCDEF',
        description: 'Eiffel Tower, Paris',
        lat:         '48.858',
        lng:         '2.294',
      },
      Links: [
        { panoId: 'LINK1', heading: '45', description: 'North' },
        { panoId: 'LINK2', heading: '270', description: 'West' },
      ],
    };

    const result = svc._normaliseCbkData(raw);

    expect(result.panoId).toBe('ABCDEF');
    expect(result.description).toBe('Eiffel Tower, Paris');
    expect(result.latLng).toEqual({ lat: 48.858, lng: 2.294 });
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toEqual({ panoId: 'LINK1', heading: 45, description: 'North' });
  });

  it('handles missing Links gracefully', () => {
    const svc = new StreetViewService();
    const raw = {
      Location: { panoId: 'XYZ', description: '', lat: '0', lng: '0' },
    };

    const result = svc._normaliseCbkData(raw);
    expect(result.links).toEqual([]);
  });

  it('handles completely empty response', () => {
    const svc = new StreetViewService();
    const result = svc._normaliseCbkData({});
    expect(result.panoId).toBe('');
    expect(result.links).toEqual([]);
    expect(result.latLng).toEqual({ lat: 0, lng: 0 });
  });
});
