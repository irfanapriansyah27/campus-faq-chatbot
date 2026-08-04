import { z } from 'zod';

const answerSchema = z.object({
  decision: z.enum(['ANSWER', 'HANDOFF']),
  answer: z.string().min(1).max(2000),
  faq_ids: z.array(z.string()).default([]),
  confidence: z.enum(['high', 'medium', 'low']).default('low')
});

export function parseLlmAnswer(rawContent) {
  if (typeof rawContent !== 'string') {
    return null;
  }

  const withoutFence = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');

  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return answerSchema.parse(
      JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1))
    );
  } catch {
    return null;
  }
}

