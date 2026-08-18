import crypto from 'node:crypto';
import { ZodError } from 'zod';

export function notFoundHandler(request, response) {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint tidak ditemukan.'
    }
  });
}

export function createErrorHandler({ fallbackMessage, logger = console }) {
  return function errorHandler(error, request, response, _next) {
    const requestId = request.get('x-request-id') ?? crypto.randomUUID();

    logger.error({
      requestId,
      path: request.originalUrl,
      code: error.code,
      message: error.message,
      cause: error.cause?.message
    });

    if (error.code === 'CORS_ORIGIN_DENIED') {
      return response.status(403).json({
        error: {
          code: error.code,
          message: error.message
        },
        request_id: requestId
      });
    }

    const malformedJson = error instanceof SyntaxError
      && error.status === 400
      && error.type === 'entity.parse.failed';

    if (error instanceof ZodError || malformedJson) {
      const details = error instanceof ZodError
        ? error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
        : undefined;

      return response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Data permintaan tidak valid.',
          ...(details ? { details } : {})
        },
        request_id: requestId
      });
    }

    if (request.originalUrl.startsWith('/api/chat')) {
      return response.status(error.status ?? 503).json({
        decision: 'HANDOFF',
        answer: fallbackMessage,
        sources: [],
        handoff: {
          provider: 'tawk.to',
          action: 'OPEN_WIDGET',
          reason: 'SERVICE_UNAVAILABLE'
        },
        request_id: requestId
      });
    }

    return response.status(error.status ?? 500).json({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: error.status && error.status < 500
          ? error.message
          : 'Terjadi gangguan pada server.'
      },
      request_id: requestId
    });
  };
}
