import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
  type ProviderResult,
} from './types'
import { qualificationInstructions, readAiAssessment } from './qualification'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateOpenAiCompatible } from './providers/openai-compatible'
import { generateN8n } from './providers/n8n'
import { generateGemini } from './providers/gemini'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  withAssessment?: boolean
  externalMode?: 'test' | 'live'
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const assessmentRequested = args.withAssessment && !!config.qualificationCriteria
  const instructions = [
    systemPrompt,
    config.agentPurpose && 'Use this approved agent purpose: ' + config.agentPurpose,
    config.agentLanguage && config.agentLanguage !== 'auto' && 'Respond in ' + config.agentLanguage + '.',
    assessmentRequested && qualificationInstructions(config.qualificationCriteria!),
  ].filter(Boolean).join('\n\n')
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: instructions,
    messages,
    timeoutMs,
    jsonOutput: assessmentRequested,
    baseUrl: config.baseUrl,
  }

  let result: ProviderResult
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'openai_compatible':
      result = await generateOpenAiCompatible(providerArgs)
      break
    case 'n8n':
      result = await generateN8n(providerArgs, args.externalMode ?? 'test')
      break
    case 'gemini':
      result = await generateGemini(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  const resolvedModel = result.model ? { model: result.model } : {}
  if (!assessmentRequested) return { ...parseGeneration(result.text, result.usage), ...resolvedModel }
  if (config.provider === 'n8n') return { ...parseGeneration(result.text, result.usage), assessment: result.assessment }

  try {
    const raw = JSON.parse(result.text.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    if (typeof raw.reply === 'string' && typeof raw.handoff === 'boolean' && raw.reply.length <= 4096) {
      return {
        ...resolvedModel,
        text: raw.handoff ? '' : raw.reply.trim(),
        handoff: raw.handoff,
        usage: result.usage,
        assessment: readAiAssessment(raw.assessment, messages),
      }
    }
  } catch {
    // Never send a malformed structured response to a contact.
  }
  throw new AiError('The agent returned an invalid qualification response.', { code: 'assessment_invalid' })
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
