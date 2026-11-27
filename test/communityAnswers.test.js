import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommunityAnswers, parseCommunityAnswerArchive } from '../src/communityAnswers.js';
import { getQuestionAnswer } from '../src/solver.js';

test('parses community choice and description answers into solver records', () => {
  const result = parseCommunityAnswerArchive({
    '90001': {
      '90001010': ['choice', 900010101],
      '90001020': ['description', 'console.log("Hello");']
    },
    '511001': {
      '511001010': ['choice', 5110010101]
    }
  }, { minimumAnswers: 1 });

  assert.equal(result.chapterCount, 2);
  assert.equal(result.answerCount, 3);
  assert.equal(result.choiceCount, 2);
  assert.equal(result.descriptionCount, 1);
  assert.deepEqual(result.answers['90001010'], {
    type: 'choice',
    choice_id: 900010101
  });
  assert.deepEqual(result.answers['90001020'], {
    type: 'description',
    answer_code: 'console.log("Hello");'
  });
});

test('rejects malformed or unexpectedly small community archives', () => {
  assert.throws(() => parseCommunityAnswerArchive({}), /unexpectedly small or empty/);
  assert.throws(() => parseCommunityAnswerArchive({
    '90001': { '90001010': ['unknown', 'answer'] }
  }), /Unsupported answer type/);
  assert.throws(() => parseCommunityAnswerArchive({
    '90001': { '90001010': ['choice', 'not-an-id'] }
  }), /Invalid choice ID/);
});

test('rejects conflicting duplicate question IDs', () => {
  assert.throws(() => parseCommunityAnswerArchive({
    '90001': { '90001010': ['choice', 900010101] },
    '90002': { '90001010': ['choice', 900010102] }
  }), /Conflicting duplicate answer/);
});

test('course-specific answers take precedence over community fallback answers', () => {
  const merged = mergeCommunityAnswers(
    { '90001010': { type: 'choice', choice_id: 900010102 } },
    {
      '90001010': { type: 'choice', choice_id: 900010101 },
      '90001020': { type: 'description', answer_code: 'console.log("fallback");' }
    }
  );

  assert.deepEqual(merged['90001010'], { type: 'choice', choice_id: 900010102 });
  assert.deepEqual(merged['90001020'], {
    type: 'description',
    answer_code: 'console.log("fallback");'
  });
});

test('community choice IDs are accepted only when present in live question choices', () => {
  const answers = {
    '90001010': { type: 'choice', choice_id: 900010101 }
  };

  assert.deepEqual(getQuestionAnswer({
    question: { id: 90001010, type: 'choice' },
    choices: [{ id: 900010101 }, { id: 900010102 }]
  }, answers), { type: 'choice', choice_id: 900010101 });

  assert.equal(getQuestionAnswer({
    question: { id: 90001010, type: 'choice' },
    choices: [{ id: 900010102 }]
  }, answers), null);
});


test('preserves complete archived Chapter 9 programs until QUREO supplies its model answer', () => {
  const answers = {
    '511009040': {
      type: 'description',
      answer_code: 'a = 5\nb = 10\nif a == 5 or b == 10:\n    print("The condition is met")'
    },
    '511009050': {
      type: 'description',
      answer_code: 'a = 4\nb = 3\nif a >= 2 and b >= 3:\n    print("The condition is met")'
    }
  };

  assert.deepEqual(getQuestionAnswer({
    question: {
      id: 511009040,
      type: 'description',
      content: 'أنهي سطر يتحط مكان الفراغ؟\na = 5\nb = 10\n____'
    }
  }, answers), {
    type: 'description',
    answer_code: 'a = 5\nb = 10\nif a == 5 or b == 10:\n    print("The condition is met")'
  });

  assert.deepEqual(getQuestionAnswer({
    question: {
      id: 511009050,
      type: 'description',
      content: 'كمّل السطر الناقص.\na = 4\nb = 3\n____'
    }
  }, answers), {
    type: 'description',
    answer_code: 'a = 4\nb = 3\nif a >= 2 and b >= 3:\n    print("The condition is met")'
  });
});
