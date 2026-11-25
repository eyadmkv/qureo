import test from 'node:test';
import assert from 'node:assert/strict';
import { planChapterSelection } from '../src/solveSelection.js';

function makeChapters(completedThrough = 2, count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(90001 + index),
    seq: index + 1,
    name: `Chapter ${index + 1}`,
    completed: index < completedThrough
  }));
}

test('chapter ranges start at the first unfinished chapter', () => {
  const plan = planChapterSelection(makeChapters(2), { targetChapter: '2-5' });
  assert.deepEqual(plan.chapters.map(row => row.chapter.seq), [3, 4, 5]);
});

test('a range cannot jump over an earlier unfinished chapter', () => {
  assert.throws(
    () => planChapterSelection(makeChapters(1), { targetChapter: '3-5' }),
    /solver will not skip it/i
  );
});

test('numeric target preserves the existing through-chapter behavior', () => {
  const plan = planChapterSelection(makeChapters(2), { targetChapter: '4' });
  assert.deepEqual(plan.chapters.map(row => row.chapter.seq), [3, 4]);
});

test('single mode selects only the current unfinished chapter', () => {
  const plan = planChapterSelection(makeChapters(2), { single: true });
  assert.deepEqual(plan.chapters.map(row => row.chapter.seq), [3]);
});

test('single mode refuses to skip ahead', () => {
  assert.throws(
    () => planChapterSelection(makeChapters(2), { targetChapter: '4', single: true }),
    /will not skip ahead/i
  );
});

test('maximum chapter count limits the selected work', () => {
  const plan = planChapterSelection(makeChapters(2), {
    targetChapter: '2-8',
    maxChapters: 2
  });
  assert.deepEqual(plan.chapters.map(row => row.chapter.seq), [3, 4]);
});

test('completed chapters can be revisited only when skipping is disabled in a range', () => {
  const plan = planChapterSelection(makeChapters(2), {
    targetChapter: '1-4',
    skipCompleted: false
  });
  assert.deepEqual(plan.chapters.map(row => row.chapter.seq), [1, 2, 3, 4]);
});

test('completed chapters are skipped by default', () => {
  const plan = planChapterSelection(makeChapters(2), {
    targetChapter: '1-4'
  });
  assert.deepEqual(plan.chapters.map(row => row.chapter.seq), [3, 4]);
});

test('ranges must be ascending', () => {
  assert.throws(
    () => planChapterSelection(makeChapters(2), { targetChapter: '5-2' }),
    /ascending order/i
  );
});

test('a completed range produces no work when skip mode is enabled', () => {
  const plan = planChapterSelection(makeChapters(8), { targetChapter: '2-5' });
  assert.equal(plan.chapters.length, 0);
  assert.match(plan.summary, /no unfinished chapters/i);
});
