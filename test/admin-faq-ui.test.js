import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatFaqMetadata } from '../public/admin/faq-metadata.js';
import {
  buildFaqListQuery,
  classifyFaqApiError,
  createFaqListState,
  faqFormMode,
  formatFaqDate,
  parseMetadataInput,
  reduceFaqListState,
  statusLabel,
  truncateText
} from '../public/admin/faq-ui.js';

const repositoryRoot = new URL('../', import.meta.url);

test('helper list membangun query deterministik dan encode input', () => {
  assert.equal(buildFaqListQuery({
    q: 'jadwal & ujian',
    status: 'published',
    page: 2,
    pageSize: 20,
    sortBy: 'question',
    sortOrder: 'asc'
  }), 'q=jadwal+%26+ujian&status=published&page=2&page_size=20&sort_by=question&sort_order=asc');
});

test('helper status, date, dan preview menghasilkan teks aman', () => {
  assert.equal(statusLabel('draft'), 'Draf');
  assert.equal(statusLabel('published'), 'Terbit');
  assert.equal(statusLabel('archived'), 'Diarsipkan');
  assert.equal(statusLabel('unknown'), 'unknown');
  assert.match(formatFaqDate('2026-08-29T10:00:00.000Z'), /2026/);
  assert.equal(truncateText('<b>jawaban</b>', 8), '<b>jawa…');
});

test('metadata parser menerima object JSON dan menolak tipe lain tanpa eval', () => {
  assert.deepEqual(parseMetadataInput(''), { ok: true, value: {} });
  assert.deepEqual(parseMetadataInput('{"audience":"mahasiswa"}'), {
    ok: true,
    value: { audience: 'mahasiswa' }
  });
  assert.equal(parseMetadataInput('[]').ok, false);
  assert.equal(parseMetadataInput('{invalid').ok, false);

  let nested = '"terlalu dalam"';
  for (let depth = 0; depth < 10; depth += 1) nested = `{"level":${nested}}`;
  assert.doesNotThrow(() => parseMetadataInput(nested));
  assert.equal(parseMetadataInput(nested).ok, false);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => formatFaqMetadata(cyclic));
  assert.equal(formatFaqMetadata(cyclic), '{}');
});

test('list state membedakan loading, empty database, zero result, ready, dan error', () => {
  const initial = createFaqListState();
  assert.equal(initial.phase, 'idle');
  assert.equal(reduceFaqListState(initial, { type: 'LOAD' }).phase, 'loading');
  assert.equal(reduceFaqListState(initial, {
    type: 'SUCCESS', data: [], total: 0, filtered: false
  }).phase, 'empty');
  assert.equal(reduceFaqListState(initial, {
    type: 'SUCCESS', data: [], total: 0, filtered: true
  }).phase, 'zero-results');
  assert.equal(reduceFaqListState(initial, {
    type: 'SUCCESS', data: [{ id: '1' }], total: 1, filtered: false
  }).phase, 'ready');
  assert.equal(reduceFaqListState(initial, {
    type: 'ERROR', message: 'Gagal memuat.'
  }).phase, 'error');
});

test('form mode mengunci faq_key pada edit dan error conflict meminta reload', () => {
  assert.deepEqual(faqFormMode(false), {
    keyReadOnly: false,
    showCreateStatus: true
  });
  assert.deepEqual(faqFormMode(true), {
    keyReadOnly: true,
    showCreateStatus: false
  });
  assert.deepEqual(classifyFaqApiError({
    error: { code: 'FAQ_VERSION_CONFLICT', message: 'conflict' }
  }), {
    kind: 'version-conflict',
    message: 'Data FAQ telah berubah. Muat ulang sebelum melanjutkan.'
  });
});

test('admin UI memakai semantic controls tanpa hard delete atau future placeholder', async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL('public/admin/index.html', repositoryRoot), 'utf8'),
    readFile(new URL('public/admin/admin.js', repositoryRoot), 'utf8'),
    readFile(new URL('public/admin/admin.css', repositoryRoot), 'utf8')
  ]);
  const combined = `${html}\n${script}\n${css}`;

  assert.match(html, /<table/);
  assert.match(html, /id="faq-form"/);
  assert.match(html, /id="archive-dialog"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(combined, /method:\s*['"]DELETE['"]|hard delete|Usage & Health|Coming soon/i);
  assert.doesNotMatch(script, /\.innerHTML\b|\beval\s*\(/);
  assert.match(script, /formatFaqMetadata\(faq\.metadata\)/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|backdrop-filter/i);
});
