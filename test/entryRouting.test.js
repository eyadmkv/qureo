import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entryPath = fileURLToPath(new URL('../src/entry.js', import.meta.url));

test('routes the Python solve shortcut through the CLI entry point', () => {
  const result = spawnSync(process.execPath, [entryPath, 'python', 'solve', '--help'], {
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NO_COLOR: '1' }
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: qureo python solve/);
  assert.match(result.stdout, /--single/);
});
