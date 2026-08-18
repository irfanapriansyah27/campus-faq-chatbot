import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatService } from '../src/services/chat.service.js';

const fallbackMessage = 'Informasi belum tersedia. Silakan hubungi customer service.';

function createService({ matches = [], llmResponse = '', llmError = null } = {}) {
  const embeddingService = {
    async createQueryEmbedding() {
      return [0.1, 0.2];
    }
  };
  const llmService = {
    async createChatCompletion() {
      if (llmError) throw llmError;
      return llmResponse;
    }
  };
  const faqRepository = {
    async matchFaq() {
      return matches;
    }
  };

  return new ChatService({
    embeddingService,
    llmService,
    faqRepository,
    matchThreshold: 0.5,
    matchCount: 3,
    maxChatHistory: 6,
    fallbackMessage
  });
}

const match = {
  id: '11111111-1111-4111-8111-111111111111',
  question: 'Bagaimana melihat jadwal kuliah?',
  answer: 'Jadwal tersedia di sistem akademik.',
  category: 'akademik',
  similarity: 0.82
};

const secondMatch = {
  id: '33333333-3333-4333-8333-333333333333',
  question: 'Bagaimana mengunduh kartu studi?',
  answer: 'Kartu studi tersedia di sistem akademik.',
  category: 'akademik',
  similarity: 0.78
};

test('melakukan handoff ketika tidak ada FAQ yang melewati threshold', async () => {
  const service = createService();
  const result = await service.answer({ message: 'Apakah ada kelas renang?' });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.handoff.provider, 'tawk.to');
  assert.equal(result.handoff.reason, 'NO_RELEVANT_FAQ');
});

test('mengembalikan jawaban LLM yang memiliki faq_id terverifikasi', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Anda dapat melihat jadwal melalui sistem akademik kampus.',
      faq_ids: [match.id],
      confidence: 'high'
    })
  });
  const result = await service.answer({ message: 'Jadwal kuliah lihat di mana?' });

  assert.equal(result.decision, 'ANSWER');
  assert.equal(result.mode, 'GROUNDED_LLM');
  assert.equal(result.sources[0].faq_id, match.id);
});

test('mengembalikan jawaban jika seluruh faq_id terdapat pada hasil retrieval', async () => {
  const service = createService({
    matches: [match, secondMatch],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Jadwal dan kartu studi tersedia di sistem akademik kampus.',
      faq_ids: [match.id, secondMatch.id],
      confidence: 'high'
    })
  });

  const result = await service.answer({ message: 'Di mana jadwal dan kartu studi?' });

  assert.equal(result.decision, 'ANSWER');
  assert.deepEqual(result.sources.map((source) => source.faq_id), [match.id, secondMatch.id]);
});

test('melakukan handoff jika format LLM tidak valid', async () => {
  const service = createService({
    matches: [match],
    llmResponse: 'Jawaban biasa tanpa JSON.'
  });

  const result = await service.answer({
    message: 'Jadwal kuliah?'
  });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.answer, fallbackMessage);
  assert.equal(result.handoff.provider, 'tawk.to');
  assert.equal(result.handoff.reason, 'LLM_RESPONSE_INVALID');
});

test('melakukan handoff jika LLM mencantumkan sumber palsu', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Jawaban yang tidak dapat diverifikasi.',
      faq_ids: ['22222222-2222-4222-8222-222222222222'],
      confidence: 'high'
    })
  });

  const result = await service.answer({
    message: 'Jadwal kuliah?'
  });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.answer, fallbackMessage);
  assert.equal(result.handoff.provider, 'tawk.to');
  assert.equal(result.handoff.reason, 'UNVERIFIED_LLM_CITATION');
});

test('melakukan handoff jika LLM mencampur faq_id valid dan palsu', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Jawaban dengan sitasi campuran.',
      faq_ids: [match.id, '22222222-2222-4222-8222-222222222222'],
      confidence: 'high'
    })
  });

  const result = await service.answer({ message: 'Jadwal kuliah?' });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.handoff.reason, 'UNVERIFIED_LLM_CITATION');
});

test('melakukan handoff jika ANSWER tidak memiliki faq_id', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Jawaban tanpa sitasi.',
      faq_ids: [],
      confidence: 'low'
    })
  });

  const result = await service.answer({ message: 'Jadwal kuliah?' });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.handoff.reason, 'UNVERIFIED_LLM_CITATION');
});

test('melakukan handoff jika faq_id bukan UUID', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Jawaban dengan format sitasi salah.',
      faq_ids: ['bukan-uuid'],
      confidence: 'low'
    })
  });

  const result = await service.answer({ message: 'Jadwal kuliah?' });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.handoff.reason, 'UNVERIFIED_LLM_CITATION');
});

test('melakukan handoff jika faq_id duplikat', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'ANSWER',
      answer: 'Jawaban dengan sitasi duplikat.',
      faq_ids: [match.id, match.id],
      confidence: 'low'
    })
  });

  const result = await service.answer({ message: 'Jadwal kuliah?' });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.handoff.reason, 'UNVERIFIED_LLM_CITATION');
});

test('melakukan handoff ketika LLM menilai konteks tidak cukup', async () => {
  const service = createService({
    matches: [match],
    llmResponse: JSON.stringify({
      decision: 'HANDOFF',
      answer: 'Informasi tidak cukup.',
      faq_ids: [],
      confidence: 'low'
    })
  });
  const result = await service.answer({ message: 'Berapa biaya kelas renang?' });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.handoff.reason, 'LLM_CONTEXT_INSUFFICIENT');
});

test('melakukan handoff jika provider generasi gagal', async () => {
  const service = createService({
    matches: [match],
    llmError: new Error('quota habis')
  });

  const result = await service.answer({
    message: 'Jadwal kuliah?'
  });

  assert.equal(result.decision, 'HANDOFF');
  assert.equal(result.answer, fallbackMessage);
  assert.equal(result.handoff.provider, 'tawk.to');
  assert.equal(result.handoff.reason, 'LLM_SERVICE_UNAVAILABLE');
});
