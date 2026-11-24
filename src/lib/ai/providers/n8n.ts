import { randomUUID } from 'node:crypto';
import { checkWebhookUrl } from '@/lib/webhooks/endpoints';
import { BlockedWebhookDestination, postWebhook } from '@/lib/webhooks/post';
import { readAiAssessment } from '../qualification';
import { HANDOFF_SENTINEL } from '../defaults';
import { AiError, type ProviderResult } from '../types';
import type { ProviderArgs } from './shared';

export const N8N_MODEL = 'workflow';

export function normalizeN8nUrl(value: string): string {
  const result = checkWebhookUrl(value);
  if (!result.ok || result.url.length > 2048 || new URL(result.url).hash) {
    throw new AiError(
      'Enter a public HTTPS workflow URL without a URL fragment.',
      { code: 'invalid_base_url', status: 400 }
    );
  }
  if (new URL(result.url).pathname.split('/').includes('webhook-test')) {
    throw new AiError(
      'Copy the Production URL from the n8n Webhook node and publish the workflow.',
      { code: 'invalid_base_url', status: 400 }
    );
  }
  return result.url;
}

export async function generateN8n(
  args: ProviderArgs,
  mode: 'test' | 'live'
): Promise<ProviderResult> {
  const url = normalizeN8nUrl(args.baseUrl ?? '');
  const id = randomUUID();
  if (!/^[\x21-\x7e]{1,512}$/.test(args.apiKey)) {
    throw new AiError(
      'Use a connection secret without spaces or line breaks.',
      { code: 'invalid_key', status: 400 }
    );
  }

  const body = JSON.stringify({
    version: 1,
    correlation_id: id,
    mode,
    instructions: args.systemPrompt,
    messages: args.messages.map((message) => ({
      ...message,
      content: message.content.slice(0, 4000),
    })),
  });
  const send = async (timeout: number, attempt: number) => {
    const result = await postWebhook(url, {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ' + args.apiKey,
    }, body, timeout, true);
    console.info('[ai/n8n] workflow response', { correlation_id: id, mode, attempt, status: result.status });
    return result;
  };
  const timeout = Math.min(args.timeoutMs, 20_000);
  const deadline = Date.now() + timeout;
  let response;
  try {
    response = await send(timeout, 1);
    if ([502, 503, 504].includes(response.status) && deadline - Date.now() > 1000) {
      response = await send(deadline - Date.now(), 2);
    }
  } catch (error) {
    if (error instanceof BlockedWebhookDestination) {
      throw new AiError('The workflow must use a public HTTPS URL.', {
        code: 'invalid_base_url',
        status: 400,
      });
    }
    console.warn('[ai/n8n] workflow delivery unavailable', { correlation_id: id, mode });
    throw new AiError(
      'The workflow was unreachable, timed out, or returned too much data.',
      { code: 'workflow_unavailable' }
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AiError(
      'The workflow rejected the connection secret. Check Header Auth in n8n.',
      { code: 'invalid_key', status: 401 }
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new AiError(
      'The workflow returned HTTP ' +
        response.status +
        '. Verify the Production URL and check n8n executions.',
      { code: 'workflow_error' }
    );
  }

  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new AiError('The workflow must return a JSON object.', {
      code: 'workflow_response_invalid',
    });
  }
  const text = typeof result?.reply === 'string' ? result.reply.trim() : '';
  const handoff = result?.handoff === true;
  if (
    result?.version !== 1 ||
    result.correlation_id !== id ||
    (result.handoff !== undefined && typeof result.handoff !== 'boolean') ||
    (!handoff && !text) ||
    text.length > 4096
  ) {
    throw new AiError(
      'The workflow returned an invalid reply or correlation ID.',
      { code: 'workflow_response_invalid' }
    );
  }
  return {
    text: handoff ? HANDOFF_SENTINEL : text,
    usage: null,
    assessment: readAiAssessment(result.assessment, args.messages),
  };
}
