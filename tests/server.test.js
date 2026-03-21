/**
 * server.test.js
 *
 * Integration tests for the Node.js proxy server.
 * Tests use supertest to send HTTP requests without starting a real server.
 */

'use strict';

const request = require('supertest');
const app     = require('../server');

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/tile', () => {
  it('returns 400 when panoid is missing', async () => {
    const res = await request(app).get('/api/tile?zoom=2&x=0&y=0');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when zoom is out of range', async () => {
    const res = await request(app).get('/api/tile?panoid=abc123&zoom=9&x=0&y=0');
    expect(res.status).toBe(400);
  });

  it('returns 400 when x exceeds bounds for zoom', async () => {
    // zoom=1 → maxCols=2, so x=5 is out of range
    const res = await request(app).get('/api/tile?panoid=abc123&zoom=1&x=5&y=0');
    expect(res.status).toBe(400);
  });

  it('returns 400 when panoid contains invalid characters', async () => {
    const res = await request(app).get('/api/tile?panoid=../../etc/passwd&zoom=2&x=0&y=0');
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative x', async () => {
    const res = await request(app).get('/api/tile?panoid=abc123&zoom=2&x=-1&y=0');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/pano', () => {
  it('returns 400 when neither panoid nor ll is provided', async () => {
    const res = await request(app).get('/api/pano');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for invalid panoid characters', async () => {
    const res = await request(app).get('/api/pano?panoid=../../etc/passwd');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid ll format', async () => {
    const res = await request(app).get('/api/pano?ll=not_a_coord');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid location format/);
  });

  it('returns 400 for ll with only one coordinate', async () => {
    const res = await request(app).get('/api/pano?ll=48.858');
    expect(res.status).toBe(400);
  });
});

describe('Static file serving', () => {
  it('serves index.html at root', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });

  it('serves index.html for unknown routes (SPA fallback)', async () => {
    const res = await request(app).get('/some/unknown/path');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<!DOCTYPE html>');
  });
});
