import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createAdminAuth } from './middleware/admin-auth.js';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createChatRouter } from './routes/chat.routes.js';
import { createFaqRouter } from './routes/faq.routes.js';
import { AppError } from './utils/errors.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, '../public');

export function createApp({ config, chatService, ingestService, faqRepository, logger = console }) {
  const app = express();
  const adminAuth = createAdminAuth(config.ADMIN_INGEST_KEY);

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new AppError('Origin tidak diizinkan oleh CORS.', {
        status: 403,
        code: 'CORS_ORIGIN_DENIED'
      }));
    }
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(publicDirectory));

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'campus-faq-chatbot',
      embedding_model: config.GEMINI_EMBEDDING_MODEL,
      embedding_dimension: 1536,
      llm_model: config.CLOUDFLARE_LLM_MODEL
    });
  });

  app.use('/api/chat', rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  }), createChatRouter(chatService));

  const faqRouter = createFaqRouter({ ingestService, faqRepository });
  app.use('/api/faqs', adminAuth, faqRouter);
  app.post('/api/ingest', adminAuth, async (request, response) => {
    const saved = await ingestService.ingest(request.body.faqs);
    response.status(201).json({
      message: `${saved.length} FAQ berhasil diproses.`,
      data: saved
    });
  });

  app.use(notFoundHandler);
  app.use(createErrorHandler({
    fallbackMessage: config.CS_FALLBACK_MESSAGE,
    logger
  }));

  return app;
}
