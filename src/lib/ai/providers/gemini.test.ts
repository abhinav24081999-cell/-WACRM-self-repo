import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGemini, listGeminiModels } from './gemini';

const args = {
  apiKey: 'test-key',
  model: 'gemini-test',
  timeoutMs: 500,
  systemPrompt: 'Use approved information.',
  messages: [
    { role: 'user' as const, content: 'Hello' },
    { role: 'assistant' as const, content: 'Hi' },
    { role: 'user' as const, content: 'Kya aap help kar sakte ho?' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('Gemini adapter', () => {
  it('maps role history, authenticates with a header and returns only the visible answer', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'internal' },
                { text: 'Haan, zaroor.' },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 9,
          candidatesTokenCount: 4,
          totalTokenCount: 15,
        },
      })
    );
    vi.stubGlobal('fetch', fetch);
    await expect(generateGemini(args)).resolves.toEqual({
      text: 'Haan, zaroor.',
      model: 'gemini-test',
      usage: { promptTokens: 9, completionTokens: 4, totalTokens: 15 },
    });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'
    );
    expect(options.headers['x-goog-api-key']).toBe('test-key');
    expect(
      JSON.parse(options.body).contents.map(
        (item: { role: string }) => item.role
      )
    ).toEqual(['user', 'model', 'user']);
  });

  it('uses the newest stable text generation in Auto mode before a newer preview', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(modelList('gemini-3.8-flash', 'gemini-5-pro-preview', 'gemini-4-carbon', 'gemini-4-neon', 'gemini-6-flash-image'))
      .mockResolvedValueOnce(generation());
    vi.stubGlobal('fetch', fetch);

    await expect(generateGemini({ ...args, model: 'auto' })).resolves.toMatchObject({ model: 'gemini-4-carbon' });
    expect(fetch.mock.calls[1][0]).toContain('/gemini-4-carbon:generateContent');
  });

  it('falls back when Gemini rejects a saved model and omits it from later discovery for that key', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(modelList('gemini-3.8-flash', 'gemini-3.6-flash'))
      .mockResolvedValueOnce(generation())
      .mockResolvedValueOnce(modelList('gemini-3.8-flash', 'gemini-3.6-flash'));
    vi.stubGlobal('fetch', fetch);
    const key = 'fallback-key';

    await expect(generateGemini({ ...args, apiKey: key, model: 'models/gemini-3.8-flash' }))
      .resolves.toMatchObject({ model: 'gemini-3.6-flash' });
    expect(fetch.mock.calls[2][0]).toContain('/gemini-3.6-flash:generateContent');
    await expect(listGeminiModels(key)).resolves.toEqual(['gemini-3.6-flash']);
  });

  it('reports quota failures without trying a different model', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 429 }));
    vi.stubGlobal('fetch', fetch);

    await expect(generateGemini({ ...args, apiKey: 'quota-key' })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips a model with an explicit zero model quota and tries the next one', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(modelList('gemini-4-carbon', 'gemini-4-hydrogen'))
      .mockResolvedValueOnce(Response.json({ error: { details: [{
        '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaDimensions: { model: 'gemini-4-carbon' }, quotaValue: '0' }],
      }] } }, { status: 429 }))
      .mockResolvedValueOnce(generation());
    vi.stubGlobal('fetch', fetch);

    await expect(generateGemini({ ...args, apiKey: 'zero-quota-key', model: 'auto' }))
      .resolves.toMatchObject({ model: 'gemini-4-hydrogen' });
  });

  it('lists only relevant Gemini chat models and follows the next page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          models: [
            {
              name: 'models/gemini-test',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
          nextPageToken: 'page token',
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          models: [
            {
              name: 'models/gemini-test-embedding',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        })
      );
    vi.stubGlobal('fetch', fetch);
    await expect(listGeminiModels('test-key')).resolves.toEqual([
      'gemini-test',
    ]);
    expect(fetch.mock.calls[1][0]).toContain('page%20token');
  });

  it.each([
    [
      400,
      { error: { details: [{ reason: 'API_KEY_INVALID' }] } },
      'invalid_key',
    ],
    [403, {}, 'invalid_key'],
    [404, {}, 'unsupported_model'],
    [429, {}, 'rate_limited'],
  ])(
    'classifies Gemini HTTP %i without exposing the provider payload',
    async (status, body, code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json(body, { status }))
      );
      await expect(generateGemini({ ...args, apiKey: `status-${status}` })).rejects.toMatchObject({ code });
    }
  );

  it('classifies provider timeouts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );
    await expect(generateGemini(args)).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

function modelList(...ids: string[]) {
  return Response.json({ models: ids.map(id => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) });
}

function generation() {
  return Response.json({ candidates: [{ content: { parts: [{ text: 'Reply' }] } }] });
}
