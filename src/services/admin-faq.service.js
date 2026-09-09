import { isDeepStrictEqual } from 'node:util';
import {
  adminFaqCreateSchema,
  adminFaqListQuerySchema,
  adminFaqStatusSchema,
  adminFaqUpdateSchema,
  buildCanonicalFaqContent,
  faqIdSchema,
  validateFaqStatusTransition
} from '../domain/faq.js';
import { AppError, ProviderError } from '../utils/errors.js';
import { EMBEDDING_DIMENSION } from './gemini-embedding.service.js';

function versionConflict() {
  return new AppError('FAQ telah berubah. Muat ulang data terbaru.', {
    status: 409,
    code: 'FAQ_VERSION_CONFLICT'
  });
}

function validateDocumentVector(vector) {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSION) {
    throw new ProviderError('Embedding FAQ tidak memenuhi kontrak dimensi.');
  }

  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (!Object.hasOwn(vector, index)
      || typeof value !== 'number'
      || !Number.isFinite(value)) {
      throw new ProviderError('Embedding FAQ memuat nilai yang tidak valid.');
    }
  }

  return vector;
}

export class AdminFaqService {
  constructor({ embeddingService, faqRepository }) {
    this.embeddingService = embeddingService;
    this.faqRepository = faqRepository;
  }

  async createDocumentEmbedding(content) {
    try {
      const embeddings = await this.embeddingService.createDocumentEmbeddings([content]);
      if (!Array.isArray(embeddings) || embeddings.length !== 1) {
        throw new ProviderError('Jumlah embedding FAQ tidak valid.');
      }
      return validateDocumentVector(embeddings[0]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Pembuatan embedding FAQ gagal.');
    }
  }

  async list(rawQuery = {}) {
    const query = adminFaqListQuerySchema.parse(rawQuery);
    const { data, total } = await this.faqRepository.listAdminFaqs(query);

    return {
      data,
      meta: {
        page: query.page,
        page_size: query.page_size,
        total,
        total_pages: total === 0 ? 0 : Math.ceil(total / query.page_size),
        sort_by: query.sort_by,
        sort_order: query.sort_order
      }
    };
  }

  async detail(rawId) {
    const id = faqIdSchema.parse(rawId);
    return this.faqRepository.getAdminFaqById(id);
  }

  async create(rawInput) {
    const input = adminFaqCreateSchema.parse(rawInput);
    const content = buildCanonicalFaqContent({
      question: input.question,
      answer: input.answer
    });
    const embedding = await this.createDocumentEmbedding(content);

    return this.faqRepository.insertAdminFaq({
      ...input,
      content,
      embedding,
      version: 1
    });
  }

  async update(rawId, rawInput) {
    const id = faqIdSchema.parse(rawId);
    const input = adminFaqUpdateSchema.parse(rawInput);
    const current = await this.faqRepository.getAdminFaqById(id);

    if (current.version !== input.expected_version) {
      throw versionConflict();
    }

    const proposedContent = buildCanonicalFaqContent({
      question: input.question,
      answer: input.answer
    });
    const proposedFields = {
      question: input.question,
      answer: input.answer,
      category: input.category,
      source: input.source,
      metadata: input.metadata
    };
    const effectiveChange = Object.entries(proposedFields).some(
      ([field, value]) => !isDeepStrictEqual(current[field], value)
    );
    const contentNeedsRepair = current.content !== proposedContent;

    if (!effectiveChange && !contentNeedsRepair) {
      return current;
    }

    const changes = { ...proposedFields };
    if (contentNeedsRepair) {
      changes.content = proposedContent;
      changes.embedding = await this.createDocumentEmbedding(proposedContent);
    }

    return this.faqRepository.updateAdminFaq({
      id,
      expectedVersion: input.expected_version,
      changes
    });
  }

  async updateStatus(rawId, rawInput) {
    const id = faqIdSchema.parse(rawId);
    const input = adminFaqStatusSchema.parse(rawInput);
    const current = await this.faqRepository.getAdminFaqById(id);

    if (current.version !== input.expected_version) {
      throw versionConflict();
    }

    const transition = validateFaqStatusTransition(current.status, input.status);
    if (!transition.changed) {
      return current;
    }

    return this.faqRepository.updateAdminFaqStatus({
      id,
      expectedVersion: input.expected_version,
      status: transition.status
    });
  }
}
