import { Router } from 'express';
import { createAdminMutationSecurity } from '../middleware/admin-request-security.js';
import { createAdminSessionAuth } from '../middleware/admin-session-auth.js';
import { ensureCsrfCookie } from '../utils/admin-cookies.js';

function listItemPayload(faq) {
  return {
    id: faq.id,
    faq_key: faq.faq_key,
    question: faq.question,
    answer: faq.answer,
    category: faq.category,
    status: faq.status,
    version: faq.version,
    created_at: faq.created_at,
    updated_at: faq.updated_at
  };
}

function detailPayload(faq) {
  return {
    ...listItemPayload(faq),
    source: faq.source,
    metadata: faq.metadata
  };
}

export function createAdminFaqRouter({ adminFaqService, adminAuthService, config }) {
  const router = Router();
  const requireAdminSession = createAdminSessionAuth(adminAuthService);
  const requireMutationSecurity = createAdminMutationSecurity(config.ADMIN_APP_ORIGIN);

  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    ensureCsrfCookie(request, response, config);
    next();
  });
  router.use(requireAdminSession);

  router.get('/', async (request, response) => {
    const result = await adminFaqService.list(request.query);
    response.json({
      data: result.data.map(listItemPayload),
      meta: result.meta
    });
  });

  router.post('/', requireMutationSecurity, async (request, response) => {
    const faq = await adminFaqService.create(request.body);
    response.status(201).json({
      message: 'FAQ berhasil dibuat.',
      data: detailPayload(faq)
    });
  });

  router.get('/:id', async (request, response) => {
    const faq = await adminFaqService.detail(request.params.id);
    response.json({ data: detailPayload(faq) });
  });

  router.put('/:id', requireMutationSecurity, async (request, response) => {
    const faq = await adminFaqService.update(request.params.id, request.body);
    response.json({
      message: 'FAQ berhasil diperbarui.',
      data: detailPayload(faq)
    });
  });

  router.patch('/:id/status', requireMutationSecurity, async (request, response) => {
    const faq = await adminFaqService.updateStatus(request.params.id, request.body);
    response.json({
      message: 'Status FAQ berhasil diperbarui.',
      data: detailPayload(faq)
    });
  });

  return router;
}
