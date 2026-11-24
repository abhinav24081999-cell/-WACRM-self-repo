import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatMediaReadUrl, chatStoragePath, isAccountChatPath } from './chat-storage';

const origin = 'https://test-project.supabase.co';
const path = 'account-workspace-a/inbound/file one.png';
const url = `${origin}/storage/v1/object/public/chat-media/account-workspace-a/inbound/file%20one.png`;

afterEach(() => vi.unstubAllEnvs());

describe('private chat storage references', () => {
  it('keeps existing message references readable through the authenticated route', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', origin);
    expect(chatStoragePath(url)).toBe(path);
    expect(chatMediaReadUrl(url)).toBe(`/api/storage/chat-media?path=${encodeURIComponent(path)}`);
  });

  it('does not reinterpret a URL from another service or bucket', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', origin);
    for (const external of [
      url.replace(origin, 'https://another-project.supabase.co'),
      url.replace('chat-media', 'flow-media'),
      '/api/whatsapp/media/123',
    ]) expect(chatMediaReadUrl(external)).toBe(external);
  });

  it('allows nested attachments only under the matching workspace folder', () => {
    expect(isAccountChatPath(path, 'workspace-a')).toBe(true);
    expect(isAccountChatPath(path, 'workspace-b')).toBe(false);
    expect(isAccountChatPath('account-workspace-a/', 'workspace-a')).toBe(false);
  });
});
