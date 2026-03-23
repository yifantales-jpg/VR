/**
 * ai-facts-response.test.js
 *
 * Focused tests for /api/ai-facts response assembly and prompt wording.
 * The endpoint uses a non-streaming generateContent request and returns
 * a single JSON response.
 */

'use strict';

jest.mock('node-fetch', () => jest.fn());

const request = require('supertest');
const fetch   = require('node-fetch');
const app     = require('../server');

// ── Gemini response builder ───────────────────────────────────────────────────

/**
 * Build a minimal Gemini generateContent JSON response with the given parts.
 */
function geminiResponse(parts) {
  return { candidates: [{ content: { parts, role: 'model' } }] };
}

/**
 * Create a mock fetch Response that resolves to the provided JSON body.
 */
function mockJsonResponse(body, status = 200) {
  return {
    ok:   status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/ai-facts response assembly (non-streaming JSON)', () => {
  const savedKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    fetch.mockReset();
    if (savedKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedKey;
    }
  });

  it('returns full response text and uses "You are looking at" prompt', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'You are looking at the Eiffel Tower. It was completed in 1889.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower' });

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/application\/json/);
    expect(res.body.text).toBe('You are looking at the Eiffel Tower. It was completed in 1889.');

    const requestBody  = JSON.parse(fetch.mock.calls[0][1].body);
    const requestParts = requestBody.contents && requestBody.contents[0] && requestBody.contents[0].parts;
    expect(Array.isArray(requestParts)).toBe(true);
    const promptPart = requestParts.find((part) => part && typeof part.text === 'string');
    expect(promptPart).toBeTruthy();
    expect(promptPart.text).toContain('Begin your response with "You are looking at..."');
  });

  it('uses the non-streaming generateContent endpoint URL', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'You are looking at something.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    await request(app).post('/api/ai-facts').send({ image });

    const [calledUrl] = fetch.mock.calls[0];
    expect(calledUrl).toContain('generateContent');
    expect(calledUrl).not.toContain('streamGenerateContent');
    expect(calledUrl).not.toContain('alt=sse');
  });

  it('joins multiple text parts into a single response', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'You are looking at the Eiffel Tower. ' },
      { text: 'It was completed in 1889.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('You are looking at the Eiffel Tower. It was completed in 1889.');
  });

  it('includes GPS coordinates in the prompt when provided', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'You are looking at the Eiffel Tower.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower', coordinates: { lat: 48.858370, lng: 2.294481 } });

    const requestBody  = JSON.parse(fetch.mock.calls[0][1].body);
    const requestParts = requestBody.contents[0].parts;
    const promptText   = requestParts.find((p) => typeof p.text === 'string').text;
    expect(promptText).toContain('48.858370');
    expect(promptText).toContain('2.294481');
  });

  it('omits GPS hint from prompt when coordinates are out of range or invalid', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'You are looking at something.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Somewhere', coordinates: { lat: 999, lng: 999 } });

    const requestBody  = JSON.parse(fetch.mock.calls[0][1].body);
    const requestParts = requestBody.contents[0].parts;
    const promptText   = requestParts.find((p) => typeof p.text === 'string').text;
    expect(promptText).not.toContain('GPS');
  });

  it('omits GPS hint from prompt when coordinates are 0,0 (null island)', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'You are looking at something.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    await request(app)
      .post('/api/ai-facts')
      .send({ image, coordinates: { lat: 0, lng: 0 } });

    const requestBody  = JSON.parse(fetch.mock.calls[0][1].body);
    const requestParts = requestBody.contents[0].parts;
    const promptText   = requestParts.find((p) => typeof p.text === 'string').text;
    expect(promptText).not.toContain('GPS');
  });

  it('filters out thought parts from Gemini 2.5 thinking model responses', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse(geminiResponse([
      { text: 'Let me analyze this image...', thought: true },
      { text: 'I can see a tower structure.',  thought: true },
      { text: 'You are looking at the Eiffel Tower. ' },
      { text: 'It was completed in 1889.' },
    ])));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower' });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('You are looking at the Eiffel Tower. It was completed in 1889.');
  });

  it('returns 502 with error JSON when Gemini upstream returns a non-OK status', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse({ error: { message: 'Internal Server Error' } }, 500));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image });

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });

  it('returns an empty text string when Gemini response has no candidates', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue(mockJsonResponse({ candidates: [] }));

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('');
  });
});
