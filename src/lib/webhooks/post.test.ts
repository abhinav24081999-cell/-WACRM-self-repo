import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { beforeEach, expect, it, vi } from 'vitest';
import { BlockedWebhookDestination, postWebhook } from './post';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

it('rejects a destination that resolves to a non-public address', async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: '192.168.1.2', family: 4 },
  ] as never);
  await expect(
    postWebhook('https://hooks.example.test', {}, '{}', 500)
  ).rejects.toBeInstanceOf(BlockedWebhookDestination);
  expect(request).not.toHaveBeenCalled();
});

it('pins the validated address and returns the first HTTP status', async () => {
  vi.mocked(lookup).mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
  ] as never);
  const destroyed = vi.fn();
  const callback = vi.fn();
  const end = vi.fn();
  vi.mocked(request).mockImplementation((url, options, handle) => {
    expect((url as URL).hostname).toBe('hooks.example.test');
    const lookup = (options as { lookup: (...args: unknown[]) => void }).lookup;
    lookup('hooks.example.test', { all: true }, callback);
    handle?.({ statusCode: 302, destroy: destroyed } as never);
    return { on: vi.fn(), end } as never;
  });
  await expect(
    postWebhook('https://hooks.example.test', {}, '{}', 500)
  ).resolves.toEqual({ status: 302, body: '' });
  expect(callback).toHaveBeenCalledWith(null, [
    { address: '8.8.8.8', family: 4 },
  ]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledWith('{}');
  expect(destroyed).toHaveBeenCalledOnce();
});
