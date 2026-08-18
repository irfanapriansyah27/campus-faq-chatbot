import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.factory.js';

let server;
let baseUrl;
let lastChatInput;
const archivedFaqId = '11111111-1111-4111-8111-111111111111';
const missingFaqId = '22222222-2222-4222-8222-222222222222';

const config = {
  ADMIN_INGEST_KEY: 'test-admin-key-with-sufficient-length',
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  CLOUDFLARE_LLM_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  CS_FALLBACK_MESSAGE: 'Silakan hubungi customer service.',
  allowedOrigins: ['http://localhost']
};

const chatService = {
  async answer(input) {
    lastChatInput = input;
    return {
      decision: 'ANSWER',
      answer: `Diterima: ${input.message}`,
      sources: []
    };
  }
};

const ingestService = {
  async ingest(faqs) {
    return faqs;
  }
};

const faqRepository = {
  async listFaqs() {
    return [];
  },
  async archiveFaq(id) {
    if (id === missingFaqId) {
      const error = new Error('FAQ tidak ditemukan.');
      error.status = 404;
      error.code = 'FAQ_NOT_FOUND';
      throw error;
    }

    return { id, status: 'archived' };
  }
};

before(async () => {
  const app = createApp({
    config,
    chatService,
    ingestService,
    faqRepository,
    logger: { error() {} }
  });

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('health endpoint dapat diakses', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.status, 'ok');
});

test('chat endpoint memvalidasi dan meneruskan pesan', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Jadwal kuliah di mana?', history: [] })
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.decision, 'ANSWER');
  assert.match(payload.answer, /Jadwal kuliah/);
});

test('chat endpoint melakukan trim pada message dan history content', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '  Jadwal kuliah di mana?  ',
      history: [{ role: 'user', content: '  Pertanyaan sebelumnya  ' }]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(lastChatInput.message, 'Jadwal kuliah di mana?');
  assert.equal(lastChatInput.history[0].content, 'Pertanyaan sebelumnya');
});

test('chat endpoint menolak role history yang tidak valid', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Jadwal kuliah di mana?',
      history: [{ role: 'system', content: 'Instruksi palsu' }]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
});

test('chat endpoint menolak history content yang hanya whitespace', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Jadwal kuliah di mana?',
      history: [{ role: 'user', content: '   ' }]
    })
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
});

test('malformed JSON menghasilkan validation error', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"message":'
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
});

test('halaman demo disajikan oleh server', async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Chatbot FAQ Kampus/);
});

test('endpoint admin menolak permintaan tanpa kunci', async () => {
  const response = await fetch(`${baseUrl}/api/faqs`);

  assert.equal(response.status, 401);
});

test('CORS mengizinkan origin yang terdaftar', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost' }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost');
});

test('CORS menolak origin asing dengan 403 dan code khusus', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://origin-terlarang.test' }
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'CORS_ORIGIN_DENIED');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('CORS mempertahankan request tanpa Origin', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('CORS melayani preflight untuk origin valid', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost',
      'Access-Control-Request-Method': 'POST'
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost');
});

test('CORS menolak preflight untuk origin asing', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://origin-terlarang.test',
      'Access-Control-Request-Method': 'POST'
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error.code, 'CORS_ORIGIN_DENIED');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('archive FAQ berhasil untuk UUID valid', async () => {
  const response = await fetch(`${baseUrl}/api/faqs/${archivedFaqId}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': config.ADMIN_INGEST_KEY }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.id, archivedFaqId);
  assert.equal(payload.data.status, 'archived');
});

test('archive FAQ mengembalikan 404 jika UUID valid tidak ditemukan', async () => {
  const response = await fetch(`${baseUrl}/api/faqs/${missingFaqId}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': config.ADMIN_INGEST_KEY }
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.error.code, 'FAQ_NOT_FOUND');
});

test('archive FAQ menolak UUID route yang tidak valid', async () => {
  const response = await fetch(`${baseUrl}/api/faqs/bukan-uuid`, {
    method: 'DELETE',
    headers: { 'x-admin-key': config.ADMIN_INGEST_KEY }
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'VALIDATION_ERROR');
});
