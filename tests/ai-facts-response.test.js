/**
 * ai-facts-response.test.js
 *
 * Focused tests for /api/ai-facts response assembly and prompt wording.
 */

'use strict';

jest.mock('node-fetch', () => jest.fn());

const request = require('supertest');
const fetch   = require('node-fetch');
const app     = require('../server');

describe('POST /api/ai-facts response assembly', () => {
  const savedKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    fetch.mockReset();
    if (savedKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedKey;
    }
  });

  it('joins multi-part Gemini responses and uses "You are looking at" prompt', async () => {
    process.env.GEMINI_API_KEY = 'test-key';

    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                { text: 'You are looking at the Eiffel Tower. ' },
                { text: 'It was completed in 1889.' },
              ],
            },
          },
        ],
      }),
    });

    const image = 'data:image/jpeg;base64,' + Buffer.alloc(16).toString('base64');
    const res = await request(app)
      .post('/api/ai-facts')
      .send({ image, description: 'Eiffel Tower' });

    expect(res.status).toBe(200);
    expect(res.body.facts).toBe('You are looking at the Eiffel Tower. It was completed in 1889.');

    const requestBody = JSON.parse(fetch.mock.calls[0][1].body);
    const requestParts = requestBody.contents && requestBody.contents[0] && requestBody.contents[0].parts;
    expect(Array.isArray(requestParts)).toBe(true);
    const promptPart = requestParts.find((part) => part && typeof part.text === 'string');
    expect(promptPart).toBeTruthy();
    const promptText = promptPart.text;
    expect(promptText.startsWith('You are looking at')).toBe(true);
    expect(promptText).toContain('Begin with "You are looking at..."');
  });
});
