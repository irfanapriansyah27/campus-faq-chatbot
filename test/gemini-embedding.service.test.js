import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMBEDDING_DIMENSION,
  GeminiEmbeddingService
} from '../src/services/gemini-embedding.service.js';

function createMockClient(calls) {
  return {
    models: {
      async embedContent(request) {
        calls.push(request);
        const inputs = Array.isArray(request.contents)
          ? request.contents
          : [request.contents];

        return {
          embeddings: inputs.map(() => ({
            values: Array.from({ length: EMBEDDING_DIMENSION }, () => 0.01)
          }))
        };
      }
    }
  };
}

function createVectorClient(vector) {
  return {
    models: {
      async embedContent(request) {
        const inputs = Array.isArray(request.contents)
          ? request.contents
          : [request.contents];
        return {
          embeddings: inputs.map(() => ({ values: vector }))
        };
      }
    }
  };
}

test('embedding FAQ menggunakan RETRIEVAL_DOCUMENT dan 1536 dimensi', async () => {
  const calls = [];
  const service = new GeminiEmbeddingService({
    apiKey: 'unused-test-key',
    client: createMockClient(calls)
  });

  const vectors = await service.createDocumentEmbeddings(['FAQ pertama', 'FAQ kedua']);

  assert.equal(vectors.length, 2);
  assert.equal(vectors[0].length, 1536);
  assert.equal(calls[0].config.outputDimensionality, 1536);
  assert.equal(calls[0].config.taskType, 'RETRIEVAL_DOCUMENT');
});

test('embedding pertanyaan menggunakan RETRIEVAL_QUERY', async () => {
  const calls = [];
  const service = new GeminiEmbeddingService({
    apiKey: 'unused-test-key',
    client: createMockClient(calls)
  });

  const vector = await service.createQueryEmbedding('Bagaimana cara mendaftar?');

  assert.equal(vector.length, 1536);
  assert.equal(calls[0].config.taskType, 'RETRIEVAL_QUERY');
});

test('seluruh consumer menolak vector sparse, non-number, NaN, dan infinity', async () => {
  const sparse = Array(EMBEDDING_DIMENSION);
  const invalidVectors = [
    sparse,
    Object.assign(Array.from({ length: EMBEDDING_DIMENSION }, () => 0.01), { 17: '0.01' }),
    ...[Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((invalid) => {
      const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0.01);
      vector[17] = invalid;
      return vector;
    })
  ];

  for (const vector of invalidVectors) {
    const service = new GeminiEmbeddingService({
      apiKey: 'unused-test-key',
      client: createVectorClient(vector)
    });
    const isProviderError = (error) => error.status === 503 && error.code === 'AI_PROVIDER_ERROR';

    await assert.rejects(service.createDocumentEmbeddings(['FAQ']), isProviderError);
    await assert.rejects(service.createQueryEmbedding('Pertanyaan?'), isProviderError);
  }
});
