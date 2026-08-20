import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/002_admin_auth.sql', import.meta.url);
const expectedPrivilegePolicy = [
  'revoke all on table public.admin_users from public, anon, authenticated, service_role',
  'grant select on table public.admin_users to service_role'
];

function executableStatements(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

function validateAdminMigrationPolicy(sql) {
  assert.doesNotMatch(sql, /\/\*|\*\//);

  const executableSql = sql.replace(/--.*$/gm, '');
  const statements = executableStatements(sql);

  assert.match(executableSql, /create table if not exists public\.admin_users/i);
  assert.match(
    executableSql,
    /user_id uuid primary key references auth\.users\(id\) on delete cascade/i
  );
  assert.match(
    executableSql,
    /created_by uuid references auth\.users\(id\) on delete set null/i
  );
  assert.match(executableSql, /check \(role = 'admin'\)/i);
  assert.match(executableSql, /is_active boolean not null default true/i);
  assert.match(executableSql, /created_at timestamptz not null default now\(\)/i);
  assert.match(executableSql, /updated_at timestamptz not null default now\(\)/i);
  assert.equal(
    statements.filter(
      (statement) => statement === 'alter table public.admin_users enable row level security'
    ).length,
    1
  );
  assert.doesNotMatch(executableSql, /\bnullable\b/i);
  assert.doesNotMatch(executableSql, /drop table|truncate|delete from/i);

  const privilegePolicy = statements.filter((statement) => /^(grant|revoke)\b/.test(statement));

  assert.deepEqual(privilegePolicy, expectedPrivilegePolicy);
}

test('migration admin bersifat additive, valid, dan menerapkan exact privilege allowlist', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateAdminMigrationPolicy(sql);
});

test('validator migration menolak seluruh mutasi struktur dan privilege berbahaya', async (t) => {
  const sql = await readFile(migrationUrl, 'utf8');
  const revoke = 'revoke all on table public.admin_users from public, anon, authenticated, service_role;';
  const currentRevoke = 'revoke all on table public.admin_users from public, anon, authenticated;';
  const grant = 'grant select on table public.admin_users to service_role;';

  const mutations = [
    ['token nullable', (value) => value.replace(
      'created_by uuid references auth.users(id)',
      'created_by uuid nullable references auth.users(id)'
    )],
    ['RLS dihapus', (value) => value.replace(
      'alter table public.admin_users enable row level security;',
      ''
    )],
    ['FK user_id rusak', (value) => value.replace(
      'user_id uuid primary key references auth.users(id) on delete cascade',
      'user_id uuid primary key'
    )],
    ['role constraint rusak', (value) => value.replace(" check (role = 'admin')", '')],
    ['anon mendapat SELECT setelah reset', (value) => value.replace(
      revoke,
      `${revoke}\ngrant select on table public.admin_users to anon;`
    )],
    ['authenticated mendapat SELECT setelah grant benar', (value) => (
      `${value}\ngrant select on table public.admin_users to authenticated;`
    )],
    ['PUBLIC mendapat SELECT', (value) => (
      `${value}\ngrant select on table public.admin_users to PUBLIC;`
    )],
    ['service_role mendapat ALL', (value) => (
      `${value}\ngrant all on table public.admin_users to service_role;`
    )],
    ['service_role mendapat INSERT', (value) => (
      `${value}\ngrant insert on table public.admin_users to service_role;`
    )],
    ['service_role mendapat UPDATE', (value) => (
      `${value}\ngrant update on table public.admin_users to service_role;`
    )],
    ['service_role mendapat DELETE', (value) => (
      `${value}\ngrant delete on table public.admin_users to service_role;`
    )],
    ['reset service_role dihapus', (value) => value.replace(
      revoke,
      currentRevoke
    )],
    ['GRANT SELECT mendahului reset privilege', (value) => value.replace(
      `${revoke}\n${grant}`,
      `${grant}\n${revoke}`
    )],
    ['grant schema public yang luas ditambahkan', (value) => (
      `${value}\ngrant select on all tables in schema public to anon;`
    )],
    ['block-comment prefix menyembunyikan grant berbahaya', (value) => (
      `${value}\n/* prefix */\ngrant all on table public.admin_users to service_role;`
    )],
    ['RLS aktual diganti teks dalam block comment', (value) => value.replace(
      'alter table public.admin_users enable row level security;',
      '/* alter table public.admin_users enable row level security; */;'
    )],
    ['quoted identifier menyembunyikan grant berbahaya', (value) => (
      `${value}\ngrant all on table "public"."admin_users" to service_role;`
    )],
    ['target tanpa schema menyembunyikan grant berbahaya', (value) => (
      `${value}\ngrant all on table admin_users to service_role;`
    )]
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const mutatedSql = mutate(sql);
      assert.notEqual(mutatedSql, sql, 'Mutation harus benar-benar mengubah SQL.');
      assert.throws(() => validateAdminMigrationPolicy(mutatedSql));
    });
  }
});
