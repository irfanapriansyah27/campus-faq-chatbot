import { GoogleGenAI } from '@google/genai';
import { ProviderError } from '../utils/errors.js';

const EMBEDDING_DIMENSION = 1536;

export class GeminiEmbeddingService {
  constructor({ apiKey, model = 'gemini-embedding-001', client }) {
    this.model = model;
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async createEmbeddings(inputs, taskType) {
    try {
      const result = await this.client.models.embedContent({
        model: this.model,
        contents: inputs,
        config: {
          outputDimensionality: EMBEDDING_DIMENSION,
          taskType
        }
      });
      const vectors = result?.embeddings?.map((embedding) => embedding.values);

      if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
        throw new Error('Jumlah embedding tidak sama dengan jumlah input.');
      }

      for (const vector of vectors) {
        if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSION) {
          throw new Error(
            `Dimensi embedding harus ${EMBEDDING_DIMENSION}, tetapi Gemini mengembalikan ${vector?.length ?? 0}.`
          );
        }
      }

      return vectors;
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError('Pembuatan embedding melalui Gemini gagal.', error);
    }
  }

  async createDocumentEmbeddings(inputs) {
    return this.createEmbeddings(inputs, 'RETRIEVAL_DOCUMENT');
  }

  async createQueryEmbedding(input) {
    const [vector] = await this.createEmbeddings([input], 'RETRIEVAL_QUERY');
    return vector;
  }
}

export { EMBEDDING_DIMENSION };

