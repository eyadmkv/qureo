import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SOLVE_TARGETS, createSolvePlan, formatProgressBar, splitSolvePlan, summarizeSprixCurriculum } from '../src/qstudy.js';

const entryPath = fileURLToPath(new URL('../src/qstudy-entry.js', import.meta.url));

test('QStudy entrypoint exits cleanly for help and version', () => {
  for (const [argument, expected] of [
    ['--help', /QStudy 0\.6\.0 \| unified QUREO \+ SPRIX CLI/],
    ['--version', /^0\.6\.0\s*$/]
  ]) {
    const result = spawnSync(process.execPath, [entryPath, argument], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, expected);
    assert.doesNotMatch(result.stderr, /TypeError|Cannot read properties/);
  }
});

test('bare qstudy starts the interactive combined solver', () => {
  const result = spawnSync(process.execPath, [entryPath], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /qstudy solve requires an interactive terminal/);
  assert.doesNotMatch(result.stdout, /unified QUREO \+ SPRIX CLI/);
});

test('defaults bare QStudy to JavaScript and SPRIX', () => {
  assert.deepEqual(DEFAULT_SOLVE_TARGETS, ['javascript', 'sprix']);
});

test('groups QUREO targets together while SPRIX runs as a separate worker', () => {
  const plan = createSolvePlan(['sprix', 'python', 'javascript']);
  const groups = splitSolvePlan(plan);
  assert.deepEqual(groups.qureo.map(task => task.id), ['javascript', 'python']);
  assert.deepEqual(groups.sprix.map(task => task.id), ['sprix']);
});

test('builds an ordered solve plan for selected QUREO and SPRIX targets', () => {
  assert.deepEqual(createSolvePlan(['sprix', 'python', 'javascript']), [
    {
      id: 'javascript',
      label: 'JavaScript',
      service: 'qureo',
      args: ['solve', '--course', 'javascript_ar', '--interactive']
    },
    {
      id: 'python',
      label: 'Python',
      service: 'qureo',
      args: ['python', 'solve', '--interactive']
    },
    {
      id: 'sprix',
      label: 'SPRIX',
      service: 'sprix',
      args: ['solve']
    }
  ]);
});

test('adds dry-run to every selected solver without chapter confirmations', () => {
  const plan = createSolvePlan(['javascript', 'python', 'sprix'], { dryRun: true });
  assert.deepEqual(plan.map(task => task.args), [
    ['solve', '--course', 'javascript_ar', '--dry-run'],
    ['python', 'solve', '--dry-run'],
    ['solve', '--dry-run']
  ]);
});

test('deduplicates solve targets and rejects unsupported targets', () => {
  assert.equal(createSolvePlan(['python', 'python']).length, 1);
  assert.throws(() => createSolvePlan(['biology']), /Unknown solve target/);
});

test('summarizes SPRIX curriculum progress across sections', () => {
  const summary = summarizeSprixCurriculum({
    format: 'sprix-curriculum-snapshot',
    subject_id: 7,
    synced_at: '2026-11-27T10:00:00.000Z',
    units: [
      {
        id: 1,
        title: 'Unit one',
        sections: [
          { items: [{ id: 1, is_completed: true }, { id: 2, is_completed: false }] },
          { items: [{ id: 3, is_completed: true }] }
        ]
      },
      {
        id: 2,
        name: 'Unit two',
        items: [{ id: 4, is_completed: false }]
      }
    ]
  });

  assert.equal(summary.completed, 2);
  assert.equal(summary.total, 4);
  assert.equal(summary.percent, 50);
  assert.equal(summary.subjectId, 7);
  assert.equal(summary.units[0].percent, 67);
  assert.equal(summary.units[1].title, 'Unit two');
});

test('returns null for missing or unsupported SPRIX snapshots', () => {
  assert.equal(summarizeSprixCurriculum(null), null);
  assert.equal(summarizeSprixCurriculum({ units: [] }), null);
});

test('formats progress bars for complete, partial and empty progress', () => {
  assert.equal(formatProgressBar(3, 4, 8), '[██████░░] 75%');
  assert.equal(formatProgressBar(4, 4, 8), '[████████] 100%');
  assert.equal(formatProgressBar(0, 0, 8), '[░░░░░░░░] 0%');
  assert.equal(formatProgressBar(1, 2, 0), '[██████████░░░░░░░░░░] 50%');
});
