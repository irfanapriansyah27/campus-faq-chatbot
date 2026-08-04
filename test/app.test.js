import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.factory.js';;

let server;
let baseUrl;

const config = {
  ADMIN_INGEST_KEY: 'test-admin-key-with-sufficient-length',
  GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
  CLOUDFLARE_LLM_MODEL: '@cf/qwen/qwen3-30b-a3b-fp8',
  CS_FALLBACK_MESSAGE: 'Silakan hubungi customer service.',
  allowedOrigins: ['http://localhost']
};

const chatService = {
  async answer({ message }) {
    return {
      decision: 'ANSWER',
      answer: `Diterima: ${message}`,
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
