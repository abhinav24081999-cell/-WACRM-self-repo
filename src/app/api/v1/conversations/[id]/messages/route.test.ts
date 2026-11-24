import { afterEach, expect, it, vi } from 'vitest';
import { requireApiKey } from '@/lib/auth/api-context';
import { GET } from './route';

vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: vi.fn() }));

afterEach(() => vi.unstubAllEnvs());

it('signs the caller workspace attachments and leaves external media intact', async () => {
  const origin = 'https://preview.supabase.co';
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', origin);
  const ownPath = 'account-a/own.png';
  const external = 'https://example.test/external.png';
  const ref = (path: string) => `${origin}/storage/v1/object/public/chat-media/${path}`;
  const messages = [ref(ownPath), ref('account-b/other.png'), external].map((media_url, id) => ({
    id: String(id), created_at: new Date().toISOString(), media_url,
  }));
  const query = { order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: messages }) };
  const createSignedUrls = vi.fn().mockResolvedValue({
    data: [{ path: ownPath, signedUrl: `${origin}/signed/own.png` }],
  });
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => table === 'conversations'
      ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'conversation' } }) }
      : { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnValue(query) }),
    storage: { from: vi.fn().mockReturnValue({ createSignedUrls }) },
  };
  vi.mocked(requireApiKey).mockResolvedValue({ accountId: 'a', supabase } as never);

  const response = await GET(new Request('https://test.example/api/v1/conversations/conversation/messages'), {
    params: Promise.resolve({ id: 'conversation' }),
  });
  expect(response.status).toBe(200);
  expect(createSignedUrls).toHaveBeenCalledWith([ownPath], 300);
  const { data } = await response.json();
  expect(data.map((message: { media_url: string | null }) => message.media_url))
    .toEqual([`${origin}/signed/own.png`, null, external]);
});
