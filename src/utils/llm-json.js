import { z } from 'zod';

const confidenceSchema = z.enum(['high', 'medium', 'low']);
const answerTextSchema = z.string().trim().min(1).max(2000);

function uniqueFaqIdsSchema({ min, max }) {
  return z.array(z.string().uuid())
    .min(min)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'faq_ids harus unik.'
    });
}

function createAnswerSchema(maxFaqIds) {
  return z.discriminatedUnion('decision', [
    z.object({
      decision: z.literal('ANSWER'),
      answer: answerTextSchema,
      faq_ids: uniqueFaqIdsSchema({ min: 1, max: maxFaqIds }),
      confidence: confidenceSchema
    }).strict(),
    z.object({
      decision: z.literal('HANDOFF'),
      answer: answerTextSchema,
      faq_ids: z.array(z.string().uuid()).length(0),
      confidence: confidenceSchema
    }).strict()
  ]);
}

function unwrapFullCodeFence(rawContent) {
  const trimmed = rawContent.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return fenced ? fenced[1].trim() : trimmed;
}

export function validateLlmAnswer(rawContent, { maxFaqIds = 10 } = {}) {
  if (typeof rawContent !== 'string') {
    return { success: false, reason: 'FORMAT' };
  }

  let decoded;

  try {
    decoded = JSON.parse(unwrapFullCodeFence(rawContent));
  } catch {
    return { success: false, reason: 'FORMAT' };
  }

  const parsed = createAnswerSchema(maxFaqIds).safeParse(decoded);

  if (!parsed.success) {
    const citationInvalid = parsed.error.issues.some(
      (issue) => issue.path[0] === 'faq_ids'
    );

    return {
      success: false,
      reason: citationInvalid ? 'CITATION' : 'FORMAT'
    };
  }

  return { success: true, data: parsed.data };
}

export function parseLlmAnswer(rawContent, options) {
  const result = validateLlmAnswer(rawContent, options);
  return result.success ? result.data : null;
}
