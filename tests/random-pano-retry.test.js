/**
 * random-pano-retry.test.js
 *
 * Tests for the retry logic in GET /api/random-pano.
 * The endpoint tries up to MAX_RANDOM_PANO_ATTEMPTS different locations
 * before giving up, so a single CBK miss or transient error does not
 * immediately surface a 502 to the user.
 */

'use strict';

jest.mock('node-fetch', () => jest.fn());

const request = require('supertest');
const fetch   = require('node-fetch');
const app     = require('../server');

/** Build a minimal CBK JSON response with a panoId. */
function cbkResponse(panoId) {
  return { Location: { panoId } };
}

/** Create a mock fetch Response resolving to the provided JSON body. */
function mockJsonResponse(body, status = 200) {
  return {
    ok:   status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Create a mock fetch Response with no valid body (for non-ok statuses). */
function mockErrorResponse(status) {
  return {
    ok:   false,
    status,
    json: async () => ({}),
    text: async () => '',
  };
}

describe('GET /api/random-pano retry logic', () => {
  afterEach(() => {
    fetch.mockReset();
  });

  it('returns 200 with panoId when the first CBK attempt succeeds', async () => {
    fetch.mockResolvedValue(mockJsonResponse(cbkResponse('test-pano-id-1')));

    const res = await request(app).get('/api/random-pano');

    expect(res.status).toBe(200);
    expect(res.body.panoId).toBe('test-pano-id-1');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds when the first attempt returns a non-ok status', async () => {
    fetch
      .mockResolvedValueOnce(mockErrorResponse(404))
      .mockResolvedValue(mockJsonResponse(cbkResponse('test-pano-id-2')));

    const res = await request(app).get('/api/random-pano');

    expect(res.status).toBe(200);
    expect(res.body.panoId).toBe('test-pano-id-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries and succeeds when the first attempt returns a response with no panoId', async () => {
    fetch
      .mockResolvedValueOnce(mockJsonResponse({ Location: {} }))
      .mockResolvedValue(mockJsonResponse(cbkResponse('test-pano-id-3')));

    const res = await request(app).get('/api/random-pano');

    expect(res.status).toBe(200);
    expect(res.body.panoId).toBe('test-pano-id-3');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries and succeeds when the first attempt throws a network error', async () => {
    fetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(mockJsonResponse(cbkResponse('test-pano-id-4')));

    const res = await request(app).get('/api/random-pano');

    expect(res.status).toBe(200);
    expect(res.body.panoId).toBe('test-pano-id-4');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns 502 only after all retry attempts are exhausted', async () => {
    // All 5 attempts fail.
    fetch.mockRejectedValue(new Error('ENOTFOUND cbk0.google.com'));

    const res = await request(app).get('/api/random-pano');

    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
    // Should have tried MAX_RANDOM_PANO_ATTEMPTS (5) times.
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('each CBK request targets cbk0.google.com', async () => {
    fetch.mockResolvedValue(mockJsonResponse(cbkResponse('test-pano-id-5')));

    await request(app).get('/api/random-pano');

    const [calledUrl] = fetch.mock.calls[0];
    expect(calledUrl).toContain('cbk0.google.com/cbk');
    expect(calledUrl).toContain('output=json');
    expect(calledUrl).toContain('ll=');
  });
});
