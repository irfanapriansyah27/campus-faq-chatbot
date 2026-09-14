import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { AppError } from '../src/utils/errors.js';
import { createApp } from '../src/app.factory.js';

const origin = 'http://localhost';
const adminUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.test'
};
const authSession = {
  access_token: 'private-access-token',
  refresh_token: 'private-refresh-token',
  expires_in: 3600
};

let server;
let baseUrl;

const config = {
  NODE_ENV: 'test',
  ADMIN_INGEST_KEY: 'test-admin-key-with-sufficient-length',
  ADMIN_APP_ORIGIN: origin,
  ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS: 604800,
  ADMIN_LOGIN_RATE_LIMIT: 100,
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  CLOUDFLARE_LLM_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  CS_FALLBACK_MESSAGE: 'Silakan hubungi customer service.',
  allowedOrigins: [origin]
};

const adminAuthService = {
  async login({ email, password }) {
    if (email !== adminUser.email || password !== 'valid-password') {
      throw new AppError('Email atau kata sandi tidak valid.', {
        status: 401,
        code: 'AUTH_INVALID_CREDENTIALS'
      });
    }
    return { session: authSession, user: adminUser, role: 'admin' };
  },
  async authenticate(accessToken) {
    if (accessToken !== authSession.access_token) {
      throw new AppError('Session admin diperlukan.', {
        status: 401,
        code: 'AUTH_REQUIRED'
      });
    }
    return { user: adminUser, role: 'admin' };
  },
  async refresh(refreshToken) {
    if (refreshToken !== authSession.refresh_token) {
      throw new AppError('Session admin tidak valid atau telah berakhir.', {
        status: 401,
        code: 'AUTH_REQUIRED'
      });
    }
    return { session: authSession, user: adminUser, role: 'admin' };
  },
  async logout() {}
};

function buildApp(
  overrides = {},
  authService = adminAuthService,
  logger = { error() {} }
) {
  return createApp({
    config: { ...config, ...overrides },
    chatService: { async answer() { return { decision: 'ANSWER', answer: 'ok', sources: [] }; } },
    ingestService: { async ingest(faqs) { return faqs; } },
    faqRepository: {
      async listFaqs() { return []; },
      async archiveFaq(id) { return { id, status: 'archived' }; }
    },
    adminAuthService: authService,
    logger
  });
}

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const value = response.headers.get('set-cookie');
  return value ? [value] : [];
}

function cookiePair(setCookies, name) {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `Cookie ${name} tidak ditemukan.`);
  return cookie.split(';', 1)[0];
}

function cookieValue(pair) {
  return decodeURIComponent(pair.slice(pair.indexOf('=') + 1));
}

async function acquireCsrf(targetBaseUrl = baseUrl) {
  const response = await fetch(`${targetBaseUrl}/api/admin/auth/session`, {
    headers: { Origin: origin }
  });
  const pair = cookiePair(getSetCookies(response), 'campus_admin_csrf');
  return { pair, token: cookieValue(pair) };
}

before(async () => {
  const app = buildApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('session hilang menghasilkan 401 AUTH_REQUIRED dan no-store', async () => {
  const response = await fetch(`${baseUrl}/api/admin/auth/session`, {
    headers: { Origin: origin }
  });
  const payload = await response.json();
  const csrfCookie = getSetCookies(response)
    .find((value) => value.startsWith('campus_admin_csrf='));

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTH_REQUIRED');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(payload.request_id);
  assert.ok(csrfCookie);
  assert.match(csrfCookie, /Path=\//);
  assert.match(csrfCookie, /SameSite=Strict/);
  assert.equal(csrfCookie.includes('HttpOnly'), false);
});

test('request_id internal tidak mempercayai x-request-id dari client', async () => {
  const response = await fetch(`${baseUrl}/api/admin/auth/session`, {
    headers: {
      Origin: origin,
      'x-request-id': 'client-controlled-request-id'
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.notEqual(payload.request_id, 'client-controlled-request-id');
  assert.equal(response.headers.get('x-request-id'), payload.request_id);
});

test('login valid memasang cookie dan tidak mengembalikan token dalam JSON', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: csrf.pair,
      'Content-Type': 'application/json',
      'x-csrf-token': csrf.token
    },
    body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);
  const cookies = getSetCookies(response);

  assert.equal(response.status, 200);
  assert.equal(payload.data.user.email, adminUser.email);
  assert.equal(payload.data.role, 'admin');
  assert.equal(serialized.includes(authSession.access_token), false);
  assert.equal(serialized.includes(authSession.refresh_token), false);
  assert.ok(cookies.some((value) => value.startsWith('campus_admin_access=')));
  assert.ok(cookies.some((value) => value.startsWith('campus_admin_refresh=')));
  const csrfCookie = cookies.find((value) => value.startsWith('campus_admin_csrf='));
  assert.ok(csrfCookie);
  assert.equal(csrfCookie.includes('HttpOnly'), false);
  assert.equal(csrfCookie.includes(authSession.access_token), false);
  assert.equal(csrfCookie.includes(authSession.refresh_token), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('login invalid memakai pesan generik', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: csrf.pair,
      'Content-Type': 'application/json',
      'x-csrf-token': csrf.token
    },
    body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong' })
  });
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTH_INVALID_CREDENTIALS');
  assert.equal(payload.error.message, 'Email atau kata sandi tidak valid.');
});

test('login dengan repository error tidak memasang cookie session', async () => {
  const failingService = {
    ...adminAuthService,
    async login() {
      throw new AppError('Pemeriksaan otorisasi admin gagal.', {
        status: 503,
        code: 'ADMIN_REPOSITORY_ERROR'
      });
    }
  };
  const failingApp = buildApp({}, failingService);
  let failingServer;
  await new Promise((resolve) => {
    failingServer = failingApp.listen(0, '127.0.0.1', resolve);
  });
  const failingBaseUrl = `http://127.0.0.1:${failingServer.address().port}`;

  try {
    const csrf = await acquireCsrf(failingBaseUrl);
    const response = await fetch(`${failingBaseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: csrf.pair,
        'Content-Type': 'application/json',
        'x-csrf-token': csrf.token
      },
      body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
    });
    const cookies = getSetCookies(response);

    assert.equal(response.status, 503);
    assert.equal(cookies.some((value) => value.startsWith('campus_admin_access=')), false);
    assert.equal(cookies.some((value) => value.startsWith('campus_admin_refresh=')), false);
  } finally {
    await new Promise((resolve, reject) => {
      failingServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('error Supabase dan credential sentinel tidak masuk log atau response', async () => {
  const sentinels = [
    'supabase-auth-provider-sentinel',
    'supabase-repository-cause-sentinel',
    'access-token-sentinel',
    'password-sentinel',
    'cookie-sentinel'
  ];
  const logEntries = [];
  const sanitizedApp = buildApp({}, {
    ...adminAuthService,
    async login() {
      throw new AppError(sentinels[0], {
        status: 503,
        code: 'AUTH_PROVIDER_ERROR',
        cause: new Error(sentinels[1])
      });
    }
  }, {
    error(entry) {
      logEntries.push(entry);
    }
  });
  let sanitizedServer;
  await new Promise((resolve) => {
    sanitizedServer = sanitizedApp.listen(0, '127.0.0.1', resolve);
  });
  const sanitizedBaseUrl = `http://127.0.0.1:${sanitizedServer.address().port}`;

  try {
    const csrf = await acquireCsrf(sanitizedBaseUrl);
    logEntries.length = 0;
    const response = await fetch(`${sanitizedBaseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `${csrf.pair}; probe_cookie=${sentinels[4]}`,
        Authorization: `Bearer ${sentinels[2]}`,
        'Content-Type': 'application/json',
        'x-csrf-token': csrf.token
      },
      body: JSON.stringify({ email: adminUser.email, password: sentinels[3] })
    });
    const payload = await response.json();
    const serializedOutput = JSON.stringify({ logEntries, payload });

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'AUTH_PROVIDER_ERROR');
    assert.equal(payload.error.message, 'Terjadi gangguan pada server.');
    for (const sentinel of sentinels) {
      assert.equal(serializedOutput.includes(sentinel), false, `Sentinel bocor: ${sentinel}`);
    }
    assert.equal(logEntries.length, 1);
    assert.deepEqual(Object.keys(logEntries[0]).sort(), ['code', 'path', 'requestId']);
  } finally {
    await new Promise((resolve, reject) => {
      sanitizedServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('session valid mengembalikan identitas admin tanpa token', async () => {
  const response = await fetch(`${baseUrl}/api/admin/auth/session`, {
    headers: {
      Origin: origin,
      Cookie: `campus_admin_access=${encodeURIComponent(authSession.access_token)}`
    }
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.data.user.id, adminUser.id);
  assert.equal(serialized.includes(authSession.access_token), false);
});

test('refresh berhasil merotasi cookie tanpa token pada JSON', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/refresh`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: `${csrf.pair}; campus_admin_refresh=${encodeURIComponent(authSession.refresh_token)}`,
      'x-csrf-token': csrf.token
    }
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.data.role, 'admin');
  assert.equal(serialized.includes(authSession.refresh_token), false);
  assert.ok(getSetCookies(response).some((value) => value.startsWith('campus_admin_refresh=')));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('refresh gagal menghapus cookie session lokal', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/refresh`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: `${csrf.pair}; campus_admin_refresh=invalid`,
      'x-csrf-token': csrf.token
    }
  });
  const payload = await response.json();
  const cookies = getSetCookies(response);

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTH_REQUIRED');
  assert.ok(cookies.some((value) => value.startsWith('campus_admin_access=') && value.includes('Max-Age=0')));
  assert.ok(cookies.some((value) => value.startsWith('campus_admin_refresh=') && value.includes('Max-Age=0')));
});

test('refresh yang ditolak membership hanya mengirim cookie deletion', async () => {
  const forbiddenRefreshService = {
    ...adminAuthService,
    async refresh() {
      throw new AppError('Akun tidak memiliki akses administrator.', {
        status: 403,
        code: 'ADMIN_FORBIDDEN'
      });
    }
  };
  const forbiddenApp = buildApp({}, forbiddenRefreshService);
  let forbiddenServer;
  await new Promise((resolve) => {
    forbiddenServer = forbiddenApp.listen(0, '127.0.0.1', resolve);
  });
  const forbiddenBaseUrl = `http://127.0.0.1:${forbiddenServer.address().port}`;

  try {
    const csrf = await acquireCsrf(forbiddenBaseUrl);
    const response = await fetch(`${forbiddenBaseUrl}/api/admin/auth/refresh`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `${csrf.pair}; campus_admin_refresh=${authSession.refresh_token}`,
        'x-csrf-token': csrf.token
      }
    });
    const sessionCookies = getSetCookies(response)
      .filter((value) => /^(campus_admin_access|campus_admin_refresh)=/.test(value));

    assert.equal(response.status, 403);
    assert.equal(sessionCookies.length, 2);
    assert.ok(sessionCookies.every((value) => value.includes('Max-Age=0')));
  } finally {
    await new Promise((resolve, reject) => {
      forbiddenServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('logout selalu menghapus cookie dengan atribut konsisten', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: [
        csrf.pair,
        `campus_admin_access=${encodeURIComponent(authSession.access_token)}`,
        `campus_admin_refresh=${encodeURIComponent(authSession.refresh_token)}`
      ].join('; '),
      'x-csrf-token': csrf.token
    }
  });
  const cookies = getSetCookies(response);

  assert.equal(response.status, 204);
  assert.ok(cookies.some((value) => value.startsWith('campus_admin_access=')
    && value.includes('HttpOnly')
    && value.includes('SameSite=Strict')
    && value.includes('Path=/api/admin')
    && value.includes('Max-Age=0')));
  assert.ok(cookies.some((value) => value.startsWith('campus_admin_refresh=')
    && value.includes('HttpOnly')
    && value.includes('Path=/api/admin')
    && value.includes('Max-Age=0')));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('logout tetap menghapus cookie ketika revoke Supabase gagal', async () => {
  const failingLogoutService = {
    ...adminAuthService,
    async logout() {
      throw new Error('auth provider unavailable');
    }
  };
  const failingApp = buildApp({}, failingLogoutService);
  let failingServer;
  await new Promise((resolve) => {
    failingServer = failingApp.listen(0, '127.0.0.1', resolve);
  });
  const failingBaseUrl = `http://127.0.0.1:${failingServer.address().port}`;

  try {
    const csrf = await acquireCsrf(failingBaseUrl);
    const response = await fetch(`${failingBaseUrl}/api/admin/auth/logout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: [
          csrf.pair,
          `campus_admin_access=${encodeURIComponent(authSession.access_token)}`,
          `campus_admin_refresh=${encodeURIComponent(authSession.refresh_token)}`
        ].join('; '),
        'x-csrf-token': csrf.token
      }
    });
    const cookies = getSetCookies(response);

    assert.equal(response.status, 500);
    assert.ok(cookies.some((value) => value.startsWith('campus_admin_access=')
      && value.includes('Max-Age=0')));
    assert.ok(cookies.some((value) => value.startsWith('campus_admin_refresh=')
      && value.includes('Max-Age=0')));
  } finally {
    await new Promise((resolve, reject) => {
      failingServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('mutasi tanpa CSRF valid ditolak', async () => {
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'CSRF_INVALID');
});

test('CSRF dengan panjang berbeda ditolak 403 tanpa menghasilkan 500', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: csrf.pair,
      'Content-Type': 'application/json',
      'x-csrf-token': `${csrf.token}extra`
    },
    body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'CSRF_INVALID');
});

test('preflight OPTIONS endpoint login tetap dilayani CORS tanpa CSRF', async () => {
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token'
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
});

test('origin asing ditolak', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: {
      Origin: 'https://foreign.example.test',
      Cookie: csrf.pair,
      'Content-Type': 'application/json',
      'x-csrf-token': csrf.token
    },
    body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.ok(['CORS_ORIGIN_DENIED', 'ORIGIN_DENIED'].includes(payload.error.code));
});

test('mutasi tanpa Origin ditolak oleh exact-origin validation', async () => {
  const csrf = await acquireCsrf();
  const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: {
      Cookie: csrf.pair,
      'Content-Type': 'application/json',
      'x-csrf-token': csrf.token
    },
    body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'ORIGIN_DENIED');
});

test('login memiliki rate limit dengan error envelope proyek', async () => {
  const limitedApp = buildApp({ ADMIN_LOGIN_RATE_LIMIT: 1 });
  let limitedServer;
  await new Promise((resolve) => {
    limitedServer = limitedApp.listen(0, '127.0.0.1', resolve);
  });
  const limitedBaseUrl = `http://127.0.0.1:${limitedServer.address().port}`;

  try {
    const csrf = await acquireCsrf(limitedBaseUrl);
    const requestOptions = {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: csrf.pair,
        'Content-Type': 'application/json',
        'x-csrf-token': csrf.token
      },
      body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong' })
    };

    const first = await fetch(`${limitedBaseUrl}/api/admin/auth/login`, requestOptions);
    const second = await fetch(`${limitedBaseUrl}/api/admin/auth/login`, requestOptions);
    const payload = await second.json();

    assert.equal(first.status, 401);
    assert.equal(second.status, 429);
    assert.equal(payload.error.code, 'RATE_LIMITED');
    assert.ok(payload.request_id);
  } finally {
    await new Promise((resolve, reject) => {
      limitedServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('cookie production memiliki Secure, HttpOnly, SameSite, Path, dan Max-Age', async () => {
  const productionApp = buildApp({ NODE_ENV: 'production' });
  let productionServer;
  await new Promise((resolve) => {
    productionServer = productionApp.listen(0, '127.0.0.1', resolve);
  });
  const productionBaseUrl = `http://127.0.0.1:${productionServer.address().port}`;

  try {
    const csrf = await acquireCsrf(productionBaseUrl);
    const response = await fetch(`${productionBaseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: csrf.pair,
        'Content-Type': 'application/json',
        'x-csrf-token': csrf.token
      },
      body: JSON.stringify({ email: adminUser.email, password: 'valid-password' })
    });
    const cookies = getSetCookies(response);
    const accessCookie = cookies.find((value) => value.startsWith('campus_admin_access='));
    const refreshCookie = cookies.find((value) => value.startsWith('campus_admin_refresh='));
    const csrfCookie = cookies.find((value) => value.startsWith('campus_admin_csrf='));

    assert.equal(response.status, 200);
    assert.match(accessCookie, /; HttpOnly/);
    assert.match(accessCookie, /; Secure/);
    assert.match(accessCookie, /; SameSite=Strict/);
    assert.match(accessCookie, /; Path=\/api\/admin/);
    assert.match(accessCookie, /; Max-Age=3600/);
    assert.match(refreshCookie, /; HttpOnly/);
    assert.match(refreshCookie, /; Secure/);
    assert.match(refreshCookie, /; SameSite=Strict/);
    assert.match(refreshCookie, /; Path=\/api\/admin/);
    assert.match(refreshCookie, /; Max-Age=604800/);
    assert.match(csrfCookie, /; Secure/);
    assert.match(csrfCookie, /; SameSite=Strict/);
    assert.match(csrfCookie, /; Path=\//);
    assert.equal(csrfCookie.includes('HttpOnly'), false);

    const logoutResponse = await fetch(`${productionBaseUrl}/api/admin/auth/logout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: [
          csrf.pair,
          `campus_admin_access=${authSession.access_token}`,
          `campus_admin_refresh=${authSession.refresh_token}`
        ].join('; '),
        'x-csrf-token': csrf.token
      }
    });
    const deletedSessionCookies = getSetCookies(logoutResponse)
      .filter((value) => /^(campus_admin_access|campus_admin_refresh)=/.test(value));
    assert.equal(logoutResponse.status, 204);
    assert.equal(deletedSessionCookies.length, 2);
    for (const cookie of deletedSessionCookies) {
      assert.match(cookie, /; Secure/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /; SameSite=Strict/);
      assert.match(cookie, /; Path=\/api\/admin/);
      assert.match(cookie, /; Max-Age=0/);
      assert.match(cookie, /; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    }
  } finally {
    await new Promise((resolve, reject) => {
      productionServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('endpoint legacy ADMIN_INGEST_KEY tetap berfungsi', async () => {
  const response = await fetch(`${baseUrl}/api/faqs`, {
    headers: { 'x-admin-key': config.ADMIN_INGEST_KEY }
  });

  assert.equal(response.status, 200);
});

test('/admin menyajikan halaman login minimal', async () => {
  const response = await fetch(`${baseUrl}/admin`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Login Admin/);
  assert.doesNotMatch(html, /retrieval tester|import FAQ|statistik/i);
});
