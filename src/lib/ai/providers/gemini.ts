import { aiRequestTimeoutMs, MAX_OUTPUT_TOKENS } from '../defaults';
import { AiError, type ProviderResult } from '../types';
import {
  mergeConsecutive,
  normalizeUsage,
  toNetworkError,
  type ProviderArgs,
} from './shared';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_ID = /^gemini-[a-z0-9.-]+$/;

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

  const invalidKey =
    response.status === 401 ||
    response.status === 403 ||
    data?.error?.details?.some?.(
      (detail: { reason?: string }) =>
        detail.reason === 'API_KEY_INVALID' ||
        detail.reason === 'API_KEY_EXPIRED'
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
  const signal = AbortSignal.timeout(timeoutMs);
  const models = new Set<string>();
  let path = '/models?pageSize=1000';
  for (let page = 0; page < 10; page++) {
    const data = await geminiRequest(path, apiKey, signal);
    for (const model of data.models ?? []) {
      const id = String(model.name).replace(/^models\//, '');
      if (
        MODEL_ID.test(id) &&
        model.supportedGenerationMethods?.includes('generateContent') &&
        !/(audio|tts|image|embedding|live|robotics|computer-use|deep-research)/.test(
          id
        )
      ) {
        models.add(id);
      }
    }
    if (!data.nextPageToken) break;
    path =
      '/models?pageSize=1000&pageToken=' +
      encodeURIComponent(data.nextPageToken);
  }
  return [...models];
}

export async function generateGemini(
  args: ProviderArgs
): Promise<ProviderResult> {
  const model = args.model.replace(/^models\//, '');
  if (!MODEL_ID.test(model)) {
    throw new AiError('Choose a valid Gemini model.', {
      code: 'unsupported_model',
      status: 400,
    });
  }
  const data = await geminiRequest(
    '/models/' + model + ':generateContent',
    args.apiKey,
    AbortSignal.timeout(args.timeoutMs),
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
    usage: normalizeUsage({
      prompt: usage?.promptTokenCount,
      completion: usage?.candidatesTokenCount,
      total: usage?.totalTokenCount,
    }),
  };
}
