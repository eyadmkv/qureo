import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCourseData, getChapterAnswerCoverage, getQuestionAnswer } from '../src/solver.js';

const pythonAnswers = {
  '511001010': { type: 'choice', choice_id: 5110010101 },
  '511001020': { type: 'description', answer_code: 'print("Good morning")' },
  '511001030': { type: 'description', answer_code: 'print("programming")' },
  '511001040': { type: 'description', answer_code: 'print("hello")' },
  '511001050': { type: 'choice', choice_id: 5110010501 },
  '511001060': { type: 'description', answer_code: 'print("Hello")' }
};

test('resolves Python choice questions against their actual option IDs', () => {
  const result = getQuestionAnswer({
    question: { id: 511001010, type: 'choice' },
    choices: [
      { id: 5110010101, text: 'print("Hello")' },
      { id: 5110010102, text: 'print(Hello)' }
    ]
  }, pythonAnswers);

  assert.deepEqual(result, { type: 'choice', choice_id: 5110010101 });
});

test('resolves Python description questions to their saved code answers', () => {
  const result = getQuestionAnswer({
    question: { id: 511001020, type: 'description' },
    choices: []
  }, pythonAnswers);

  assert.deepEqual(result, {
    type: 'description',
    answer_code: 'print("Good morning")'
  });
});

test('rejects a Python choice answer whose option is absent from the question', () => {
  const result = getQuestionAnswer({
    question: { id: 511001010, type: 'choice' },
    choices: [{ id: 5110010199, text: 'Different option' }]
  }, pythonAnswers);

  assert.equal(result, null);
});

test('checks answer-bank coverage before unlocking a Python chapter assessment', () => {
  const firstChapter = getChapterAnswerCoverage(
    { chapter: { question_count: 6 } },
    '511001',
    pythonAnswers
  );
  const secondChapter = getChapterAnswerCoverage(
    { chapter: { question_count: 9 } },
    '511002',
    pythonAnswers
  );

  assert.deepEqual(firstChapter, {
    expectedQuestions: 6,
    answerQuestions: 6,
    complete: true
  });
  assert.deepEqual(secondChapter, {
    expectedQuestions: 9,
    answerQuestions: 0,
    complete: false
  });
});


test('initializes the selected course page before fetching its learning API data', async () => {
  const calls = [];
  const courseData = { basic_section: { id: 106 } };
  const client = {
    async request(url, options) {
      calls.push({ type: 'page', url, method: options.method });
      return new Response('', { status: 200 });
    },
    async json(path) {
      calls.push({ type: 'api', path });
      return courseData;
    }
  };

  const result = await fetchCourseData(client, 'python_short_ar');

  assert.equal(result, courseData);
  assert.deepEqual(calls, [
    {
      type: 'page',
      url: 'https://me-tp.qureo.education/?content_id=python_short_ar',
      method: 'GET'
    },
    {
      type: 'api',
      path: '/courses/python_short_ar'
    }
  ]);
});
