import { expect, it } from 'vitest';
import { readAiAssessment } from './qualification';

const messages = [
  { role: 'user' as const, content: 'My uncle runs a franchise.' },
  { role: 'assistant' as const, content: 'Do you want to open one?' },
  { role: 'user' as const, content: 'I am not interested at the moment.' },
];

it('accepts a recognized outcome with an exact quote from the latest customer turn', () => {
  expect(
    readAiAssessment(
      { outcome: 'not_interested', evidence: 'I am not interested' },
      messages
    )
  ).toEqual({
    outcome: 'not_interested',
    evidence: 'I am not interested',
    followUp: false,
  });
});

it('rejects fabricated evidence, stale quotes and unsupported outcomes', () => {
  expect(
    readAiAssessment(
      { outcome: 'qualified', evidence: 'I want a franchise' },
      messages
    )
  ).toBeNull();
  expect(
    readAiAssessment(
      { outcome: 'qualified', evidence: 'My uncle runs a franchise.' },
      messages
    )
  ).toBeNull();
  expect(
    readAiAssessment(
      { outcome: 'junk', evidence: 'I am not interested' },
      messages
    )
  ).toBeNull();
});
