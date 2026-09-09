import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../supabase/migrations/005_faq_documents_version_invariant.sql',
  import.meta.url
);

const expectedExecutableSql = `
create or replace function public.enforce_faq_documents_version_invariant()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.version := old.version + 1;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$function$;

drop trigger if exists faq_documents_version_invariant on public.faq_documents;

create trigger faq_documents_version_invariant
before update on public.faq_documents
for each row
execute function public.enforce_faq_documents_version_invariant();
`;

function normalizeExecutableSql(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function validateVersionInvariantMigration(sql) {
  assert.doesNotMatch(sql, /\/\*|\*\//, 'block comments could hide executable SQL');
  assert.equal(
    normalizeExecutableSql(sql),
    normalizeExecutableSql(expectedExecutableSql),
    'migration must contain only the exact version-invariant function and trigger'
  );
  assert.doesNotMatch(sql, /\bsecurity\s+definer\b/i);
  assert.match(sql, /\bset\s+search_path\s*=\s*pg_catalog\b/i);
}

function applyBeforeUpdateInvariant(oldRow, proposedRow, databaseTime) {
  return {
    ...oldRow,
    ...proposedRow,
    version: oldRow.version + 1,
    updated_at: databaseTime
  };
}

function createFaqTableSimulation(initialRow, databaseTimes) {
  let row = { ...initialRow };
  let clockIndex = 0;

  function update(proposedRow, expectedVersion) {
    if (expectedVersion !== undefined && row.version !== expectedVersion) {
      return null;
    }

    const databaseTime = databaseTimes[clockIndex];
    clockIndex += 1;
    assert.ok(databaseTime, 'simulation needs one database timestamp per update');
    row = applyBeforeUpdateInvariant(row, proposedRow, databaseTime);
    return { ...row };
  }

  return {
    get row() {
      return { ...row };
    },
    legacyUpdate(proposedRow) {
      return update(proposedRow);
    },
    legacyUpsert(proposedRow) {
      assert.equal(proposedRow.faq_key, row.faq_key, 'fixture models an ON CONFLICT update');
      return update(proposedRow);
    },
    legacyArchive(clientTimestamp) {
      return update({ status: 'archived', updated_at: clientTimestamp });
    },
    adminConditionalUpdate(expectedVersion, proposedRow) {
      return update(proposedRow, expectedVersion);
    }
  };
}

test('migration 005 memasang exact BEFORE UPDATE row trigger dengan safe search_path', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateVersionInvariantMigration(sql);

  const executable = normalizeExecutableSql(sql);
  assert.match(
    executable,
    /create or replace function public\.enforce_faq_documents_version_invariant\(\)/
  );
  assert.match(executable, /new\.version := old\.version \+ 1/);
  assert.match(executable, /new\.updated_at := pg_catalog\.clock_timestamp\(\)/);
  assert.match(
    executable,
    /create trigger faq_documents_version_invariant before update on public\.faq_documents for each row/
  );
});

test('legacy update, conflict-upsert, dan archive tetap kompatibel dan selalu +1', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateVersionInvariantMigration(sql);

  const table = createFaqTableSimulation(
    {
      id: 'faq-1',
      faq_key: 'registrasi',
      question: 'Pertanyaan awal',
      status: 'published',
      version: 7,
      updated_at: '2026-01-01T00:00:00.000Z'
    },
    [
      '2026-08-29T01:00:00.001Z',
      '2026-08-29T01:00:00.002Z',
      '2026-08-29T01:00:00.003Z'
    ]
  );

  const legacyUpdate = table.legacyUpdate({ question: 'Pertanyaan diperbarui' });
  assert.equal(legacyUpdate.version, 8);
  assert.equal(legacyUpdate.question, 'Pertanyaan diperbarui');

  const legacyUpsert = table.legacyUpsert({
    faq_key: 'registrasi',
    question: 'Pertanyaan hasil ingest',
    version: 1,
    updated_at: '1999-01-01T00:00:00.000Z'
  });
  assert.equal(legacyUpsert.version, 9);
  assert.equal(legacyUpsert.updated_at, '2026-08-29T01:00:00.002Z');

  const archived = table.legacyArchive('1998-01-01T00:00:00.000Z');
  assert.equal(archived.version, 10);
  assert.equal(archived.status, 'archived');
  assert.equal(archived.updated_at, '2026-08-29T01:00:00.003Z');
});

test('client-supplied version dan timestamp diabaikan tanpa lompatan version', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateVersionInvariantMigration(sql);

  const oldRow = {
    faq_key: 'biaya',
    version: 41,
    updated_at: '2026-01-01T00:00:00.000Z'
  };
  const updated = applyBeforeUpdateInvariant(
    oldRow,
    {
      version: 2_000_000_000,
      updated_at: '1900-01-01T00:00:00.000Z'
    },
    '2026-08-29T02:00:00.000Z'
  );

  assert.equal(updated.version, 42);
  assert.equal(updated.updated_at, '2026-08-29T02:00:00.000Z');
});

test('admin conditional update kalah setelah legacy writer memenangkan race', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateVersionInvariantMigration(sql);

  const table = createFaqTableSimulation(
    {
      id: 'faq-2',
      faq_key: 'jadwal',
      question: 'Versi awal',
      version: 3,
      updated_at: '2026-01-01T00:00:00.000Z'
    },
    [
      '2026-08-29T03:00:00.001Z',
      '2026-08-29T03:00:00.002Z'
    ]
  );
  const adminExpectedVersion = table.row.version;

  const legacyWinner = table.legacyUpdate({ question: 'Perubahan legacy' });
  assert.equal(legacyWinner.version, 4);

  const staleAdminWrite = table.adminConditionalUpdate(adminExpectedVersion, {
    question: 'Perubahan admin stale',
    version: adminExpectedVersion + 1
  });
  assert.equal(staleAdminWrite, null);
  assert.equal(table.row.question, 'Perubahan legacy');
  assert.equal(table.row.version, 4);

  const retry = table.adminConditionalUpdate(table.row.version, {
    question: 'Perubahan admin setelah refresh',
    version: 999
  });
  assert.equal(retry.version, 5);
  assert.equal(retry.question, 'Perubahan admin setelah refresh');
});

test('validator menolak mutation invariant, object scope, privilege, dan compatibility', async (t) => {
  const sql = await readFile(migrationUrl, 'utf8');
  validateVersionInvariantMigration(sql);

  const mutations = [
    ['version dapat dipercaya dari client', (value) => value.replace(
      'new.version := old.version + 1',
      'new.version := new.version'
    )],
    ['version melompat dua', (value) => value.replace('old.version + 1', 'old.version + 2')],
    ['timestamp client dipertahankan', (value) => value.replace(
      'new.updated_at := pg_catalog.clock_timestamp()',
      'new.updated_at := new.updated_at'
    )],
    ['trigger berjalan AFTER UPDATE', (value) => value.replace('before update', 'after update')],
    ['trigger statement-level', (value) => value.replace('for each row', 'for each statement')],
    ['schema tabel berubah', (value) => value.replaceAll('public.faq_documents', 'private.faq_documents')],
    ['fungsi tidak schema-qualified', (value) => value.replaceAll(
      'public.enforce_faq_documents_version_invariant',
      'enforce_faq_documents_version_invariant'
    )],
    ['search_path memasukkan public', (value) => value.replace(
      'set search_path = pg_catalog',
      'set search_path = public, pg_catalog'
    )],
    ['SECURITY DEFINER ditambahkan', (value) => value.replace(
      'language plpgsql',
      'language plpgsql\nsecurity definer'
    )],
    ['idempotent trigger replacement dihapus', (value) => value.replace(
      'drop trigger if exists faq_documents_version_invariant on public.faq_documents;',
      ''
    )],
    ['ACL diubah', (value) => `${value}\ngrant delete on table public.faq_documents to service_role;`],
    ['data diubah', (value) => `${value}\nupdate public.faq_documents set version = version + 1;`],
    ['RLS diubah', (value) => `${value}\nalter table public.faq_documents disable row level security;`],
    ['index dibuat', (value) => `${value}\ncreate index surprise_idx on public.faq_documents(version);`],
    ['object lain disentuh', (value) => `${value}\ndrop trigger if exists surprise on public.admin_users;`]
  ];

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const mutated = mutate(sql);
      assert.notEqual(mutated, sql, `${name}: mutation fixture must change SQL`);
      assert.throws(() => validateVersionInvariantMigration(mutated));
    });
  }
});
