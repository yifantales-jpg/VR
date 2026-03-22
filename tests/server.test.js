/**
 * server.test.js
 *
 * Integration tests for the Node.js proxy server.
 * Tests use supertest to send HTTP requests without starting a real server.
 */

'use strict';

const https      = require('https');
const request    = require('supertest');
const selfsigned = require('selfsigned');
const app        = require('../server');

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

describe('GET /api/photo', () => {
  it('returns 400 when url parameter is missing', async () => {
    const res = await request(app).get('/api/photo');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url parameter required/);
  });

  it('returns 400 for a non-Google image hosting URL', async () => {
    const res = await request(app).get('/api/photo?url=https://example.com/image.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only Google image hosting/);
  });

  it('returns 400 for an invalid (non-URL) value', async () => {
    const res = await request(app).get('/api/photo?url=not-a-url');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid URL/);
  });

  it('returns 400 for a URL on a subdomain of googleusercontent.com', async () => {
    const res = await request(app).get('/api/photo?url=https://evil.lh3.googleusercontent.com/image');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only Google image hosting/);
  });

  it('returns 400 for lh3.googleusercontent.com with a path prefix attack', async () => {
    const res = await request(app).get('/api/photo?url=https://lh3.googleusercontent.com.evil.com/image');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only Google image hosting/);
  });

  // The proxy now accepts lh4, lh5, etc. in addition to lh3 — all are
  // legitimate Google image-hosting subdomains used for Photo Spheres.
  it('accepts lh4.googleusercontent.com URLs (passes domain check)', async () => {
    // The proxy will attempt to fetch from Google; we only verify it passes the
    // domain-validation step (i.e., does NOT return 400) rather than a successful
    // image fetch (which would require a live network call).
    const res = await request(app).get(
      '/api/photo?url=https://lh4.googleusercontent.com/gpms-cs-s/SomePhotoId=w4096-h2048-k-no'
    );
    // Must not be rejected as an invalid domain (400).
    expect(res.status).not.toBe(400);
  });

  it('accepts lh5.googleusercontent.com URLs (passes domain check)', async () => {
    const res = await request(app).get(
      '/api/photo?url=https://lh5.googleusercontent.com/gpms-cs-s/SomePhotoId=w4096-h2048-k-no'
    );
    expect(res.status).not.toBe(400);
  });
});

describe('GET /api/resolve', () => {
  it('returns 400 when url parameter is missing', async () => {
    const res = await request(app).get('/api/resolve');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url parameter required/);
  });

  it('returns 400 for an invalid (non-URL) value', async () => {
    const res = await request(app).get('/api/resolve?url=not-a-url');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid URL/);
  });

  it('returns 400 for a URL from a non-allowed host', async () => {
    const res = await request(app).get(
      '/api/resolve?url=https://example.com/some-path'
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/host not supported/);
  });

  it('returns 400 for a non-HTTP/HTTPS scheme', async () => {
    const res = await request(app).get(
      '/api/resolve?url=ftp://maps.app.goo.gl/abc'
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only HTTP\/HTTPS/);
  });

  it('accepts maps.app.goo.gl URLs (passes host validation)', async () => {
    // The endpoint will attempt a real HEAD request; since we have no network
    // in test, we only verify it passes host validation (status is not 400).
    const res = await request(app).get(
      '/api/resolve?url=https://maps.app.goo.gl/bNzkVyTavYD2j4oz9'
    );
    expect(res.status).not.toBe(400);
  });

  it('accepts t.co URLs (passes host validation)', async () => {
    const res = await request(app).get(
      '/api/resolve?url=https://t.co/ReojxnBtnl'
    );
    expect(res.status).not.toBe(400);
  });

  it('accepts goo.gl URLs (passes host validation)', async () => {
    const res = await request(app).get(
      '/api/resolve?url=https://goo.gl/maps/abc123'
    );
    expect(res.status).not.toBe(400);
  });
});

describe('POST /api/ai-facts', () => {
  const savedKey = process.env.META_AI_API_KEY;

  afterEach(() => {
    // Restore the env var after each test.
    if (savedKey === undefined) {
      delete process.env.META_AI_API_KEY;
    } else {
      process.env.META_AI_API_KEY = savedKey;
    }
  });

  it('returns 503 when META_AI_API_KEY is not set', async () => {
    delete process.env.META_AI_API_KEY;
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image: 'data:image/jpeg;base64,abc123', description: 'Paris' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/META_AI_API_KEY/);
  });

  it('returns 400 when image field is missing', async () => {
    process.env.META_AI_API_KEY = 'test-key';
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ description: 'Paris' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image field required/);
  });

  it('returns 400 when image is not a data URL', async () => {
    process.env.META_AI_API_KEY = 'test-key';
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image: 'https://example.com/photo.jpg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image field required/);
  });

  it('returns 400 when image field is not a string', async () => {
    process.env.META_AI_API_KEY = 'test-key';
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/image field required/);
  });

  it('returns 400 when request body is empty', async () => {
    process.env.META_AI_API_KEY = 'test-key';
    const res = await request(app)
      .post('/api/ai-facts')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res.status).toBe(400);
  });

  it('attempts upstream call when API key and valid image are provided (network may fail)', async () => {
    process.env.META_AI_API_KEY = 'test-key';
    // A minimal valid data URL so validation passes.
    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower' });
    // In a test environment with no real Llama API access the upstream call
    // will fail; we only verify it passed the server-side validation stage
    // (i.e., NOT a 400 or 503 which would indicate our input validation failed).
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(503);
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

  it('includes Permissions-Policy header allowing xr-spatial-tracking', async () => {
    const res = await request(app).get('/');
    expect(res.headers['permissions-policy']).toBe('xr-spatial-tracking=*');
  });
});

describe('HTTPS server', () => {
  it('serves requests over HTTPS with a self-signed certificate', (done) => {
    selfsigned.generate(
      [{ name: 'commonName', value: 'localhost' }],
      { days: 1, algorithm: 'sha256' }
    ).then((pems) => {
      const tlsServer = https.createServer({ cert: pems.cert, key: pems.private }, app);

      tlsServer.listen(0, () => {
        const port = tlsServer.address().port;

        // Use the self-signed certificate as the trusted CA so we don't need
        // to disable certificate validation entirely.
        const req = https.get(
          { hostname: '127.0.0.1', port, path: '/health', ca: pems.cert },
          (res) => {
            expect(res.statusCode).toBe(200);
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              expect(JSON.parse(body).status).toBe('ok');
              tlsServer.close(done);
            });
          }
        );
        req.on('error', (err) => { tlsServer.close(() => done(err)); });
      });
    }).catch(done);
  });
});
