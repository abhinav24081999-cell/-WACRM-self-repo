export const CHAT_MEDIA_BUCKET = 'chat-media';
export const CHAT_MEDIA_READ_PATH = '/api/storage/chat-media';
const PUBLIC_PATH = '/storage/v1/object/public/chat-media/';

export function isAccountChatPath(path: string, accountId: string) {
  const [folder, ...parts] = path.split('/');
  return folder === `account-${accountId}` && parts.length > 0 &&
    parts.every(part => part !== '' && part !== '.' && part !== '..' && !/[\\\u0000-\u001f]/.test(part));
}

export function chatStoragePath(url: string | null | undefined) {
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !project) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(project).origin || !parsed.pathname.startsWith(PUBLIC_PATH)) return null;
    return decodeURIComponent(parsed.pathname.slice(PUBLIC_PATH.length));
  } catch {
    return null;
  }
}

export function chatMediaReadUrl(url: string): string;
export function chatMediaReadUrl(url: string | undefined): string | undefined;
export function chatMediaReadUrl(url: string | undefined) {
  const path = chatStoragePath(url);
  return path ? `${CHAT_MEDIA_READ_PATH}?path=${encodeURIComponent(path)}` : url;
}
