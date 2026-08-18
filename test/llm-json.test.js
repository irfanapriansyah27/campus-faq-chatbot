import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLlmAnswer } from '../src/utils/llm-json.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const thirdId = '33333333-3333-4333-8333-333333333333';

function validAnswer(overrides = {}) {
  return {
    decision: 'ANSWER',
    answer: '  Jawaban terverifikasi.  ',
    faq_ids: [firstId],
    confidence: 'high',
    ...overrides
  };
}

test('menerima satu object JSON valid dan melakukan trim answer', () => {
  const result = parseLlmAnswer(JSON.stringify(validAnswer()));

  assert.equal(result.answer, 'Jawaban terverifikasi.');
});

test('menerima JSON jika code fence membungkus seluruh respons', () => {
  const result = parseLlmAnswer(`\`\`\`json\n${JSON.stringify(validAnswer())}\n\`\`\``);

  assert.equal(result.decision, 'ANSWER');
});

test('menolak JSON dengan prefix prose', () => {
  const result = parseLlmAnswer(`Berikut jawabannya: ${JSON.stringify(validAnswer())}`);

  assert.equal(result, null);
});

test('menolak JSON dengan suffix prose', () => {
  const result = parseLlmAnswer(`${JSON.stringify(validAnswer())} Semoga membantu.`);

  assert.equal(result, null);
});

test('menolak property asing', () => {
  const result = parseLlmAnswer(JSON.stringify(validAnswer({ debug: true })));

  assert.equal(result, null);
});

test('menolak answer kosong atau hanya whitespace', () => {
  const result = parseLlmAnswer(JSON.stringify(validAnswer({ answer: '   ' })));

  assert.equal(result, null);
});

test('menolak faq_id yang bukan UUID', () => {
  const result = parseLlmAnswer(JSON.stringify(validAnswer({ faq_ids: ['bukan-uuid'] })));

  assert.equal(result, null);
});

test('menolak jumlah faq_id yang melebihi batas Top-K', () => {
  const result = parseLlmAnswer(
    JSON.stringify(validAnswer({ faq_ids: [firstId, secondId, thirdId] })),
    { maxFaqIds: 2 }
  );

  assert.equal(result, null);
});

test('menolak faq_id duplikat', () => {
  const result = parseLlmAnswer(JSON.stringify(validAnswer({ faq_ids: [firstId, firstId] })));

  assert.equal(result, null);
});

test('menerima HANDOFF hanya dengan faq_ids kosong', () => {
  const valid = parseLlmAnswer(JSON.stringify({
    decision: 'HANDOFF',
    answer: 'Informasi belum cukup.',
    faq_ids: [],
    confidence: 'low'
  }));
  const invalid = parseLlmAnswer(JSON.stringify({
    decision: 'HANDOFF',
    answer: 'Informasi belum cukup.',
    faq_ids: [firstId],
    confidence: 'low'
  }));

  assert.equal(valid.decision, 'HANDOFF');
  assert.equal(invalid, null);
});
