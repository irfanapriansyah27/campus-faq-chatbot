import { AppError } from '../utils/errors.js';
import { readAdminCookies } from '../utils/admin-cookies.js';

export function createAdminSessionAuth(adminAuthService) {
  return async function adminSessionAuth(request, _response, next) {
    const { accessToken } = readAdminCookies(request);

    if (!accessToken) {
      return next(new AppError('Session admin diperlukan atau telah berakhir.', {
        status: 401,
        code: 'AUTH_REQUIRED'
      }));
    }

    try {
      request.admin = await adminAuthService.authenticate(accessToken);
      next();
    } catch (error) {
      next(error);
    }
  };
}
