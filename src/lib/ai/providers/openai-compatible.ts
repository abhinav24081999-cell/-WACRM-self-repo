import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { BlockedWebhookDestination, postWebhook } from '@/lib/webhooks/post'
import { getT } from '@/lib/i18n/translate'

const t = getT('LibErrors')

const PRIVATE_HOST_ALLOWLIST_ENV = 'AI_PROVIDER_ALLOWED_PRIVATE_HOSTS'

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function allowedPrivateHosts(): Set<string> {
  return new Set(
    (process.env[PRIVATE_HOST_ALLOWLIST_ENV] ?? '')
      .split(',')
      .map(normalizeHost)
      .filter(Boolean),
  )
}

export function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, '')
  if (!value) {
    throw new AiError(t('ai.compatBaseUrlRequired'), {
      code: 'invalid_base_url',
      status: 400,
    })
  }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AiError(t('ai.compatBaseUrlInvalid'), {
      code: 'invalid_base_url',
      status: 400,
    })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AiError(t('ai.compatBaseUrlProtocol'), {
      code: 'invalid_base_url',
      status: 400,
    })
  }

  if (parsed.protocol === 'http:' && !allowedPrivateHosts().has(normalizeHost(parsed.hostname))) {
    throw new AiError(t('ai.compatBaseUrlHttpsRequired', { envVar: PRIVATE_HOST_ALLOWLIST_ENV }), {
      code: 'invalid_base_url',
      status: 400,
    })
  }

  if (parsed.username || parsed.password) {
    throw new AiError(t('ai.compatBaseUrlCredentials'), {
      code: 'invalid_base_url',
      status: 400,
    })
  }

  if (parsed.search || parsed.hash) {
    throw new AiError(t('ai.compatBaseUrlQuery'), {
      code: 'invalid_base_url',
      status: 400,
    })
  }

  const normalized = parsed.toString().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`
}

interface OpenAiCompatibleResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export async function generateOpenAiCompatible(
  args: ProviderArgs,
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, baseUrl } = args
  const endpoint = normalizeOpenAiCompatibleBaseUrl(baseUrl ?? '')
  const privateHosts = allowedPrivateHosts()
  const selfHosted = privateHosts.has(normalizeHost(new URL(endpoint).hostname))
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  const body = JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...mergeConsecutive(messages)],
    max_tokens: MAX_OUTPUT_TOKENS,
  })

  let res: Response
  try {
    if (selfHosted) {
      if (!await isDeliverableUrl(endpoint, { allowPrivateHosts: privateHosts })) {
        throw new BlockedWebhookDestination()
      }
      res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } else {
      const result = await postWebhook(endpoint, headers, body, timeoutMs, true)
      res = new Response(result.body || null, { status: result.status })
    }
  } catch (err) {
    if (err instanceof BlockedWebhookDestination) {
      throw new AiError(t('ai.compatBlockedUrl', { envVar: PRIVATE_HOST_ALLOWLIST_ENV }), {
        code: 'blocked_url',
        status: 400,
      })
    }
    throw toNetworkError(err)
  }

  if (!res.ok) throw await providerHttpError('OpenAI-compatible provider', res)

  const data = (await res.json().catch(() => null)) as OpenAiCompatibleResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(t('ai.emptyResponse', { provider: 'OpenAI-compatible provider' }), {
      code: 'empty_response',
    })
  }

  return {
    text,
    usage: normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    }),
  }
}
