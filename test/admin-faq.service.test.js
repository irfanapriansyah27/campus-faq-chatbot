import assert from 'node:assert/strict';
import test from 'node:test';
import { EMBEDDING_DIMENSION } from '../src/services/gemini-embedding.service.js';
import { AdminFaqService } from '../src/services/admin-faq.service.js';

const faqId = '11111111-1111-4111-8111-111111111111';
const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0.01);
const current = {
  id: faqId,
  faq_key: 'jadwal-kuliah',
  question: 'Di mana saya melihat jadwal kuliah?',
  answer: 'Jadwal tersedia melalui sistem informasi akademik.',
  category: 'akademik',
  source: 'panduan akademik',
  metadata: {},
  status: 'draft',
  version: 3,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-02T00:00:00.000Z'
};
current.content = `Pertanyaan: ${current.question}\nJawaban: ${current.answer}`;

function createHarness({ embeddingResult = [vector], embeddingError } = {}) {
  const calls = {
    embeddings: [],
    inserts: [],
    updates: [],
    statuses: [],
    details: [],
    lists: []
  };
  const embeddingService = {
    async createDocumentEmbeddings(inputs) {
      calls.embeddings.push(inputs);
      if (embeddingError) throw embeddingError;
      return embeddingResult;
    }
  };
  const faqRepository = {
    async listAdminFaqs(query) {
      calls.lists.push(query);
      return { data: [current], total: 1 };
    },
    async getAdminFaqById(id) {
      calls.details.push(id);
      return current;
    },
    async insertAdminFaq(record) {
      calls.inserts.push(record);
      return { ...current, ...record, id: faqId };
    },
    async updateAdminFaq(input) {
      calls.updates.push(input);
      return { ...current, ...input.changes, version: input.expectedVersion + 1 };
    },
    async updateAdminFaqStatus(input) {
      calls.statuses.push(input);
      return { ...current, status: input.status, version: input.expectedVersion + 1 };
    }
  };

  return {
    calls,
    service: new AdminFaqService({ embeddingService, faqRepository })
  };
}

const createInput = {
  faq_key: 'jadwal-kuliah',
  question: current.question,
  answer: current.answer,
  category: current.category,
  source: current.source,
  metadata: current.metadata
};

const updateInput = {
  question: current.question,
  answer: current.answer,
  category: current.category,
  source: current.source,
  metadata: current.metadata,
  expected_version: current.version
};

test('create membuat embedding sebelum insert dan mengirim draft eksplisit', async () => {
  const { service, calls } = createHarness();
  const saved = await service.create(createInput);

  assert.equal(saved.status, 'draft');
  assert.equal(calls.embeddings.length, 1);
  assert.equal(calls.inserts.length, 1);
  assert.equal(
    calls.embeddings[0][0],
    `Pertanyaan: ${current.question}\nJawaban: ${current.answer}`
  );
  assert.equal(calls.inserts[0].content, calls.embeddings[0][0]);
  assert.equal(calls.inserts[0].embedding.length, EMBEDDING_DIMENSION);
  assert.equal(calls.inserts[0].version, 1);
});

test('provider failure dan vector invalid menghasilkan zero write', async () => {
  const providerHarness = createHarness({ embeddingError: new Error('provider sentinel') });
  await assert.rejects(providerHarness.service.create(createInput));
  assert.equal(providerHarness.calls.inserts.length, 0);

  for (const invalidVector of [
    [0.1],
    Array(EMBEDDING_DIMENSION),
    Array.from({ length: EMBEDDING_DIMENSION }, () => Number.NaN),
    Array.from({ length: EMBEDDING_DIMENSION }, () => '0.1'),
    ...[Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((invalidValue) => {
      const invalidVector = [...vector];
      invalidVector[17] = invalidValue;
      return invalidVector;
    })
  ]) {
    const harness = createHarness({ embeddingResult: [invalidVector] });
    await assert.rejects(
      harness.service.create(createInput),
      (error) => error.status === 503 && error.code === 'AI_PROVIDER_ERROR'
    );
    assert.equal(harness.calls.inserts.length, 0);
  }
});

test('perubahan question mengganti canonical content dan vector dalam satu update', async () => {
  const { service, calls } = createHarness();
  await service.update(faqId, {
    ...updateInput,
    question: 'Bagaimana cara melihat jadwal terbaru?'
  });

  assert.equal(calls.embeddings.length, 1);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].expectedVersion, current.version);
  assert.equal(calls.updates[0].changes.embedding, vector);
  assert.match(calls.updates[0].changes.content, /^Pertanyaan: Bagaimana/);
  assert.equal(calls.updates[0].changes.faq_key, undefined);
});

test('perubahan field non-retrieval tidak memanggil provider dan mempertahankan vector', async () => {
  const { service, calls } = createHarness();
  await service.update(faqId, {
    ...updateInput,
    category: 'layanan akademik',
    metadata: { audience: 'mahasiswa' }
  });

  assert.equal(calls.embeddings.length, 0);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].changes.embedding, undefined);
  assert.equal(calls.updates[0].changes.content, undefined);
});

test('stored canonical content yang stale dipulihkan dengan embedding baru sebelum update', async () => {
  const { service, calls } = createHarness();
  service.faqRepository.getAdminFaqById = async () => ({
    ...current,
    content: 'content lama yang tidak sesuai'
  });

  await service.update(faqId, {
    ...updateInput,
    category: 'layanan akademik'
  });

  assert.equal(calls.embeddings.length, 1);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].changes.content, current.content);
  assert.equal(calls.updates[0].changes.embedding, vector);
});

test('stored content stale dipulihkan walau seluruh field request identik', async () => {
  const { service, calls } = createHarness();
  service.faqRepository.getAdminFaqById = async () => ({
    ...current,
    content: 'content lama yang tidak sesuai'
  });

  const saved = await service.update(faqId, updateInput);

  assert.equal(calls.embeddings.length, 1);
  assert.equal(calls.updates.length, 1);
  assert.equal(calls.updates[0].expectedVersion, current.version);
  assert.equal(calls.updates[0].changes.content, current.content);
  assert.equal(calls.updates[0].changes.embedding, vector);
  assert.equal(saved.version, current.version + 1);
});

test('provider failure saat stale-content repair menghasilkan zero database write', async () => {
  const { service, calls } = createHarness({
    embeddingError: new Error('provider stale-content sentinel')
  });
  service.faqRepository.getAdminFaqById = async () => ({
    ...current,
    content: 'content lama yang tidak sesuai'
  });

  await assert.rejects(
    service.update(faqId, updateInput),
    (error) => error.status === 503 && error.code === 'AI_PROVIDER_ERROR'
  );
  assert.equal(calls.embeddings.length, 1);
  assert.equal(calls.updates.length, 0);
});

test('stale-content repair tetap kalah pada CAS conflict setelah embedding dibuat', async () => {
  const { service, calls } = createHarness();
  service.faqRepository.getAdminFaqById = async () => ({
    ...current,
    content: 'content lama yang tidak sesuai'
  });
  service.faqRepository.updateAdminFaq = async (input) => {
    calls.updates.push(input);
    const error = new Error('FAQ telah berubah.');
    error.status = 409;
    error.code = 'FAQ_VERSION_CONFLICT';
    throw error;
  };

  await assert.rejects(
    service.update(faqId, updateInput),
    (error) => error.status === 409 && error.code === 'FAQ_VERSION_CONFLICT'
  );
  assert.equal(calls.embeddings.length, 1);
  assert.equal(calls.updates.length, 1);
});

test('field identik dengan canonical content konsisten tetap true no-op', async () => {
  const { service, calls } = createHarness();

  const saved = await service.update(faqId, updateInput);

  assert.equal(saved, current);
  assert.equal(calls.embeddings.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('stale version berhenti sebelum provider atau mutation', async () => {
  const { service, calls } = createHarness();

  await assert.rejects(
    service.update(faqId, {
      ...updateInput,
      question: 'Pertanyaan yang berubah?',
      expected_version: 2
    }),
    (error) => error.status === 409 && error.code === 'FAQ_VERSION_CONFLICT'
  );
  assert.equal(calls.embeddings.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('status-only tidak memanggil provider, archive menjaga row, dan no-op tidak menaikkan version', async () => {
  const { service, calls } = createHarness();
  const archived = await service.updateStatus(faqId, {
    status: 'archived',
    expected_version: current.version
  });
  assert.equal(archived.status, 'archived');
  assert.equal(calls.statuses.length, 1);
  assert.equal(calls.embeddings.length, 0);
  assert.equal(calls.statuses[0].embedding, undefined);

  const noOp = await service.updateStatus(faqId, {
    status: 'draft',
    expected_version: current.version
  });
  assert.equal(noOp.version, current.version);
  assert.equal(calls.statuses.length, 1);
});

test('invalid lifecycle menghasilkan zero mutation', async () => {
  const { service, calls } = createHarness();
  const originalDetail = service.faqRepository.getAdminFaqById;
  service.faqRepository.getAdminFaqById = async () => ({ ...current, status: 'archived' });

  await assert.rejects(
    service.updateStatus(faqId, {
      status: 'published',
      expected_version: current.version
    }),
    (error) => error.status === 409 && error.code === 'FAQ_STATUS_TRANSITION_INVALID'
  );
  assert.equal(calls.statuses.length, 0);
  service.faqRepository.getAdminFaqById = originalDetail;
});

test('list mengembalikan metadata exact dan detail diteruskan', async () => {
  const { service, calls } = createHarness();
  const result = await service.list({ page: '2', page_size: '10' });

  assert.deepEqual(result.meta, {
    page: 2,
    page_size: 10,
    total: 1,
    total_pages: 1,
    sort_by: 'updated_at',
    sort_order: 'desc'
  });
  assert.equal(calls.lists[0].status, 'all');
  assert.equal((await service.detail(faqId)).id, faqId);
});
