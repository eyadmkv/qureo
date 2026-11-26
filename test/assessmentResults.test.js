import test from 'node:test';
import assert from 'node:assert/strict';
import { getChapterAssessmentResultPath } from '../src/solver.js';

test('builds the review result endpoint for review chapters', () => {
  assert.equal(
    getChapterAssessmentResultPath('511009', 'review'),
    '/students/chapters/511009/review/result'
  );
});

test('builds the test result endpoint for test chapters', () => {
  assert.equal(
    getChapterAssessmentResultPath('511004', 'test'),
    '/students/chapters/511004/test/result'
  );
});

test('encodes chapter IDs in assessment result paths', () => {
  assert.equal(
    getChapterAssessmentResultPath('chapter/unsafe', 'review'),
    '/students/chapters/chapter%2Funsafe/review/result'
  );
});
