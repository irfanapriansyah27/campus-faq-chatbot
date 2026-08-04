import { Router } from 'express';
import { z } from 'zod';

const ingestBodySchema = z.object({
  faqs: z.array(z.unknown()).min(1).max(100)
});

const idSchema = z.string().uuid();

export function createFaqRouter({ ingestService, faqRepository }) {
  const router = Router();

  router.get('/', async (_request, response) => {
    const faqs = await faqRepository.listFaqs();
    response.json({ data: faqs });
  });

  router.post('/', async (request, response) => {
    const { faqs } = ingestBodySchema.parse(request.body);
    const saved = await ingestService.ingest(faqs);
    response.status(201).json({
      message: `${saved.length} FAQ berhasil diproses.`,
      data: saved
    });
  });

  router.delete('/:id', async (request, response) => {
    const id = idSchema.parse(request.params.id);
    const archived = await faqRepository.archiveFaq(id);
    response.json({
      message: 'FAQ berhasil diarsipkan.',
      data: archived
    });
  });

  return router;
}

