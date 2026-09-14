import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.factory.js';
import { AdminFaqService } from '../src/services/admin-faq.service.js';
import { EMBEDDING_DIMENSION } from '../src/services/gemini-embedding.service.js';
import { AppError, ProviderError } from '../src/utils/errors.js';

const origin = 'http://admin.example.test';
const faqId = '11111111-1111-4111-8111-111111111111';
const missingId = '22222222-2222-4222-8222-222222222222';
const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0.01);
const adminUser = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@example.test'
};

let server;
let baseUrl;
let currentFaq;
let listCalls;

const config = {
  NODE_ENV: 'test',
  ADMIN_INGEST_KEY: 'legacy-admin-key-with-sufficient-length',
  ADMIN_APP_ORIGIN: origin,
  ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS: 604800,
  ADMIN_LOGIN_RATE_LIMIT: 10,
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  CLOUDFLARE_LLM_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  CS_FALLBACK_MESSAGE: 'Silakan hubungi customer service.',
  allowedOrigins: [origin]
};

function resetFaq() {
  currentFaq = {
    id: faqId,
    faq_key: 'jadwal-kuliah',
    question: 'Di mana saya melihat jadwal kuliah?',
    answer: 'Jadwal tersedia melalui sistem informasi akademik.',
    category: 'akademik',
    source: 'panduan akademik',
    metadata: {},
    status: 'draft',
    version: 1,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
    embedding: vector,
    content: 'internal canonical content'
  };
  listCalls = 0;
}

const adminAuthService = {
  async authenticate(accessToken) {
    if (accessToken === 'inactive-session') {
      throw new AppError('Akun tidak memiliki akses administrator.', {
        status: 403,
        code: 'ADMIN_FORBIDDEN'
      });
    }
    if (accessToken !== 'active-session') {
      throw new AppError('Session admin diperlukan atau telah berakhir.', {
        status: 401,
        code: 'AUTH_REQUIRED'
      });
    }
    return { user: adminUser, role: 'admin' };
  },
  async login() {
    throw new Error('not used');
  },
  async refresh() {
    throw new AppError('Session admin diperlukan atau telah berakhir.', {
      status: 401,
      code: 'AUTH_REQUIRED'
    });
  },
  async logout() {}
};

const faqRepository = {
  async listFaqs() {
    return [];
  },
  async archiveFaq(id) {
    return { id, status: 'archived' };
  },
  async listAdminFaqs() {
    listCalls += 1;
    return { data: [currentFaq], total: 1 };
  },
  async getAdminFaqById(id) {
    if (id === missingId) {
      throw new AppError('FAQ tidak ditemukan.', {
        status: 404,
        code: 'FAQ_NOT_FOUND'
      });
    }
    return currentFaq;
  },
  async insertAdminFaq(record) {
    currentFaq = {
      ...currentFaq,
      ...record,
      id: faqId,
      created_at: currentFaq.created_at,
      updated_at: currentFaq.updated_at
    };
    return currentFaq;
  },
  async updateAdminFaq({ expectedVersion, changes }) {
    currentFaq = { ...currentFaq, ...changes, version: expectedVersion + 1 };
    return currentFaq;
  },
  async updateAdminFaqStatus({ expectedVersion, status }) {
    currentFaq = { ...currentFaq, status, version: expectedVersion + 1 };
    return currentFaq;
  }
};

const embeddingService = {
  async createDocumentEmbeddings(inputs) {
    if (inputs[0].includes('provider gagal')) {
      throw new ProviderError('provider sentinel');
    }
    return [vector];
  }
};

const adminFaqService = new AdminFaqService({ embeddingService, faqRepository });

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const combined = response.headers.get('set-cookie');
  return combined ? [combined] : [];
}

async function acquireCsrf() {
  const response = await fetch(`${baseUrl}/api/admin/auth/session`);
  const cookie = getSetCookies(response)
    .find((value) => value.startsWith('campus_admin_csrf='));
  const pair = cookie.split(';', 1)[0];
  return {
    pair,
    token: decodeURIComponent(pair.slice(pair.indexOf('=') + 1))
  };
}

function authenticatedCookie(access = 'active-session') {
  return `campus_admin_access=${encodeURIComponent(access)}`;
}

async function mutationOptions(method, body, access = 'active-session') {
  const csrf = await acquireCsrf();
  return {
    method,
    headers: {
      Origin: origin,
      Cookie: `${csrf.pair}; ${authenticatedCookie(access)}`,
      'Content-Type': 'application/json',
      'x-csrf-token': csrf.token
    },
    body: JSON.stringify(body)
  };
}

before(async () => {
  resetFaq();
  const app = createApp({
    config,
    chatService: {
      async answer() {
        return { decision: 'HANDOFF', answer: 'fallback', sources: [] };
      }
    },
    ingestService: {
      async ingest(faqs) {
        return faqs;
      }
    },
    faqRepository,
    adminAuthService,
    adminFaqService,
    logger: { error() {} }
  });

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

test('admin FAQ list memerlukan session dan no-store pada error', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`);
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error.code, 'AUTH_REQUIRED');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(listCalls, 0);
});

test('early CORS denial pada admin API tetap no-store', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, {
    headers: { Origin: 'http://foreign.example.test' }
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'CORS_ORIGIN_DENIED');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('malformed JSON pada admin API tetap no-store sebelum auth middleware', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json'
    },
    body: '{'
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('payload admin yang melewati body limit menghasilkan 413 no-store', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ oversized: 'x'.repeat(1024 * 1024) })
  });

  assert.equal(response.status, 413);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('kebijakan no-store admin tidak diterapkan ke public health', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.notEqual(response.headers.get('cache-control'), 'no-store');
});

test('inactive admin ditolak pada request berikutnya', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, {
    headers: { Cookie: authenticatedCookie('inactive-session') }
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'ADMIN_FORBIDDEN');
  assert.equal(listCalls, 0);
});

test('GET list memerlukan session tanpa CSRF dan mengecualikan vector/internal content', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs?page=1&page_size=20`, {
    headers: { Cookie: authenticatedCookie() }
  });
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(payload.meta.total, 1);
  assert.equal(payload.data[0].faq_key, currentFaq.faq_key);
  assert.equal(serialized.includes('embedding'), false);
  assert.equal(serialized.includes('internal canonical content'), false);
});

test('GET detail mengembalikan 404 terstruktur dan no-store', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs/${missingId}`, {
    headers: { Cookie: authenticatedCookie() }
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, 'FAQ_NOT_FOUND');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('mutasi admin FAQ menolak request tanpa origin/CSRF', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, {
    method: 'POST',
    headers: {
      Cookie: authenticatedCookie(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'ORIGIN_DENIED');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('mutasi admin FAQ menolak exact origin tanpa double-submit CSRF', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: authenticatedCookie(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({})
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'CSRF_INVALID');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('POST membuat FAQ draft melalui session, exact origin, dan CSRF', async () => {
  resetFaq();
  const response = await fetch(`${baseUrl}/api/admin/faqs`, await mutationOptions('POST', {
    faq_key: 'beasiswa',
    question: 'Bagaimana cara mengajukan beasiswa?',
    answer: 'Pengajuan tersedia melalui bagian kemahasiswaan.',
    category: 'kemahasiswaan',
    source: 'panduan beasiswa',
    metadata: {}
  }));
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 201);
  assert.equal(payload.data.status, 'draft');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(serialized.includes('embedding'), false);
  assert.equal(serialized.includes('content'), false);
});

test('PUT menolak faq_key immutable dengan validation details', async () => {
  resetFaq();
  const response = await fetch(`${baseUrl}/api/admin/faqs/${faqId}`, await mutationOptions('PUT', {
    faq_key: 'key-baru',
    question: currentFaq.question,
    answer: currentFaq.answer,
    category: currentFaq.category,
    source: currentFaq.source,
    metadata: currentFaq.metadata,
    expected_version: currentFaq.version
  }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
  assert.ok(payload.error.details.some((detail) => detail.message.includes('faq_key')));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('stale version dipetakan ke 409 tanpa overwrite', async () => {
  resetFaq();
  const response = await fetch(`${baseUrl}/api/admin/faqs/${faqId}`, await mutationOptions('PUT', {
    question: 'Bagaimana melihat jadwal terbaru?',
    answer: currentFaq.answer,
    category: currentFaq.category,
    source: currentFaq.source,
    metadata: currentFaq.metadata,
    expected_version: 99
  }));
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, 'FAQ_VERSION_CONFLICT');
  assert.equal(currentFaq.question, 'Di mana saya melihat jadwal kuliah?');
});

test('PATCH status mengarsipkan tanpa endpoint DELETE', async () => {
  resetFaq();
  const response = await fetch(
    `${baseUrl}/api/admin/faqs/${faqId}/status`,
    await mutationOptions('PATCH', {
      status: 'archived',
      expected_version: currentFaq.version
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.status, 'archived');

  const deleteResponse = await fetch(`${baseUrl}/api/admin/faqs/${faqId}`, {
    method: 'DELETE',
    headers: { Cookie: authenticatedCookie() }
  });
  assert.equal(deleteResponse.status, 404);
});

test('provider error menggunakan code aman tanpa raw detail', async () => {
  const response = await fetch(`${baseUrl}/api/admin/faqs`, await mutationOptions('POST', {
    faq_key: 'provider-error',
    question: 'Mengapa provider gagal sekarang?',
    answer: 'Simulasi provider gagal untuk pengujian.',
    category: 'pengujian',
    source: 'test',
    metadata: {}
  }));
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, 'AI_PROVIDER_ERROR');
  assert.equal(serialized.includes('sentinel'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
