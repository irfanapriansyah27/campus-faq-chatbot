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

