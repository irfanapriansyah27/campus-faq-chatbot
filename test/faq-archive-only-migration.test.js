import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/004_faq_documents_archive_only_privileges.sql',
  import.meta.url
);

const allTablePrivileges = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger'
];
const desiredServiceRolePrivileges = ['select', 'insert', 'update'];
const expectedStatements = [
  'revoke all on table public.faq_documents from public, anon, authenticated, service_role',
  'grant select, insert, update on table public.faq_documents to service_role'
];

function executableStatements(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

function validateArchiveOnlyMigration(sql) {
  assert.doesNotMatch(sql, /\/\*|\*\//);
  assert.deepEqual(executableStatements(sql), expectedStatements);
}

function managedAclFixture() {
  return new Map([
    ['public', new Set(allTablePrivileges)],
    ['anon', new Set(allTablePrivileges)],
    ['authenticated', new Set(allTablePrivileges)],
    ['service_role', new Set(allTablePrivileges)]
  ]);
}

function applyTablePrivileges(sql, initialAcl) {
  const acl = new Map(
    [...initialAcl].map(([role, privileges]) => [role, new Set(privileges)])
  );

  for (const statement of executableStatements(sql)) {
    const revoke = statement.match(
      /^revoke all on table public\.faq_documents from (.+)$/
    );
    if (revoke) {
      for (const role of revoke[1].split(',').map((value) => value.trim())) {
        acl.set(role, new Set());
      }
      continue;
    }

    const grant = statement.match(
      /^grant (.+) on table public\.faq_documents to ([a-z_]+)$/
    );
    if (grant) {
      const privileges = acl.get(grant[2]) ?? new Set();
      for (const privilege of grant[1].split(',').map((value) => value.trim())) {
        privileges.add(privilege);
      }
      acl.set(grant[2], privileges);
    }
  }

  return acl;
}

function sortedPrivileges(acl, role) {
  return [...(acl.get(role) ?? new Set())].sort();
}

test('migration 004 menetapkan exact archive-only table ACL', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateArchiveOnlyMigration(sql);

  const acl = applyTablePrivileges(sql, managedAclFixture());
  assert.deepEqual(sortedPrivileges(acl, 'public'), []);
  assert.deepEqual(sortedPrivileges(acl, 'anon'), []);
  assert.deepEqual(sortedPrivileges(acl, 'authenticated'), []);
  assert.deepEqual(
    sortedPrivileges(acl, 'service_role'),
    [...desiredServiceRolePrivileges].sort()
  );
  for (const denied of ['delete', 'truncate', 'references', 'trigger']) {
    assert.equal(acl.get('service_role').has(denied), false);
  }
});

test('migration 004 hanya menyentuh ACL tabel FAQ melalui reset lalu allowlist', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateArchiveOnlyMigration(sql);

  assert.doesNotMatch(sql, /alter default privileges|all tables|schema public/i);
  assert.doesNotMatch(
    sql,
    /\b(alter table|create (table|index|function)|drop |truncate table|insert into|update public\.|delete from)\b/i
  );
  assert.doesNotMatch(sql, /admin_users|match_faq|embedding|status|policy|row level security/i);
});

test('validator migration 004 menolak mutation privilege dan object scope', async (t) => {
  const sql = await readFile(migrationUrl, 'utf8');
  const revoke = `revoke all on table public.faq_documents
from public, anon, authenticated, service_role;`;
  const grant = `grant select, insert, update
on table public.faq_documents
to service_role;`;
  const mutations = [
    ['DELETE diberikan', (value) => value.replace('select, insert, update', 'select, insert, update, delete')],
    ['GRANT ALL digunakan', (value) => value.replace('select, insert, update', 'all')],
    ['revoke dihapus', (value) => value.replace(revoke, '')],
    ['service_role tidak di-reset', (value) => value.replace(
      'public, anon, authenticated, service_role',
      'public, anon, authenticated'
    )],
    ['grant mendahului revoke', (value) => value.replace(`${revoke}\n\n${grant}`, `${grant}\n\n${revoke}`)],
    ['anon memperoleh privilege', (value) => `${value}\ngrant select on table public.faq_documents to anon;`],
    ['PUBLIC memperoleh privilege sebelum allowlist', (value) => (
      `${revoke}\ngrant select on table public.faq_documents to public;\n${grant}`
    )],
    ['object lain disentuh', (value) => `${value}\nrevoke all on table public.admin_users from service_role;`],
    ['broad table grant', (value) => `${value}\ngrant select on all tables in schema public to service_role;`],
    ['default privilege berubah', (value) => `${value}\nalter default privileges revoke all on tables from public;`],
    ['privilege tambahan sebelum reset', (value) => `grant delete on table public.faq_documents to service_role;\n${value}`],
    ['privilege tambahan setelah allowlist', (value) => `${value}\ngrant trigger on table public.faq_documents to service_role;`]
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const mutated = mutate(sql);
      assert.notEqual(mutated, sql);
      assert.throws(() => validateArchiveOnlyMigration(mutated));
    });
  }
});
