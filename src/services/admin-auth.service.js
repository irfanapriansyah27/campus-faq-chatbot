import { AppError } from '../utils/errors.js';

function authRequired() {
  return new AppError('Session admin diperlukan atau telah berakhir.', {
    status: 401,
    code: 'AUTH_REQUIRED'
  });
}

function adminForbidden() {
  return new AppError('Akun tidak memiliki akses administrator.', {
    status: 403,
    code: 'ADMIN_FORBIDDEN'
  });
}

function authProviderUnavailable() {
  return new AppError('Layanan autentikasi sedang tidak tersedia.', {
    status: 503,
    code: 'AUTH_PROVIDER_ERROR'
  });
}

async function cleanupLocalSession(client) {
  try {
    await client.auth.signOut({ scope: 'local' });
  } catch {
    // Best effort: error authorization utama tidak boleh tergantikan.
  }
}

export class AdminAuthService {
  constructor({ authClientFactory, adminRepository }) {
    this.authClientFactory = authClientFactory;
    this.adminRepository = adminRepository;
  }

  async authorizeUser(user) {
    if (!user?.id) {
      throw authRequired();
    }

    const membership = await this.adminRepository.findAdminByUserId(user.id);

    if (!membership || !membership.is_active || membership.role !== 'admin') {
      throw adminForbidden();
    }

    return { user, role: 'admin' };
  }

  async login({ email, password }) {
    const client = this.authClientFactory();
    let authResult;

    try {
      authResult = await client.auth.signInWithPassword({ email, password });
    } catch {
      throw authProviderUnavailable();
    }

    const { data, error } = authResult;

    if (error || !data?.session || !data?.user) {
      throw new AppError('Email atau kata sandi tidak valid.', {
        status: 401,
        code: 'AUTH_INVALID_CREDENTIALS'
      });
    }

    try {
      const authorization = await this.authorizeUser(data.user);
      return { session: data.session, ...authorization };
    } catch (authorizationError) {
      await cleanupLocalSession(client);
      throw authorizationError;
    }
  }

  async authenticate(accessToken) {
    if (!accessToken) {
      throw authRequired();
    }

    const client = this.authClientFactory();
    let authResult;

    try {
      authResult = await client.auth.getUser(accessToken);
    } catch {
      throw authProviderUnavailable();
    }

    const { data, error } = authResult;

    if (error || !data?.user) {
      throw authRequired();
    }

    return this.authorizeUser(data.user);
  }

  async refresh(refreshToken) {
    if (!refreshToken) {
      throw authRequired();
    }

    const client = this.authClientFactory();
    let authResult;

    try {
      authResult = await client.auth.refreshSession({
        refresh_token: refreshToken
      });
    } catch {
      throw authProviderUnavailable();
    }

    const { data, error } = authResult;
    const user = data?.user ?? data?.session?.user;

    if (error || !data?.session || !user) {
      throw authRequired();
    }

    try {
      const authorization = await this.authorizeUser(user);
      return { session: data.session, ...authorization };
    } catch (authorizationError) {
      await cleanupLocalSession(client);
      throw authorizationError;
    }
  }

  async logout({ accessToken, refreshToken }) {
    if (!accessToken || !refreshToken) {
      return;
    }

    const client = this.authClientFactory();

    try {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (!error) {
        await client.auth.signOut({ scope: 'local' });
      }
    } catch {
      // Cookie lokal tetap dihapus oleh route, termasuk ketika revoke gagal.
    }
  }
}
