import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { TextDecoder } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRootUrl = new URL('../', import.meta.url);
const migrationDirectoryUrl = new URL('../supabase/migrations/', import.meta.url);
const gitAttributesUrl = new URL('../.gitattributes', import.meta.url);
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
  },
  {
    name: '004_faq_documents_archive_only_privileges.sql',
    sha256: '91df5159a98b2284f67b28c4095bda104b885b2ea029ca80a6343700a93fc9e4'
  },
  {
    name: '005_faq_documents_version_invariant.sql',
    sha256: '42a378ef4a77942a3c1b06b2424109631ad003f6c19d7581c085578b7052d02b'
  }
];

function validateMigrationBytes(name, bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${name}: UTF-8 BOM is not allowed`);
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${name}: content is not valid UTF-8`);
  }
}

function rawSha256(name, bytes) {
  validateMigrationBytes(name, bytes);
  return createHash('sha256').update(bytes).digest('hex');
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
      rawSha256(migration.name, migration.bytes),
      expected.sha256,
      `${migration.name}: raw SHA-256 mismatch`
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

test('repository memaksa seluruh migration SQL tetap text dengan LF', async () => {
  const attributes = await readFile(gitAttributesUrl, 'utf8');
  assert.equal(attributes, 'supabase/migrations/*.sql text eol=lf\n');

  const paths = expectedMigrations.map(({ name }) => `supabase/migrations/${name}`);
  const { stdout } = await execFileAsync(
    'git',
    ['check-attr', 'text', 'eol', '--', ...paths],
    { cwd: fileURLToPath(repositoryRootUrl), encoding: 'utf8' }
  );
  const attributesByPath = new Map(paths.map((path) => [path, new Map()]));

  for (const line of stdout.trim().split(/\r?\n/)) {
    const match = line.match(/^(.*): (text|eol): (.*)$/);
    assert.ok(match, `unexpected git check-attr output: ${line}`);
    attributesByPath.get(match[1])?.set(match[2], match[3]);
  }

  for (const path of paths) {
    assert.deepEqual(
      Object.fromEntries(attributesByPath.get(path)),
      { text: 'set', eol: 'lf' },
      `${path}: LF attributes mismatch`
    );
  }
});

test('migration canonical 001-005 tidak memuat BOM, CRLF, atau lone CR', async () => {
  for (const migration of await readCanonicalMigrationSet()) {
    validateMigrationBytes(migration.name, migration.bytes);
    assert.equal(
      migration.bytes.includes(0x0d),
      false,
      `${migration.name}: carriage return is not allowed`
    );
  }
});

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

test('migration set 001-005 memiliki exact raw-byte SHA-256 allowlist', async () => {
  validateMigrationIntegrity(await readCanonicalMigrationSet());
});

test('raw-byte guard menolak perubahan line ending LF menjadi CRLF atau lone CR', async () => {
  const migrations = await readCanonicalMigrationSet();

  for (const migration of migrations) {
    const text = migration.bytes.toString('utf8');
    for (const changedText of [
      text.replace(/\n/g, '\r\n'),
      text.replace(/\n/g, '\r')
    ]) {
      assert.notEqual(changedText, text, `${migration.name}: fixture harus mengubah line ending`);
      const mutated = migrations.map((entry) => entry.name === migration.name
        ? { ...entry, bytes: Buffer.from(changedText, 'utf8') }
        : entry);
      assert.throws(
        () => validateMigrationIntegrity(mutated),
        new RegExp(`${migration.name.replaceAll('.', '\\.')}: raw SHA-256 mismatch`)
      );
    }
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
    ],
    [
      'archive-only privilege berubah',
      '004_faq_documents_archive_only_privileges.sql',
      (value) => value.replace(
        'grant select, insert, update',
        'grant select, insert, update, delete'
      )
    ],
    [
      'version invariant berubah',
      '005_faq_documents_version_invariant.sql',
      (value) => value.replace('old.version + 1', 'old.version + 2')
    ]
  ];

  for (const [name, migrationName, mutate] of contentMutations) {
    await t.test(name, () => {
      const mutated = mutateContent(migrations, migrationName, mutate);
      assert.throws(
        () => validateMigrationIntegrity(mutated),
        new RegExp(`${migrationName.replaceAll('.', '\\.')}: raw SHA-256 mismatch`)
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
    const mutated = migrations.map((migration) => migration.name === '005_faq_documents_version_invariant.sql'
      ? { ...migration, name: '006_faq_documents_version_invariant.sql' }
      : migration);

    assert.throws(
      () => validateMigrationIntegrity(mutated),
      /canonical migration set and order mismatch/
    );
  });
});
