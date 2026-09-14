import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { readAdminCookies } from '../utils/admin-cookies.js';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAdminMutationSecurity(expectedOrigin) {
  return function adminMutationSecurity(request, _response, next) {
    if (request.get('origin') !== expectedOrigin) {
      return next(new AppError('Origin permintaan admin tidak diizinkan.', {
        status: 403,
        code: 'ORIGIN_DENIED'
      }));
    }

    const { csrfToken } = readAdminCookies(request);
    const suppliedToken = request.get('x-csrf-token') ?? '';

    if (!csrfToken || !suppliedToken || !safeEqual(csrfToken, suppliedToken)) {
      return next(new AppError('Token CSRF tidak valid.', {
        status: 403,
        code: 'CSRF_INVALID'
      }));
    }

    next();
  };
}
