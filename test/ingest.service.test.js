import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestService } from '../src/services/ingest.service.js';

const validFaq = {
  faq_key: 'contoh-faq',
  question: 'Bagaimana cara melihat jadwal?',
  answer: 'Jadwal dapat dilihat melalui sistem akademik.',
  category: 'akademik',
  source: 'panduan akademik'
};

function createService({ onEmbedding, onUpsert } = {}) {
  const embeddingService = {
    async createDocumentEmbeddings(inputs) {
      onEmbedding?.(inputs);
      return inputs.map(() => [0.1, 0.2, 0.3]);
    }
  };
  const faqRepository = {
    async upsertFaqs(records) {
      onUpsert?.(records);
      return records;
    }
  };

  return new IngestService({ embeddingService, faqRepository });
}

test('ingest membuat embedding lalu menyimpan FAQ yang tervalidasi', async () => {
  let receivedInputs;
  let receivedRecords;
  const embeddingService = {
    async createDocumentEmbeddings(inputs) {
      receivedInputs = inputs;
      return [[0.1, 0.2, 0.3]];
    }
  };
  const faqRepository = {
    async upsertFaqs(records) {
      receivedRecords = records;
      return records;
    }
  };
  const service = new IngestService({ embeddingService, faqRepository });

  const result = await service.ingest([{
    faq_key: 'contoh-faq',
    question: 'Bagaimana cara melihat jadwal?',
    answer: 'Jadwal dapat dilihat melalui sistem akademik.'
  }]);

  assert.match(receivedInputs[0], /Pertanyaan:/);
  assert.deepEqual(receivedRecords[0].embedding, [0.1, 0.2, 0.3]);
  assert.equal(receivedRecords[0].status, 'published');
  assert.equal(result.length, 1);
});

for (const field of ['question', 'answer', 'category', 'source']) {
  test(`ingest menolak ${field} yang hanya whitespace`, async () => {
    let providerCalled = false;
    const service = createService({
      onEmbedding() {
        providerCalled = true;
      }
    });

    await assert.rejects(service.ingest([{
      ...validFaq,
      [field]: '     '
    }]));
    assert.equal(providerCalled, false);
  });
}

test('ingest melakukan trim pada seluruh field teks FAQ', async () => {
  let receivedInputs;
  let receivedRecords;
  const service = createService({
    onEmbedding(inputs) {
      receivedInputs = inputs;
    },
    onUpsert(records) {
      receivedRecords = records;
    }
  });

  await service.ingest([{
    faq_key: '  contoh-faq  ',
    question: '  Bagaimana cara melihat jadwal?  ',
    answer: '  Jadwal tersedia di sistem akademik.  ',
    category: '  akademik  ',
    source: '  panduan akademik  '
  }]);

  assert.equal(receivedRecords[0].faq_key, 'contoh-faq');
  assert.equal(receivedRecords[0].question, 'Bagaimana cara melihat jadwal?');
  assert.equal(receivedRecords[0].answer, 'Jadwal tersedia di sistem akademik.');
  assert.equal(receivedRecords[0].category, 'akademik');
  assert.equal(receivedRecords[0].source, 'panduan akademik');
  assert.equal(
    receivedInputs[0],
    'Pertanyaan: Bagaimana cara melihat jadwal?\nJawaban: Jadwal tersedia di sistem akademik.'
  );
});

test('ingest menolak duplicate faq_key sebelum memanggil provider atau repository', async () => {
  let embeddingCalled = false;
  let repositoryCalled = false;
  const service = createService({
    onEmbedding() {
      embeddingCalled = true;
    },
    onUpsert() {
      repositoryCalled = true;
    }
  });

  await assert.rejects(service.ingest([
    validFaq,
    {
      ...validFaq,
      question: 'Bagaimana cara mengunduh jadwal?'
    }
  ]));
  assert.equal(embeddingCalled, false);
  assert.equal(repositoryCalled, false);
});
