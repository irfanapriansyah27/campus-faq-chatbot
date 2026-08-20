import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../', import.meta.url);
const expectedAdminRewrites = [
  { source: '/admin', destination: '/admin/index.html' },
  { source: '/admin/', destination: '/admin/index.html' }
];

function validateAdminRewrites(config) {
  assert.deepEqual(config.rewrites, expectedAdminRewrites);
  assert.equal(
    config.rewrites.some((rewrite) => rewrite.source.startsWith('/api/admin')),
    false
  );
}

test('vercel rewrite memakai exact allowlist untuk /admin dan /admin/', async () => {
  const raw = await readFile(new URL('vercel.json', repositoryRoot), 'utf8');
  const config = JSON.parse(raw);
  validateAdminRewrites(config);
});

test('validator rewrite menolak wildcard, catch-all, dan perubahan urutan', async (t) => {
  const raw = await readFile(new URL('vercel.json', repositoryRoot), 'utf8');
  const config = JSON.parse(raw);
  const mutations = [
    ['wildcard asset admin', { source: '/admin/:path*', destination: '/admin/index.html' }],
    ['wildcard API admin', { source: '/api/admin/:path*', destination: '/admin/index.html' }],
    ['global catch-all', { source: '/:path*', destination: '/admin/index.html' }],
    ['regex catch-all', { source: '/(.*)', destination: '/admin/index.html' }]
  ];

  for (const [name, rewrite] of mutations) {
    await t.test(name, () => {
      assert.throws(() => validateAdminRewrites({
        ...config,
        rewrites: [rewrite, ...config.rewrites]
      }));
    });
  }

  await t.test('exact route dengan urutan terbalik', () => {
    assert.throws(() => validateAdminRewrites({
      ...config,
      rewrites: [...config.rewrites].reverse()
    }));
  });
});

test('asset admin tersedia sebagai file statis dan tidak bergantung pada rewrite API', async () => {
  await Promise.all([
    readFile(new URL('public/admin/index.html', repositoryRoot), 'utf8'),
    readFile(new URL('public/admin/admin.css', repositoryRoot), 'utf8'),
    readFile(new URL('public/admin/admin.js', repositoryRoot), 'utf8'),
    readFile(new URL('public/admin/security-cookie.js', repositoryRoot), 'utf8')
  ]);
});

test('frontend admin tidak memuat fitur di luar Fase 1 atau nama secret backend', async () => {
  const html = await readFile(new URL('public/admin/index.html', repositoryRoot), 'utf8');
  const script = await readFile(new URL('public/admin/admin.js', repositoryRoot), 'utf8');
  const cookieScript = await readFile(
    new URL('public/admin/security-cookie.js', repositoryRoot),
    'utf8'
  );
  const combined = `${html}\n${script}\n${cookieScript}`;

  assert.doesNotMatch(combined, /SUPABASE_SERVICE_ROLE_KEY|ADMIN_INGEST_KEY|GEMINI_API_KEY|CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(combined, /retrieval tester|import FAQ|statistik/i);
  assert.doesNotMatch(combined, /access_token|refresh_token/);
  assert.doesNotMatch(combined, /\.innerHTML\b/);
});
