import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVerifiedAssessmentAnswers, getChapterAssessmentResultPath } from '../src/solver.js';

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

test('extracts official choice IDs and description model answers from a completed result', () => {
  const result = extractVerifiedAssessmentAnswers({
    result: {
      choice_results: [{
        question_id: 511009010,
        choices: [
          { correct: false, choice: { id: 5110090102 } },
          { correct: true, choice: { id: 5110090101 } }
        ]
      }],
      description_results: [{
        question_id: 511009040,
        model_answer: 'if a == 5 or b == 10:'
      }]
    }
  });

  assert.deepEqual(result, {
    '511009010': { type: 'choice', choice_id: 5110090101 },
    '511009040': { type: 'description', answer_code: 'if a == 5 or b == 10:' }
  });
});

