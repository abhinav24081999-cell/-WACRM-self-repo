import { createHash } from 'node:crypto';
import { aiRequestTimeoutMs, GEMINI_AUTO_MODEL, MAX_OUTPUT_TOKENS } from '../defaults';
import { AiError, type ProviderResult } from '../types';
import {
  mergeConsecutive,
  normalizeUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = /^gemini-[a-z0-9.-]+$/;
const UNSTABLE_MODEL = /-(?:preview|experimental|exp|latest)(?:-|$)/;
const SPECIALIST_MODEL = /(?:audio|tts|image|embedding|live|robotics|computer-use|deep-research|omni)/;
const MODEL_COOLDOWN_MS = 5 * 60_000;
const MODEL_ATTEMPT_LIMIT = 4;
const rejectedModels = new Map<string, number>();

type GeminiErrorDetail = {
  reason?: string;
  '@type'?: string;
  violations?: { quotaDimensions?: { model?: string }; quotaValue?: string | number }[];
};

function rejectionKey(apiKey: string, model: string): string {
  return createHash('sha256').update(apiKey).update('\0').update(model).digest('hex');
}

function rejectModel(apiKey: string, model: string) {
  const key = rejectionKey(apiKey, model);
  rejectedModels.delete(key);
  rejectedModels.set(key, Date.now() + MODEL_COOLDOWN_MS);
  if (rejectedModels.size > 256) rejectedModels.delete(rejectedModels.keys().next().value!);
}

function isRecentlyRejected(apiKey: string, model: string): boolean {
  return (rejectedModels.get(rejectionKey(apiKey, model)) ?? 0) > Date.now();
}

function modelGeneration(id: string) {
  return id.match(/^gemini-(\d+(?:\.\d+)*)-/)?.[1] ?? '0';
}

function modelCapability(id: string) {
  if (id.includes('-carbon') || id.includes('-pro')) return 4;
  if (id.includes('-argon')) return 3;
  if (id.includes('-neon') || /-flash(?:-|$)/.test(id) && !id.includes('-lite')) return 2;
  return 1;
}

function compareModels(a: string, b: string) {
  return Number(UNSTABLE_MODEL.test(a)) - Number(UNSTABLE_MODEL.test(b)) ||
    modelGeneration(b).localeCompare(modelGeneration(a), 'en', { numeric: true }) ||
    modelCapability(b) - modelCapability(a) ||
    a.localeCompare(b, 'en', { numeric: true });
}

async function geminiRequest(
  path: string,
  apiKey: string,
  signal: AbortSignal,
  body?: object
) {
  let response: Response;
  try {
    response = await fetch(GEMINI_URL + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal,
    });
  } catch (error) {
    throw toNetworkError(error);
  }

  const data = await response.json().catch(() => null);
  if (response.ok && data) return data;
  const details: GeminiErrorDetail[] = Array.isArray(data?.error?.details) ? data.error.details : [];

  const invalidKey =
    response.status === 401 ||
    response.status === 403 ||
    details.some(
      (detail) =>
        detail?.reason === 'API_KEY_INVALID' ||
        detail?.reason === 'API_KEY_EXPIRED'
    );
  if (invalidKey) {
    throw new AiError(
      'Gemini rejected this API key. Check it in Google AI Studio.',
      { code: 'invalid_key', status: 401 }
    );
  }
  if (response.status === 404) {
    throw new AiError(
      'This Gemini model is unavailable for your key. Refresh the model list and choose another.',
      { code: 'unsupported_model', status: 400 }
    );
  }
  if (response.status === 429) {
    const model = path.match(/^\/models\/([^:]+):generateContent$/)?.[1];
    if (model && details.some(detail =>
      detail?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' &&
      detail.violations?.some(violation =>
        violation.quotaDimensions?.model?.replace(/^models\//, '') === model &&
        (violation.quotaValue === '0' || violation.quotaValue === 0)))) {
      throw new AiError('This Gemini model has no quota for your key.', { code: 'unsupported_model', status: 400 });
    }
    throw new AiError(
      'Gemini quota or rate limit reached. Check your quota or try again later.',
      { code: 'rate_limited', status: 429 }
    );
  }
  throw new AiError(
    'Gemini could not complete the request. Check the model and try again.',
    { code: 'provider_error' }
  );
}

export async function listGeminiModels(apiKey: string, timeoutMs = aiRequestTimeoutMs()): Promise<string[]> {
  return fetchGeminiModels(apiKey, AbortSignal.timeout(timeoutMs));
}

async function fetchGeminiModels(apiKey: string, signal: AbortSignal): Promise<string[]> {
  const models = new Set<string>();
  let path = '/models?pageSize=1000';
  for (let page = 0; page < 10; page++) {
    const data = await geminiRequest(path, apiKey, signal);
    for (const model of data.models ?? []) {
      const id = String(model.name).replace(/^models\//, '');
      if (
        MODEL_ID.test(id) &&
        model.supportedGenerationMethods?.includes('generateContent') &&
        !SPECIALIST_MODEL.test(id) &&
        !isRecentlyRejected(apiKey, id)
      ) {
        models.add(id);
      }
    }
    if (!data.nextPageToken) break;
    path =
      '/models?pageSize=1000&pageToken=' +
      encodeURIComponent(data.nextPageToken);
  }
  return [...models].sort(compareModels);
}

export async function generateGemini(
  args: ProviderArgs
): Promise<ProviderResult> {
  const model = args.model.replace(/^models\//, '');
  const canTryModel = model !== GEMINI_AUTO_MODEL && MODEL_ID.test(model) && !SPECIALIST_MODEL.test(model);
  const signal = AbortSignal.timeout(args.timeoutMs);
  let discovered = !canTryModel || isRecentlyRejected(args.apiKey, model);
  const candidates = discovered ? await fetchGeminiModels(args.apiKey, signal) : [model];
  let rejected: AiError | undefined;
  for (let i = 0; i < Math.min(candidates.length, MODEL_ATTEMPT_LIMIT); i++) {
    const candidate = candidates[i];
    try {
      return await generateWithModel(args, candidate, signal);
    } catch (error) {
      if (!(error instanceof AiError) || error.code !== 'unsupported_model') throw error;
      rejected = error;
      rejectModel(args.apiKey, candidate);
      if (!discovered) {
        discovered = true;
        const alternatives = await fetchGeminiModels(args.apiKey, signal);
        candidates.push(...alternatives.filter((alternative) => alternative !== candidate));
      }
    }
  }
  throw rejected ?? new AiError('Gemini returned no available text models for this key.', {
    code: 'unsupported_model', status: 400,
  });
}

async function generateWithModel(args: ProviderArgs, model: string, signal: AbortSignal): Promise<ProviderResult> {
  const data = await geminiRequest(
    '/models/' + model + ':generateContent',
    args.apiKey,
    signal,
    {
      systemInstruction: { parts: [{ text: args.systemPrompt }] },
      contents: mergeConsecutive(args.messages).map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(args.jsonOutput && { responseMimeType: 'application/json' }),
      },
    }
  );
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((part: { thought?: boolean }) => !part.thought)
    .map((part: { text?: string }) => part.text ?? '')
    .join('')
    .trim();
  if (!text)
    throw new AiError(
      'Gemini returned no reply. Try a different model or message.',
      { code: 'empty_response' }
    );
  const usage = data.usageMetadata;
  return {
    text,
    model,
    usage: normalizeUsage({
      prompt: usage?.promptTokenCount,
      completion: usage?.candidatesTokenCount,
      total: usage?.totalTokenCount,
    }),
  };
}
