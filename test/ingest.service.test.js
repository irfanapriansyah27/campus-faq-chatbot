import assert from 'node:assert/strict';
import test from 'node:test';
import { IngestService } from '../src/services/ingest.service.js';

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
