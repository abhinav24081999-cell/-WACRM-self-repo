// ============================================================
// GET /api/v1/conversations/{id}/messages — list a conversation's
// messages (scope: messages:read), newest first, keyset-paginated.
//
// The conversation is verified to belong to the key's account before
// any message is returned — a foreign or unknown id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { serializeMessage } from '@/lib/api/v1/conversations';
import { CHAT_MEDIA_BUCKET, chatStoragePath, isAccountChatPath } from '@/lib/media/chat-storage';
import type { Message } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { id } = await params;
    const { limit, cursor } = parseListParams(request);

    // Gate on account ownership of the conversation first.
    const { data: conv } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!conv) return fail('not_found', 'Conversation not found', 404);

    let query = ctx.supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/messages] list error:', error);
      return fail('internal', 'Failed to list messages', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    const messages = items.map((m) => serializeMessage(m as unknown as Message));
    const paths = messages.map(message => chatStoragePath(message.media_url));
    const scoped = [...new Set(paths.filter(
      (path): path is string => path !== null && isAccountChatPath(path, ctx.accountId)
    ))];
    const signed = new Map<string, string>();
    if (scoped.length > 0) {
      const { data } = await ctx.supabase.storage.from(CHAT_MEDIA_BUCKET)
        .createSignedUrls(scoped, 300);
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
      }
    }
    return okList(messages.map((message, index) => {
      const path = paths[index];
      return path === null ? message : { ...message, media_url: signed.get(path) ?? null };
    }), nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
