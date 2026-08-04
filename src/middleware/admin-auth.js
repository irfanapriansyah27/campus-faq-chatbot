import crypto from 'node:crypto';

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createAdminAuth(expectedKey) {
  return function adminAuth(request, response, next) {
    const authorization = request.get('authorization') ?? '';
    const suppliedKey = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : request.get('x-admin-key') ?? '';

    if (!suppliedKey || !safeEqual(suppliedKey, expectedKey)) {
      return response.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Kunci admin tidak valid.'
        }
      });
    }

    next();
  };
}

