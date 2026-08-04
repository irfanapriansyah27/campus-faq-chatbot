import { z } from 'zod';

export const faqInputSchema = z.object({
  faq_key: z.string().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]*$/),
  question: z.string().min(5).max(1000),
  answer: z.string().min(5).max(5000),
  category: z.string().min(2).max(100).default('umum'),
  source: z.string().max(500).default('admin'),
  metadata: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
  version: z.coerce.number().int().positive().default(1)
});

export class IngestService {
  constructor({ embeddingService, faqRepository }) {
    this.embeddingService = embeddingService;
    this.faqRepository = faqRepository;
  }

  async ingest(rawFaqs) {
    const faqs = z.array(faqInputSchema).min(1).max(100).parse(rawFaqs);
    const embeddingInputs = faqs.map((faq) =>
      `Pertanyaan: ${faq.question}\nJawaban: ${faq.answer}`
    );
    const embeddings = await this.embeddingService.createDocumentEmbeddings(embeddingInputs);
    const records = faqs.map((faq, index) => ({
      ...faq,
      content: embeddingInputs[index],
      embedding: embeddings[index],
      updated_at: new Date().toISOString()
    }));

    return this.faqRepository.upsertFaqs(records);
  }
}
