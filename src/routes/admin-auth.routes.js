import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createAdminMutationSecurity } from '../middleware/admin-request-security.js';
import { createAdminSessionAuth } from '../middleware/admin-session-auth.js';
import {
  clearAdminSessionCookies,
  ensureCsrfCookie,
  readAdminCookies,
  setAdminSessionCookies
} from '../utils/admin-cookies.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024)
}).strict();

function adminPayload({ user, role }) {
  return {
    authenticated: true,
    user: {
      id: user.id,
      email: user.email ?? null
    },
    role
  };
}

export function createAdminLoginRateLimiter({ limit = 10 } = {}) {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Terlalu banyak percobaan login. Silakan coba kembali nanti.'
        },
        request_id: request.requestId
      });
    }
  });
}

export function createAdminAuthRouter({
  adminAuthService,
  config,
  loginRateLimiter = createAdminLoginRateLimiter({
    limit: config.ADMIN_LOGIN_RATE_LIMIT
  })
}) {
  const router = Router();
  const requireMutationSecurity = createAdminMutationSecurity(config.ADMIN_APP_ORIGIN);
  const requireAdminSession = createAdminSessionAuth(adminAuthService);

  router.use((request, response, next) => {
    response.set('Cache-Control', 'no-store');
    ensureCsrfCookie(request, response, config);
    next();
  });

  router.post('/login', requireMutationSecurity, loginRateLimiter, async (request, response) => {
    const credentials = loginSchema.parse(request.body);
    const result = await adminAuthService.login(credentials);

    setAdminSessionCookies(response, result.session, config);
    response.json({ data: adminPayload(result) });
  });

  router.post('/refresh', requireMutationSecurity, async (request, response, next) => {
    const { refreshToken } = readAdminCookies(request);

    try {
      const result = await adminAuthService.refresh(refreshToken);
      setAdminSessionCookies(response, result.session, config);
      response.json({ data: adminPayload(result) });
    } catch (error) {
      clearAdminSessionCookies(response, config);
      next(error);
    }
  });

  router.post('/logout', requireMutationSecurity, async (request, response) => {
    const { accessToken, refreshToken } = readAdminCookies(request);

    try {
      await adminAuthService.logout({ accessToken, refreshToken });
    } finally {
      clearAdminSessionCookies(response, config);
    }
    response.status(204).end();
  });

  router.get('/session', requireAdminSession, (request, response) => {
    response.json({ data: adminPayload(request.admin) });
  });

  return router;
}
