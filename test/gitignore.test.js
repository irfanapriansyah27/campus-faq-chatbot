import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function isIgnoredByGit(path) {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', '--', path],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true
    }
  );

  assert.ifError(result.error);
  assert.equal(result.signal, null, `git check-ignore dihentikan oleh signal ${result.signal}`);
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore gagal dengan exit code ${result.status}: ${result.stderr}`
  );

  return result.status === 0;
}

test('gitignore mengabaikan environment lokal dan production, tetapi tidak template aman', () => {
  assert.equal(isIgnoredByGit('.env.local'), true);
  assert.equal(isIgnoredByGit('.env.production'), true);
  assert.equal(isIgnoredByGit('.env.example'), false);
});
