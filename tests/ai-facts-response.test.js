/**
 * ai-facts-response.test.js
 *
 * Focused tests for /api/ai-facts response assembly and prompt wording.
 * The endpoint now streams responses using Server-Sent Events (SSE).
 */

'use strict';

jest.mock('node-fetch', () => jest.fn());

const { Readable } = require('stream');
const request      = require('supertest');
const fetch        = require('node-fetch');
const app          = require('../server');

// ── SSE test helpers ─────────────────────────────────────────────────────────

/**
 * Build a Node.js Readable stream that emits the provided SSE chunks followed
 * by an end-of-stream signal, simulating the Gemini streamGenerateContent
 * response body.
 * @param {string[]} sseChunks – Full `data: …\n\n` event strings to emit.
 */
function createSseStream(...sseChunks) {
  const stream = new Readable({ read() {} });
  process.nextTick(() => {
    for (const chunk of sseChunks) stream.push(chunk);
    stream.push(null);
  });
  return stream;
}

/**
 * Parse SSE text (the full response body) into an array of { text } chunks.
 * Stops at the first `[DONE]` marker.
 * @param {string} sseText
 * @returns {{ text?: string, error?: string }[]}
 */
function parseSseChunks(sseText) {
  const chunks = [];
  for (const line of sseText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') break;
    try { chunks.push(JSON.parse(payload)); } catch { /* skip */ }
  }
  return chunks;
}

/** Accumulate all `text` fields from SSE chunks into a single string. */
function accumulateSseText(sseText) {
  return parseSseChunks(sseText).map((c) => c.text || '').join('');
}

// ── Gemini SSE response builder ───────────────────────────────────────────────

/**
 * Build a minimal Gemini SSE response string for one `GenerateContentResponse`
 * with the given parts array.
 */
function geminiSseEvent(parts) {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts, role: 'model' } }] })}\n\n`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/ai-facts response assembly (SSE streaming)', () => {
  const savedKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    fetch.mockReset();
    if (savedKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedKey;
    }
  });

  it('streams multi-part Gemini responses and uses "You are looking at" prompt', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue({
      ok:   true,
      body: createSseStream(
        geminiSseEvent([{ text: 'You are looking at the Eiffel Tower. ' }]),
        geminiSseEvent([{ text: 'It was completed in 1889.' }]),
      ),
    });

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower' });

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/event-stream/);
    expect(accumulateSseText(res.text)).toBe('You are looking at the Eiffel Tower. It was completed in 1889.');

    const requestBody  = JSON.parse(fetch.mock.calls[0][1].body);
    const requestParts = requestBody.contents && requestBody.contents[0] && requestBody.contents[0].parts;
    expect(Array.isArray(requestParts)).toBe(true);
    const promptPart = requestParts.find((part) => part && typeof part.text === 'string');
    expect(promptPart).toBeTruthy();
    expect(promptPart.text).toContain('Begin your response with "You are looking at..."');
  });

  it('uses the streaming endpoint URL', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue({
      ok:   true,
      body: createSseStream(geminiSseEvent([{ text: 'You are looking at something.' }])),
    });

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    await request(app).post('/api/ai-facts').send({ image });

    const [calledUrl] = fetch.mock.calls[0];
    expect(calledUrl).toContain('streamGenerateContent');
    expect(calledUrl).toContain('alt=sse');
  });

  it('includes GPS coordinates in the prompt when provided', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue({
      ok:   true,
      body: createSseStream(geminiSseEvent([{ text: 'You are looking at the Eiffel Tower.' }])),
    });

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

    fetch.mockResolvedValue({
      ok:   true,
      body: createSseStream(geminiSseEvent([{ text: 'You are looking at something.' }])),
    });

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

    fetch.mockResolvedValue({
      ok:   true,
      body: createSseStream(geminiSseEvent([{ text: 'You are looking at something.' }])),
    });

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

    fetch.mockResolvedValue({
      ok:   true,
      body: createSseStream(
        geminiSseEvent([
          { text: 'Let me analyze this image...', thought: true },
          { text: 'I can see a tower structure.',  thought: true },
          { text: 'You are looking at the Eiffel Tower. ' },
          { text: 'It was completed in 1889.' },
        ]),
      ),
    });

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower' });

    expect(res.status).toBe(200);
    expect(accumulateSseText(res.text)).toBe('You are looking at the Eiffel Tower. It was completed in 1889.');
  });

  it('sends an SSE error event when Gemini upstream returns a non-OK status', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue({
      ok:   false,
      status: 500,
      text: async () => 'Internal Server Error',
      body: createSseStream(),
    });

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image });

    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/event-stream/);
    const chunks = parseSseChunks(res.text);
    expect(chunks.some((c) => c.error)).toBe(true);
  });
});
