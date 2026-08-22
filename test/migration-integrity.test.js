import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { TextDecoder } from 'node:util';

const migrationDirectoryUrl = new URL('../supabase/migrations/', import.meta.url);
const expectedMigrations = [
  {
    name: '001_faq_pgvector.sql',
    sha256: 'db108dafe44e3f9a4793c8cf66add017158d4effafa147220aec18bc1b30baab'
  },
  {
    name: '002_admin_auth.sql',
    sha256: 'e584f5369242cf33496e78642ef445502ffb638b0a5abd0486489564962ef90c'
  },
  {
    name: '003_faq_documents_service_role_privileges.sql',
    sha256: 'a88b288650eb8e55579b8cecb03f0d6d40e8894d34db02dbab477e3ccdd90f4d'
  }
];

function canonicalMigrationText(name, bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${name}: UTF-8 BOM is not allowed`);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${name}: content is not valid UTF-8`);
  }

  return text.replace(/\r\n?/g, '\n');
}

function canonicalSha256(name, bytes) {
  return createHash('sha256')
    .update(canonicalMigrationText(name, bytes), 'utf8')
    .digest('hex');
}

function validateMigrationIntegrity(migrations) {
  assert.deepEqual(
    migrations.map(({ name }) => name),
    expectedMigrations.map(({ name }) => name),
    'canonical migration set and order mismatch'
  );

  for (const expected of expectedMigrations) {
    const migration = migrations.find(({ name }) => name === expected.name);
    assert.equal(
      canonicalSha256(migration.name, migration.bytes),
      expected.sha256,
      `${migration.name}: canonical SHA-256 mismatch`
    );
  }
}

async function readCanonicalMigrationSet() {
  const names = (await readdir(migrationDirectoryUrl, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(names.map(async (name) => ({
    name,
    bytes: await readFile(new URL(name, migrationDirectoryUrl))
  })));
}

function mutateContent(migrations, name, mutate) {
  return migrations.map((migration) => {
    if (migration.name !== name) {
      return migration;
    }

    const original = migration.bytes.toString('utf8');
    const mutated = mutate(original);
    assert.notEqual(mutated, original, `${name}: mutation must change content`);
    return { name, bytes: Buffer.from(mutated, 'utf8') };
  });
}

test('canonical migration set 001-003 memiliki exact SHA-256 allowlist', async () => {
  validateMigrationIntegrity(await readCanonicalMigrationSet());
});

test('canonical hash menerima LF, CRLF, dan lone CR sebagai line ending setara', async () => {
  const migrations = await readCanonicalMigrationSet();

  for (const migration of migrations) {
    const normalized = canonicalMigrationText(migration.name, migration.bytes);
    const lf = Buffer.from(normalized, 'utf8');
    const crlf = Buffer.from(normalized.replace(/\n/g, '\r\n'), 'utf8');
    const cr = Buffer.from(normalized.replace(/\n/g, '\r'), 'utf8');
    const expected = expectedMigrations.find(({ name }) => name === migration.name);

    assert.equal(canonicalSha256(migration.name, lf), expected.sha256);
    assert.equal(canonicalSha256(migration.name, crlf), expected.sha256);
    assert.equal(canonicalSha256(migration.name, cr), expected.sha256);
  }
});

test('integrity guard menolak seluruh mutation isi, BOM, set, dan urutan', async (t) => {
  const migrations = await readCanonicalMigrationSet();
  const contentMutations = [
    [
      'appended executable statement',
      '001_faq_pgvector.sql',
      (value) => `${value}alter table public.faq_documents disable row level security;\n`
    ],
    [
      'prepended executable statement',
      '002_admin_auth.sql',
      (value) => `alter table public.faq_documents disable row level security;\n${value}`
    ],
    [
      'grant berubah',
      '003_faq_documents_service_role_privileges.sql',
      (value) => value.replace(
        'grant select, insert, update, delete',
        'grant select, insert, update, delete, truncate'
      )
    ],
    [
      'revoke berubah',
      '003_faq_documents_service_role_privileges.sql',
      (value) => value.replace(
        'from public, anon, authenticated, service_role',
        'from public, anon, authenticated'
      )
    ],
    [
      'RLS berubah',
      '002_admin_auth.sql',
      (value) => value.replace(
        'alter table public.admin_users enable row level security',
        'alter table public.admin_users disable row level security'
      )
    ],
    [
      'satu karakter berubah',
      '001_faq_pgvector.sql',
      (value) => value.replace('faq_documents', 'faq_documentx')
    ],
    [
      'komentar berubah',
      '003_faq_documents_service_role_privileges.sql',
      (value) => value.replace('Reset managed/default ACL', 'ResetX managed/default ACL')
    ],
    [
      'trailing newline berubah',
      '003_faq_documents_service_role_privileges.sql',
      (value) => value.endsWith('\n') ? value.slice(0, -1) : `${value}\n`
    ]
  ];

  for (const [name, migrationName, mutate] of contentMutations) {
    await t.test(name, () => {
      const mutated = mutateContent(migrations, migrationName, mutate);
      assert.throws(
        () => validateMigrationIntegrity(mutated),
        new RegExp(`${migrationName.replaceAll('.', '\\.')}: canonical SHA-256 mismatch`)
      );
    });
  }

  await t.test('UTF-8 BOM', () => {
    const mutated = migrations.map((migration) => migration.name === '001_faq_pgvector.sql'
      ? { ...migration, bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), migration.bytes]) }
      : migration);

    assert.throws(
      () => validateMigrationIntegrity(mutated),
      /001_faq_pgvector\.sql: UTF-8 BOM is not allowed/
    );
  });

  await t.test('urutan file berubah', () => {
    assert.throws(
      () => validateMigrationIntegrity([...migrations].reverse()),
      /canonical migration set and order mismatch/
    );
  });

  await t.test('nama file berubah', () => {
    const mutated = migrations.map((migration) => migration.name === '003_faq_documents_service_role_privileges.sql'
      ? { ...migration, name: '004_faq_documents_service_role_privileges.sql' }
      : migration);

    assert.throws(
      () => validateMigrationIntegrity(mutated),
      /canonical migration set and order mismatch/
    );
  });
});
