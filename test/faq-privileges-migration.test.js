import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration001Url = new URL(
  '../supabase/migrations/001_faq_pgvector.sql',
  import.meta.url
);
const migration003Url = new URL(
  '../supabase/migrations/003_faq_documents_service_role_privileges.sql',
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
const requiredServiceRolePrivileges = ['select', 'insert', 'update', 'delete'];
const expectedPrivilegePolicy = [
  'revoke all on table public.faq_documents from public, anon, authenticated, service_role',
  'grant select, insert, update, delete on table public.faq_documents to service_role'
];

function executableStatements(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

function validateFaqPrivilegeMigration(sql) {
  assert.doesNotMatch(sql, /\/\*|\*\//);
  assert.deepEqual(executableStatements(sql), expectedPrivilegePolicy);
}

function managedAclFixture() {
  return new Map([
    ['public', new Set(allTablePrivileges)],
    ['anon', new Set(allTablePrivileges)],
    ['authenticated', new Set(allTablePrivileges)],
    ['service_role', new Set(allTablePrivileges)]
  ]);
}

function applyFaqTablePrivileges(sql, initialAcl) {
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
      const rolePrivileges = acl.get(grant[2]) ?? new Set();
      for (const privilege of grant[1].split(',').map((value) => value.trim())) {
        rolePrivileges.add(privilege);
      }
      acl.set(grant[2], rolePrivileges);
    }
  }

  return acl;
}

function sortedPrivileges(acl, role) {
  return [...(acl.get(role) ?? new Set())].sort();
}

test('migration 001 tidak menjamin exact privilege di atas managed/default ACL yang luas', async () => {
  const migration001 = await readFile(migration001Url, 'utf8');
  const acl = applyFaqTablePrivileges(migration001, managedAclFixture());

  assert.deepEqual(
    sortedPrivileges(acl, 'service_role'),
    [...allTablePrivileges].sort()
  );
  assert.notDeepEqual(
    sortedPrivileges(acl, 'service_role'),
    [...requiredServiceRolePrivileges].sort()
  );
});

test('migration 003 mereset ACL lalu memberikan exact DML allowlist', async () => {
  const migration003 = await readFile(migration003Url, 'utf8');
  validateFaqPrivilegeMigration(migration003);

  const acl = applyFaqTablePrivileges(migration003, managedAclFixture());
  assert.deepEqual(sortedPrivileges(acl, 'public'), []);
  assert.deepEqual(sortedPrivileges(acl, 'anon'), []);
  assert.deepEqual(sortedPrivileges(acl, 'authenticated'), []);
  assert.deepEqual(
    sortedPrivileges(acl, 'service_role'),
    [...requiredServiceRolePrivileges].sort()
  );
  assert.equal(acl.get('service_role').has('truncate'), false);
  assert.equal(acl.get('service_role').has('references'), false);
  assert.equal(acl.get('service_role').has('trigger'), false);
});

test('validator migration 003 menolak mutasi privilege dan object scope', async (t) => {
  const migration003 = await readFile(migration003Url, 'utf8');
  const revoke = `revoke all on table public.faq_documents
from public, anon, authenticated, service_role;`;
  const grant = `grant select, insert, update, delete
on table public.faq_documents
to service_role;`;
  const resetWithoutServiceRole =
    `revoke all on table public.faq_documents
from public, anon, authenticated;`;

  const mutations = [
    ['GRANT ALL', (value) => value.replace(grant,
      `grant all on table public.faq_documents
to service_role;`)],
    ['tambahan TRUNCATE', (value) => value.replace(
      'select, insert, update, delete',
      'select, insert, update, delete, truncate'
    )],
    ['tambahan REFERENCES', (value) => value.replace(
      'select, insert, update, delete',
      'select, insert, update, delete, references'
    )],
    ['tambahan TRIGGER', (value) => value.replace(
      'select, insert, update, delete',
      'select, insert, update, delete, trigger'
    )],
    ['grant kepada anon', (value) => `${value}\ngrant select on table public.faq_documents to anon;`],
    ['grant kepada authenticated', (value) => (
      `${value}\ngrant select on table public.faq_documents to authenticated;`
    )],
    ['grant kepada PUBLIC', (value) => (
      `${value}\ngrant select on table public.faq_documents to PUBLIC;`
    )],
    ['reset service_role hilang', (value) => value.replace(
      revoke,
      resetWithoutServiceRole
    )],
    ['grant mendahului reset', (value) => value.replace(
      `${revoke}\n\n${grant}`,
      `${grant}\n\n${revoke}`
    )],
    ['broad schema grant', (value) => `${value}\ngrant usage on schema public to anon;`],
    ['broad table grant', (value) => (
      `${value}\ngrant select on all tables in schema public to service_role;`
    )],
    ['object lain diubah', (value) => `${value}\nalter table public.admin_users enable row level security;`]
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const mutatedSql = mutate(migration003);
      assert.notEqual(mutatedSql, migration003, 'Mutation harus benar-benar mengubah SQL.');
      assert.throws(() => validateFaqPrivilegeMigration(mutatedSql));
    });
  }
});
