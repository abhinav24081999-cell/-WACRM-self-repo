import { beforeEach, expect, it, vi } from 'vitest';
import { postWebhook } from '@/lib/webhooks/post';
import { generateN8n, normalizeN8nUrl } from './n8n';

vi.mock('@/lib/webhooks/post', () => ({
  BlockedWebhookDestination: class extends Error {},
  postWebhook: vi.fn(),
}));

const args = {
  apiKey: 'secret',
  baseUrl: 'https://n8n.example.test/webhook/agent',
  model: 'workflow',
  systemPrompt: 'Reply with a short answer.',
  messages: [{ role: 'user' as const, content: 'I can visit tomorrow.' }],
  timeoutMs: 30_000,
};

beforeEach(() => vi.resetAllMocks());

it('authenticates a workflow and validates its correlated reply and evidence', async () => {
  vi.mocked(postWebhook).mockImplementation(
    async (url, headers, body, timeout, readBody) => {
      expect(url).toBe(args.baseUrl);
      expect(headers.Authorization).toBe('Bearer secret');
      expect(timeout).toBe(20_000);
      expect(readBody).toBe(true);
      const incoming = JSON.parse(body);
      expect(incoming.mode).toBe('test');
      return {
        status: 200,
        body: JSON.stringify({
          version: 1,
          correlation_id: incoming.correlation_id,
          reply: 'Thank you.',
          assessment: {
            outcome: 'needs_information',
            evidence: 'I can visit tomorrow.',
            follow_up: true,
          },
        }),
      };
    }
  );
  await expect(generateN8n(args, 'test')).resolves.toMatchObject({
    text: 'Thank you.',
    assessment: {
      outcome: 'needs_information',
      evidence: 'I can visit tomorrow.',
      followUp: true,
    },
  });
});

it('rejects replies without the expected correlation ID', async () => {
  vi.mocked(postWebhook).mockResolvedValue({
    status: 200,
    body: JSON.stringify({
      version: 1,
      correlation_id: 'other',
      reply: 'hello',
    }),
  });
  await expect(generateN8n(args, 'live')).rejects.toMatchObject({
    code: 'workflow_response_invalid',
  });
});

it('retries a temporary gateway response once with the same correlation ID', async () => {
  const transport = vi.mocked(postWebhook);
  transport.mockResolvedValueOnce({ status: 503, body: '' });
  transport.mockImplementationOnce(async (_url, _headers, body) => ({
    status: 200,
    body: JSON.stringify({ version: 1, correlation_id: JSON.parse(body).correlation_id, reply: 'Recovered' }),
  }));
  await expect(generateN8n(args, 'live')).resolves.toMatchObject({ text: 'Recovered' });
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[1][2]).toBe(transport.mock.calls[0][2]);
});

it('requires the Production URL', () => {
  expect(() =>
    normalizeN8nUrl('https://n8n.example.test/webhook-test/agent')
  ).toThrow('Production URL');
});
