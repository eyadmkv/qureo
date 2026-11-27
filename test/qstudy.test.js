import test from 'node:test';
import assert from 'node:assert/strict';
import { formatProgressBar, summarizeSprixCurriculum } from '../src/qstudy.js';

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
