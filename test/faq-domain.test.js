import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminFaqCreateSchema,
  adminFaqListQuerySchema,
  adminFaqStatusSchema,
  adminFaqUpdateSchema,
  buildCanonicalFaqContent,
  validateFaqStatusTransition
} from '../src/domain/faq.js';

const validCreate = {
  faq_key: 'jadwal-kuliah',
  question: 'Di mana saya melihat jadwal kuliah?',
  answer: 'Jadwal tersedia melalui sistem informasi akademik.',
  category: 'akademik',
  source: 'panduan akademik',
  metadata: {}
};

const validUpdate = {
  question: validCreate.question,
  answer: validCreate.answer,
  category: validCreate.category,
  source: validCreate.source,
  metadata: validCreate.metadata,
  expected_version: 1
};

test('canonical content mempertahankan format exact dan normalisasi trim', () => {
  assert.equal(
    buildCanonicalFaqContent({
      question: `  ${validCreate.question}  `,
      answer: `  ${validCreate.answer}  `
    }),
    `Pertanyaan: ${validCreate.question}\nJawaban: ${validCreate.answer}`
  );
});

test('create mewajibkan faq_key dan default eksplisit ke draft', () => {
  const parsed = adminFaqCreateSchema.parse(validCreate);

  assert.equal(parsed.status, 'draft');
  assert.equal(adminFaqCreateSchema.safeParse({
    ...validCreate,
    faq_key: undefined
  }).success, false);
});

test('create menolak status archived', () => {
  assert.equal(adminFaqCreateSchema.safeParse({
    ...validCreate,
    status: 'archived'
  }).success, false);
});

test('update bersifat full dan menolak faq_key immutable', () => {
  assert.equal(adminFaqUpdateSchema.safeParse(validUpdate).success, true);
  assert.equal(adminFaqUpdateSchema.safeParse({
    ...validUpdate,
    faq_key: validCreate.faq_key
  }).success, false);
  assert.equal(adminFaqUpdateSchema.safeParse({
    ...validUpdate,
    answer: undefined
  }).success, false);
});

test('expected_version harus integer positif pada update dan status', () => {
  assert.equal(adminFaqUpdateSchema.safeParse({
    ...validUpdate,
    expected_version: 0
  }).success, false);
  assert.equal(adminFaqStatusSchema.safeParse({
    status: 'published',
    expected_version: 1
  }).success, true);
  assert.equal(adminFaqStatusSchema.safeParse({
    status: 'published',
    expected_version: -1
  }).success, false);
  assert.equal(adminFaqStatusSchema.safeParse({
    status: 'published',
    expected_version: '1'
  }).success, false);
});

test('lifecycle menerima matrix transisi yang disetujui', () => {
  for (const [currentStatus, targetStatus] of [
    ['draft', 'published'],
    ['published', 'draft'],
    ['draft', 'archived'],
    ['published', 'archived'],
    ['archived', 'draft']
  ]) {
    assert.deepEqual(
      validateFaqStatusTransition(currentStatus, targetStatus),
      { changed: true, status: targetStatus }
    );
  }
});

test('lifecycle menolak archived langsung ke published', () => {
  assert.throws(
    () => validateFaqStatusTransition('archived', 'published'),
    (error) => error.status === 409 && error.code === 'FAQ_STATUS_TRANSITION_INVALID'
  );
});

test('lifecycle no-op tidak dianggap effective mutation', () => {
  assert.deepEqual(
    validateFaqStatusTransition('draft', 'draft'),
    { changed: false, status: 'draft' }
  );
});

test('list query menerapkan default, trim, dan allowlist', () => {
  assert.deepEqual(adminFaqListQuerySchema.parse({}), {
    q: '',
    status: 'all',
    category: '',
    page: 1,
    page_size: 20,
    sort_by: 'updated_at',
    sort_order: 'desc'
  });
  assert.equal(adminFaqListQuerySchema.parse({ q: '  jadwal  ' }).q, 'jadwal');
  assert.equal(
    adminFaqListQuerySchema.parse({ category: '  akademik  ' }).category,
    'akademik'
  );

  for (const query of [
    { page: '0' },
    { page: String(Number.MAX_SAFE_INTEGER), page_size: '100' },
    { page_size: '9' },
    { page_size: '101' },
    { status: 'deleted' },
    { category: 'x' },
    { sort_by: 'embedding' },
    { sort_order: 'sideways' },
    { q: 'x'.repeat(201) },
    { q: 'jadwal*' },
    { unknown: 'value' }
  ]) {
    assert.equal(adminFaqListQuerySchema.safeParse(query).success, false);
  }
});

test('metadata server menolak struktur yang bukan JSON plain dan depth ekstrem', () => {
  const cyclic = {};
  cyclic.self = cyclic;

  let tooDeep = { value: true };
  for (let index = 0; index < 32; index += 1) {
    tooDeep = { nested: tooDeep };
  }

  for (const metadata of [
    cyclic,
    tooDeep,
    new Date(),
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: () => true },
    { value: Symbol('invalid') }
  ]) {
    assert.equal(adminFaqCreateSchema.safeParse({
      ...validCreate,
      metadata
    }).success, false);
    assert.equal(adminFaqUpdateSchema.safeParse({
      ...validUpdate,
      metadata
    }).success, false);
  }
});
