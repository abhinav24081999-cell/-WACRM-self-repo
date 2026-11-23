import type { ChatMessage } from './types';

export const AI_OUTCOMES = [
  'qualified',
  'not_interested',
  'needs_information',
  'human_review',
] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

export interface AiAssessment {
  outcome: AiOutcome;
  evidence: string;
  followUp: boolean;
}

export function qualificationInstructions(criteria: string) {
  return [
    'Return one JSON object only with reply (string), handoff (boolean) and assessment (object or null).',
    'Use an empty reply only when handoff is true. Do not use markers in the reply.',
    'An assessment has outcome (qualified, not_interested, needs_information, or human_review), evidence (an exact short quote from the most recent customer message), and follow_up (boolean, true only when the customer explicitly requested future contact).',
    'Use qualified only when the conversation supplies evidence for all configured requirements. Use not_interested only if the customer explicitly declines. Never classify silence as junk. If there is no new evidence, return a null assessment.',
    'Qualification criteria set by the workspace owner: ' + criteria,
  ].join('\n');
}

export function readAiAssessment(
  value: unknown,
  messages: ChatMessage[]
): AiAssessment | null {
  if (!value || typeof value !== 'object') return null;
  const { outcome, evidence, follow_up } = value as Record<string, unknown>;
  if (
    !AI_OUTCOMES.includes(outcome as AiOutcome) ||
    typeof evidence !== 'string'
  )
    return null;
  const quote = evidence.trim().replace(/\s+/g, ' ');
  const latest = messages
    .findLast((message) => message.role === 'user')
    ?.content.replace(/\s+/g, ' ');
  if (quote.length < 4 || quote.length > 280 || !latest?.includes(quote))
    return null;
  return {
    outcome: outcome as AiOutcome,
    evidence: quote,
    followUp: follow_up === true,
  };
}
