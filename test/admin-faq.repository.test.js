import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  escapeLikePattern,
  SupabaseFaqRepository
} from '../src/repositories/supabase-faq.repository.js';

const faqId = '11111111-1111-4111-8111-111111111111';

function createSupabase(results) {
  const calls = [];
  const queue = [...results];
  const supabase = {
    from(table) {
      const call = { table, orders: [], equals: [] };
      const result = queue.shift() ?? { data: null, error: null };
      calls.push(call);
      return {
        select(columns, options) {
          call.select = { columns, options };
          return this;
        },
        ilike(column, pattern) {
          call.ilike = { column, pattern };
          return this;
        },
        eq(column, value) {
          call.equals.push({ column, value });
          return this;
        },
        order(column, options) {
          call.orders.push({ column, options });
          return this;
        },
        range(from, to) {
          call.range = { from, to };
          return this;
        },
        insert(payload) {
          call.insert = payload;
          return this;
        },
        upsert(payload) {
          call.upsert = payload;
          return this;
        },
        update(payload) {
          call.update = payload;
          return this;
        },
        single() {
          call.terminal = 'single';
          return Promise.resolve(result);
        },
        maybeSingle() {
          call.terminal = 'maybeSingle';
          return Promise.resolve(result);
        },
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        }
      };
    }
  };

  return { supabase, calls };
}

function createRealSupabaseHarness() {
  const requests = [];
  const fakeFetch = async (input, options) => {
    requests.push({ url: String(input), options });
    return new Response('[]', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-range': '*/0'
      }
    });
  };
  const supabase = createClient(
    'https://faq-search-test.supabase.co',
    'public-test-key',
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      },
      global: { fetch: fakeFetch }
    }
  );

  return { repository: new SupabaseFaqRepository(supabase), requests };
}

const listQuery = Object.freeze({
  q: '',
  status: 'all',
  page: 1,
  page_size: 20,
  sort_by: 'updated_at',
  sort_order: 'desc'
});

test('escapeLikePattern meloloskan literal wildcard dan backslash', () => {
  assert.equal(escapeLikePattern('50%_\\faq'), '50\\%\\_\\\\faq');
});

test('list admin memakai exact count, pagination, filter, escaped search, dan deterministic sort', async () => {
  const row = { id: faqId, faq_key: 'jadwal', question: 'Jadwal?', answer: 'Di SIA.' };
  const { supabase, calls } = createSupabase([{
    data: [row],
    count: 41,
    error: null
  }]);
  const repository = new SupabaseFaqRepository(supabase);

  const result = await repository.listAdminFaqs({
    q: '50%_\\faq',
    status: 'published',
    page: 2,
    page_size: 20,
    sort_by: 'question',
    sort_order: 'asc'
  });

  assert.deepEqual(result, { data: [row], total: 41 });
  assert.equal(calls[0].select.options.count, 'exact');
  assert.equal(calls[0].select.columns.includes('embedding'), false);
  assert.deepEqual(calls[0].ilike, {
    column: 'content',
    pattern: '%50\\%\\_\\\\faq%'
  });
  assert.deepEqual(calls[0].equals, [{ column: 'status', value: 'published' }]);
  assert.deepEqual(calls[0].orders, [
    { column: 'question', options: { ascending: true } },
    { column: 'id', options: { ascending: true } }
  ]);
  assert.deepEqual(calls[0].range, { from: 20, to: 39 });
});

test('serialized PostgREST search memakai literal escaping melalui Supabase client nyata', async () => {
  for (const input of [
    '%',
    '_',
    '\\',
    ',',
    '(',
    ')',
    "'",
    'Jadwal akademik',
    'jadwal—日本語🎓'
  ]) {
    const { repository, requests } = createRealSupabaseHarness();

    await repository.listAdminFaqs({ ...listQuery, q: input });

    assert.equal(requests.length, 1);
    const requestUrl = new URL(requests[0].url);
    assert.equal(requestUrl.pathname, '/rest/v1/faq_documents');
    assert.deepEqual(requestUrl.searchParams.getAll('content'), [
      `ilike.%${escapeLikePattern(input)}%`
    ]);
  }
});

test('literal star ditolak sebelum query karena PostgREST menganggapnya wildcard', async () => {
  for (const q of ['*', 'jadwal*', '*jadwal', 'jad*wal']) {
    const { repository, requests } = createRealSupabaseHarness();

    await assert.rejects(
      repository.listAdminFaqs({ ...listQuery, q }),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
    assert.equal(requests.length, 0);
  }
});

test('list admin menolak range pagination yang overflow sebelum query', async () => {
  const { supabase, calls } = createSupabase([]);
  const repository = new SupabaseFaqRepository(supabase);

  await assert.rejects(
    repository.listAdminFaqs({
      ...listQuery,
      page: Number.MAX_SAFE_INTEGER,
      page_size: 100
    }),
    (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
  );
  assert.equal(calls.length, 0);
});

test('list admin menolak sort column di luar allowlist sebelum query', async () => {
  const { supabase, calls } = createSupabase([]);
  const repository = new SupabaseFaqRepository(supabase);

  await assert.rejects(
    repository.listAdminFaqs({
      q: '', status: 'all', page: 1, page_size: 20,
      sort_by: 'embedding', sort_order: 'desc'
    }),
    (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
  );
  assert.equal(calls.length, 0);
});

test('insert admin memakai insert, bukan upsert, dan tidak mengembalikan vector', async () => {
  const saved = { id: faqId, faq_key: 'jadwal', status: 'draft', version: 1 };
  const { supabase, calls } = createSupabase([{ data: saved, error: null }]);
  const repository = new SupabaseFaqRepository(supabase);
  const record = {
    faq_key: 'jadwal',
    question: 'Di mana jadwal?',
    answer: 'Jadwal ada di SIA.',
    content: 'canonical',
    embedding: [0.1],
    status: 'draft',
    version: 1
  };

  assert.deepEqual(await repository.insertAdminFaq(record), saved);
  assert.deepEqual(calls[0].insert, record);
  assert.equal(calls[0].upsert, undefined);
  assert.equal(calls[0].select.columns.includes('embedding'), false);
});

test('duplicate faq_key dipetakan ke 409 tanpa raw database error', async () => {
  const { supabase } = createSupabase([{
    data: null,
    error: { code: '23505', message: 'faq_key duplicate sentinel' }
  }]);
  const repository = new SupabaseFaqRepository(supabase);

  await assert.rejects(
    repository.insertAdminFaq({ faq_key: 'jadwal' }),
    (error) => error.status === 409
      && error.code === 'FAQ_KEY_CONFLICT'
      && !error.message.includes('sentinel')
  );
});

test('detail UUID yang tidak ditemukan menghasilkan 404', async () => {
  const { supabase, calls } = createSupabase([{ data: null, error: null }]);
  const repository = new SupabaseFaqRepository(supabase);

  await assert.rejects(
    repository.getAdminFaqById(faqId),
    (error) => error.status === 404 && error.code === 'FAQ_NOT_FOUND'
  );
  assert.equal(calls[0].select.columns.includes('content'), true);
  assert.equal(calls[0].select.columns.includes('embedding'), false);
});

test('content update bersifat conditional dan menaikkan version atomically', async () => {
  const saved = { id: faqId, faq_key: 'jadwal', version: 4 };
  const { supabase, calls } = createSupabase([{ data: saved, error: null }]);
  const repository = new SupabaseFaqRepository(supabase);

  const result = await repository.updateAdminFaq({
    id: faqId,
    expectedVersion: 3,
    changes: {
      question: 'Pertanyaan baru?',
      content: 'canonical baru',
      embedding: [0.2]
    }
  });

  assert.deepEqual(result, saved);
  assert.equal(calls[0].update.version, 4);
  assert.match(calls[0].update.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls[0].equals, [
    { column: 'id', value: faqId },
    { column: 'version', value: 3 }
  ]);
  assert.equal(calls[0].select.columns.includes('embedding'), false);
});

test('conditional miss membedakan version conflict dari not found', async () => {
  const conflictHarness = createSupabase([
    { data: null, error: null },
    { data: { id: faqId, version: 7 }, error: null }
  ]);
  const conflictRepository = new SupabaseFaqRepository(conflictHarness.supabase);

  await assert.rejects(
    conflictRepository.updateAdminFaqStatus({
      id: faqId,
      expectedVersion: 3,
      status: 'archived'
    }),
    (error) => error.status === 409 && error.code === 'FAQ_VERSION_CONFLICT'
  );
  assert.equal(conflictHarness.calls[0].update.embedding, undefined);

  const missingHarness = createSupabase([
    { data: null, error: null },
    { data: null, error: null }
  ]);
  const missingRepository = new SupabaseFaqRepository(missingHarness.supabase);

  await assert.rejects(
    missingRepository.updateAdminFaqStatus({
      id: faqId,
      expectedVersion: 3,
      status: 'archived'
    }),
    (error) => error.status === 404 && error.code === 'FAQ_NOT_FOUND'
  );
});
