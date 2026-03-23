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
    expect(result).toMatchObject({ panoId: 'ABC123XYZ', lat: 48.8584, lng: 2.2945 });
  });

  it('decodes percent-encoded panoId from data parameter', () => {
    const url = 'https://www.google.com/maps/@48.8584,2.2945,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sF%3A-DsZwXRcGh!2e0!7i16384!8i8192';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).toMatchObject({ panoId: 'F:-DsZwXRcGh', lat: 48.8584, lng: 2.2945 });
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

  it('extracts panoId and photoUrl from a user-contributed Photo Sphere URL', () => {
    // URL containing !2e10 (Photo Sphere type), !3e11 flags, and a !6s direct image URL.
    const url =
      'https://www.google.com/maps/@31.8425117,35.4112367,3a,90y,203.46h,1t' +
      '/data=!3m8!1e1!3m6!1sCIHM0ogKEICAgICW6pqIgwE!2e10!3e11' +
      '!6shttps:%2F%2Flh3.googleusercontent.com%2Fgpms-cs-s%2FTestPhotoId' +
      '%3Dw900-h600-k-no-pi89-ya203.46386887232327-ro0-fo100!7i14400!8i7200' +
      '?entry=ttu';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).not.toBeNull();
    expect(result.panoId).toBe('CIHM0ogKEICAgICW6pqIgwE');
    expect(result.photoUrl).toBe('https://lh3.googleusercontent.com/gpms-cs-s/TestPhotoId');
    expect(result.photoWidth).toBe(14400);
    expect(result.photoHeight).toBe(7200);
  });

  it('extracts photoUrl from a Photo Sphere hosted on lh4.googleusercontent.com', () => {
    // Google may serve Photo Spheres from lh4, lh5, lh6, etc. — all should be detected.
    const url =
      'https://www.google.com/maps/@31.8425117,35.4112367,3a,90y,203.46h,1t' +
      '/data=!3m8!1e1!3m6!1sPANO456!2e10!3e11' +
      '!6shttps:%2F%2Flh4.googleusercontent.com%2Fgpms-cs-s%2FAnotherPhotoId' +
      '%3Dw900-h600-k-no!7i14400!8i7200';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).not.toBeNull();
    expect(result.panoId).toBe('PANO456');
    expect(result.photoUrl).toBe('https://lh4.googleusercontent.com/gpms-cs-s/AnotherPhotoId');
    expect(result.photoWidth).toBe(14400);
    expect(result.photoHeight).toBe(7200);
  });

  it('returns only panoId (no photoUrl) for a standard Street View URL', () => {
    const url = 'https://www.google.com/maps/@48.8584,2.2945,3a,75y,90h,90t/data=!3m6!1e1!3m4!1sABC123XYZ!2e0!7i13312!8i6656';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).toMatchObject({ panoId: 'ABC123XYZ', lat: 48.8584, lng: 2.2945 });
    expect(result.photoUrl).toBeUndefined();
  });

  it('ignores non-Google photo hosting URLs in !6s', () => {
    // A !6s value that does NOT point to lhN.googleusercontent.com should be ignored.
    const url =
      'https://www.google.com/maps/@48.8584,2.2945,3a,75y,90h,90t' +
      '/data=!3m6!1e1!3m4!1sABC123XYZ!2e0!6shttps:%2F%2Fexample.com%2Fimage.jpg!7i13312!8i6656';
    const result = StreetViewService.parseGoogleMapsUrl(url);
    expect(result).toMatchObject({ panoId: 'ABC123XYZ', lat: 48.8584, lng: 2.2945 });
    expect(result.photoUrl).toBeUndefined();
  });
});

describe('StreetViewService._extractPhotoDimensions', () => {
  it('extracts width and height from !7i and !8i segments', () => {
    const dataStr = '!3m8!1e1!3m6!1sPANO!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fimg!7i14400!8i7200';
    const result = StreetViewService._extractPhotoDimensions(dataStr);
    expect(result).toEqual({ photoWidth: 14400, photoHeight: 7200 });
  });

  it('returns empty object when !7i / !8i are absent', () => {
    const dataStr = '!3m8!1e1!3m6!1sPANO!2e10!3e11!6shttps:%2F%2Flh3.googleusercontent.com%2Fimg';
    const result = StreetViewService._extractPhotoDimensions(dataStr);
    expect(result).toEqual({});
  });

  it('returns empty object when only one dimension is present', () => {
    expect(StreetViewService._extractPhotoDimensions('!7i14400')).toEqual({});
    expect(StreetViewService._extractPhotoDimensions('!8i7200')).toEqual({});
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

describe('StreetViewService._runWithConcurrency', () => {
  it('runs all tasks and resolves when done', async () => {
    const svc = new StreetViewService();
    const results = [];
    const tasks = [1, 2, 3, 4, 5].map(n => () => Promise.resolve().then(() => results.push(n)));
    await svc._runWithConcurrency(tasks, 2);
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    const svc = new StreetViewService();
    let inFlight = 0;
    let maxObserved = 0;
    const delay = ms => new Promise(res => setTimeout(res, ms));
    const tasks = Array.from({ length: 10 }, () => async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await delay(5);
      inFlight--;
    });
    await svc._runWithConcurrency(tasks, 3);
    expect(maxObserved).toBeLessThanOrEqual(3);
  });

  it('handles an empty task list', async () => {
    const svc = new StreetViewService();
    await expect(svc._runWithConcurrency([], 4)).resolves.toBeDefined();
  });
});

describe('StreetViewService.stitchPanorama', () => {
  it('sets canvas dimensions and paints all tiles', async () => {
    const svc = new StreetViewService({ tileZoom: 2 }); // 4 cols × 2 rows = 8 tiles
    // Stub _loadTile to return a minimal image-like object without network access.
    svc._loadTile = (_panoId, _zoom, _x, _y) =>
      Promise.resolve({ naturalWidth: 512, naturalHeight: 512 });

    const ctx = {
      drawImage: jest.fn(),
      fillRect:  jest.fn(),
    };
    const canvas = {
      getContext: () => ctx,
    };

    let progressCalls = 0;
    await svc.stitchPanorama('PANO123', canvas, () => { progressCalls++; });

    expect(canvas.width).toBe(4 * 512);   // 2048
    expect(canvas.height).toBe(2 * 512);  // 1024
    expect(ctx.drawImage).toHaveBeenCalledTimes(8);
    expect(progressCalls).toBe(8);
  });

  it('calls onProgress once per tile even when tiles fail', async () => {
    const svc = new StreetViewService({ tileZoom: 1 }); // 2 cols × 1 row = 2 tiles
    svc._loadTile = () => Promise.reject(new Error('network error'));

    const ctx = { drawImage: jest.fn(), fillStyle: '', fillRect: jest.fn() };
    const canvas = { getContext: () => ctx };

    let progressCalls = 0;
    await svc.stitchPanorama('PANO', canvas, () => { progressCalls++; });

    expect(progressCalls).toBe(2);
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
  });
});

describe('StreetViewService.fetchPanoData with photoUrl', () => {
  it('returns synthetic PanoramaData immediately without a network call when photoUrl is provided', async () => {
    const svc = new StreetViewService();
    const photoUrl = 'https://lh3.googleusercontent.com/gpms-cs-s/TestPhotoId';
    const result = await svc.fetchPanoData({ panoId: 'CIHM0ogKEICAgICW6pqIgwE', photoUrl, photoWidth: 14400, photoHeight: 7200 });

    expect(result.panoId).toBe('CIHM0ogKEICAgICW6pqIgwE');
    expect(result.photoUrl).toBe(photoUrl);
    expect(result.photoWidth).toBe(14400);
    expect(result.photoHeight).toBe(7200);
    expect(result.links).toEqual([]);
    expect(result.latLng).toEqual({ lat: 0, lng: 0 });
  });

  it('includes photoUrl in the returned object for caller to use directly', async () => {
    const svc = new StreetViewService();
    const photoUrl = 'https://lh3.googleusercontent.com/gpms-cs-s/AnotherPhoto';
    const result = await svc.fetchPanoData({ photoUrl });
    expect(result.photoUrl).toBe(photoUrl);
    expect(result.panoId).toBe('');
  });

  it('preserves undefined photoWidth/photoHeight when dimensions are not provided', async () => {
    const svc = new StreetViewService();
    const photoUrl = 'https://lh3.googleusercontent.com/gpms-cs-s/Nodims';
    const result = await svc.fetchPanoData({ photoUrl });
    expect(result.photoWidth).toBeUndefined();
    expect(result.photoHeight).toBeUndefined();
  });
});
