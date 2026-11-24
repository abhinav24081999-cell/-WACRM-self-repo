import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { CHAT_MEDIA_BUCKET, isAccountChatPath } from '@/lib/media/chat-storage';
import { mediaProxyHeaders } from '@/lib/media/proxy-response-headers';

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const path = new URL(request.url).searchParams.get('path') ?? '';
    if (!isAccountChatPath(path, accountId)) return new Response(null, { status: 404 });

    const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) return new Response(null, { status: 404 });

    const range = request.headers.get('range');
    const upstream = await fetch(data.signedUrl, {
      headers: range ? { Range: range } : undefined,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok && upstream.status !== 416) return new Response(null, { status: 502 });

    const headers = new Headers(mediaProxyHeaders('', upstream.headers.get('content-type')));
    headers.set('Cache-Control', 'private, no-store');
    for (const name of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return toErrorResponse(error);
  }
}
