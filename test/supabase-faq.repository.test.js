import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseFaqRepository } from '../src/repositories/supabase-faq.repository.js';

const faqId = '11111111-1111-4111-8111-111111111111';

function createSupabase(result) {
  const calls = { terminalMethods: [] };
  const query = {
    update(payload) {
      calls.update = payload;
      return this;
    },
    eq(column, value) {
      calls.eq = { column, value };
      return this;
    },
    select(columns) {
      calls.select = columns;
      return this;
    },
    single() {
      calls.terminalMethods.push('single');
      return Promise.resolve(result);
    },
    maybeSingle() {
      calls.terminalMethods.push('maybeSingle');
      return Promise.resolve(result);
    }
  };
  const supabase = {
    from(table) {
      calls.table = table;
      return query;
    }
  };

  return { supabase, calls };
}

test('archiveFaq mengubah status FAQ menjadi archived', async () => {
  const expected = {
    id: faqId,
    faq_key: 'jadwal-kuliah',
    status: 'archived',
    updated_at: '2026-08-18T00:00:00.000Z'
  };
  const { supabase, calls } = createSupabase({ data: expected, error: null });
  const repository = new SupabaseFaqRepository(supabase);

  const result = await repository.archiveFaq(faqId);

  assert.deepEqual(result, expected);
  assert.equal(calls.table, 'faq_documents');
  assert.deepEqual(calls.eq, { column: 'id', value: faqId });
  assert.equal(calls.update.status, 'archived');
  assert.deepEqual(calls.terminalMethods, ['maybeSingle']);
  assert.equal(calls.terminalMethods.includes('single'), false);
});

test('archiveFaq memperbarui updated_at pada operasi yang sama', async () => {
  const { supabase, calls } = createSupabase({
    data: { id: faqId, status: 'archived' },
    error: null
  });
  const repository = new SupabaseFaqRepository(supabase);

  await repository.archiveFaq(faqId);

  assert.match(calls.update.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('archiveFaq menghasilkan 404 jika FAQ tidak ditemukan', async () => {
  const { supabase } = createSupabase({ data: null, error: null });
  const repository = new SupabaseFaqRepository(supabase);

  await assert.rejects(
    repository.archiveFaq(faqId),
    (error) => error.status === 404 && error.code === 'FAQ_NOT_FOUND'
  );
});

test('archiveFaq mempertahankan 503 untuk error Supabase', async () => {
  const { supabase } = createSupabase({
    data: null,
    error: { message: 'connection unavailable' }
  });
  const repository = new SupabaseFaqRepository(supabase);

  await assert.rejects(
    repository.archiveFaq(faqId),
    (error) => error.status === 503 && error.code === 'FAQ_REPOSITORY_ERROR'
  );
});
