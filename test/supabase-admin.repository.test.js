import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseAdminRepository } from '../src/repositories/supabase-admin.repository.js';

const userId = '11111111-1111-4111-8111-111111111111';

function createSupabase(result) {
  const calls = {};
  const query = {
    select(columns) {
      calls.select = columns;
      return this;
    },
    eq(column, value) {
      calls.eq = { column, value };
      return this;
    },
    maybeSingle() {
      calls.maybeSingle = true;
      return Promise.resolve(result);
    }
  };

  return {
    calls,
    supabase: {
      from(table) {
        calls.table = table;
        return query;
      }
    }
  };
}

test('findAdminByUserId mengambil membership minimal berdasarkan user terverifikasi', async () => {
  const membership = { user_id: userId, role: 'admin', is_active: true };
  const { supabase, calls } = createSupabase({ data: membership, error: null });
  const repository = new SupabaseAdminRepository(supabase);

  const result = await repository.findAdminByUserId(userId);

  assert.deepEqual(result, membership);
  assert.equal(calls.table, 'admin_users');
  assert.equal(calls.select, 'user_id, role, is_active');
  assert.deepEqual(calls.eq, { column: 'user_id', value: userId });
  assert.equal(calls.maybeSingle, true);
});

test('findAdminByUserId mengembalikan null ketika membership tidak ada', async () => {
  const { supabase } = createSupabase({ data: null, error: null });
  const repository = new SupabaseAdminRepository(supabase);

  assert.equal(await repository.findAdminByUserId(userId), null);
});

test('findAdminByUserId membungkus kegagalan Supabase tanpa membocorkan detail ke caller', async () => {
  const providerSentinel = 'supabase-repository-provider-sentinel';
  const { supabase } = createSupabase({
    data: null,
    error: { message: providerSentinel }
  });
  const repository = new SupabaseAdminRepository(supabase);

  await assert.rejects(
    repository.findAdminByUserId(userId),
    (error) => error.status === 503
      && error.code === 'ADMIN_REPOSITORY_ERROR'
      && !error.message.includes(providerSentinel)
      && error.cause === undefined
  );
});
