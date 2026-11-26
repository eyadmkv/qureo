import test from 'node:test';
import assert from 'node:assert/strict';
import { PYTHON_COURSE_ID, resolveSolveTarget } from '../src/solveCommand.js';

test('resolves the Python shortcut without a chapter range', () => {
  assert.deepEqual(resolveSolveTarget('python'), {
    courseId: PYTHON_COURSE_ID,
    targetChapter: null
  });
});

test('resolves the Python shortcut with a chapter range', () => {
  assert.deepEqual(resolveSolveTarget('python', '3-8'), {
    courseId: PYTHON_COURSE_ID,
    targetChapter: '3-8'
  });
});

test('preserves existing chapter-range and --course behavior', () => {
  assert.deepEqual(resolveSolveTarget('3-8', undefined, 'javascript_ar'), {
    courseId: 'javascript_ar',
    targetChapter: '3-8'
  });
  assert.deepEqual(resolveSolveTarget(undefined, undefined, 'python_short_ar'), {
    courseId: 'python_short_ar',
    targetChapter: null
  });
});

test('rejects ambiguous positional arguments and conflicting course selection', () => {
  assert.throws(() => resolveSolveTarget('3-8', 'javascript_ar'), /qureo solve python/);
  assert.throws(() => resolveSolveTarget('python', undefined, 'javascript_ar'), /different --course/);
});
