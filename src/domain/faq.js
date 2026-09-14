import { z } from 'zod';
import { validateFaqMetadata } from '../../public/admin/faq-metadata.js';
import { AppError } from '../utils/errors.js';

export const FAQ_ERROR_CODES = Object.freeze({
  notFound: 'FAQ_NOT_FOUND',
  keyConflict: 'FAQ_KEY_CONFLICT',
  versionConflict: 'FAQ_VERSION_CONFLICT',
  invalidTransition: 'FAQ_STATUS_TRANSITION_INVALID'
});

export const faqStatusSchema = z.enum(['draft', 'published', 'archived']);
export const faqIdSchema = z.string().uuid();
export const expectedVersionSchema = z.number().int().positive();

const faqKeySchema = z.string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const questionSchema = z.string().trim().min(5).max(1000);
const answerSchema = z.string().trim().min(5).max(5000);
const categorySchema = z.string().trim().min(2).max(100);
const sourceSchema = z.string().trim().min(1).max(500);
export const faqMetadataSchema = z.unknown().superRefine((value, context) => {
  const result = validateFaqMetadata(value);
  if (!result.ok) {
    context.addIssue({
      code: 'custom',
      message: result.message
    });
  }
});

const faqContentFieldsSchema = z.object({
  question: questionSchema,
  answer: answerSchema
}).strict();

export const adminFaqCreateSchema = z.object({
  faq_key: faqKeySchema,
  question: questionSchema,
  answer: answerSchema,
  category: categorySchema.default('umum'),
  source: sourceSchema.default('admin'),
  metadata: faqMetadataSchema.default({}),
  status: z.enum(['draft', 'published']).default('draft')
}).strict();

export const adminFaqUpdateSchema = z.object({
  question: questionSchema,
  answer: answerSchema,
  category: categorySchema,
  source: sourceSchema,
  metadata: faqMetadataSchema,
  expected_version: expectedVersionSchema
}).strict();

export const adminFaqStatusSchema = z.object({
  status: faqStatusSchema,
  expected_version: expectedVersionSchema
}).strict();

export const adminFaqListQuerySchema = z.object({
  q: z.string()
    .trim()
    .max(200)
    .refine((value) => !value.includes('*'), {
      message: 'Pencarian tidak boleh memuat karakter *.'
    })
    .default(''),
  status: z.enum(['all', 'draft', 'published', 'archived']).default('all'),
  category: z.string()
    .trim()
    .max(100)
    .refine((value) => value.length === 0 || value.length >= 2, {
      message: 'Kategori harus kosong atau memuat minimal 2 karakter.'
    })
    .default(''),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(10).max(100).default(20),
  sort_by: z.enum([
    'updated_at',
    'created_at',
    'faq_key',
    'question',
    'category',
    'status'
  ]).default('updated_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
}).strict().superRefine((query, context) => {
  const from = (query.page - 1) * query.page_size;
  const to = from + query.page_size - 1;

  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
    context.addIssue({
      code: 'custom',
      path: ['page'],
      message: 'Range halaman berada di luar batas integer aman.'
    });
  }
});

export function buildCanonicalFaqContent(input) {
  const { question, answer } = faqContentFieldsSchema.parse(input);
  return `Pertanyaan: ${question}\nJawaban: ${answer}`;
}

const allowedStatusTransitions = Object.freeze({
  draft: new Set(['published', 'archived']),
  published: new Set(['draft', 'archived']),
  archived: new Set(['draft'])
});

export function validateFaqStatusTransition(currentStatus, targetStatus) {
  const current = faqStatusSchema.parse(currentStatus);
  const target = faqStatusSchema.parse(targetStatus);

  if (current === target) {
    return { changed: false, status: target };
  }

  if (!allowedStatusTransitions[current].has(target)) {
    throw new AppError('Perubahan status FAQ tidak diizinkan.', {
      status: 409,
      code: FAQ_ERROR_CODES.invalidTransition
    });
  }

  return { changed: true, status: target };
}
