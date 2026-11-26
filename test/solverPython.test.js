import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCourseData, getChapterAnswerCoverage, getQuestionAnswer, initializeLecturePage } from '../src/solver.js';

const pythonAnswers = {
  '511001010': { type: 'choice', choice_id: 5110010101 },
  '511001020': { type: 'description', answer_code: 'print("Good morning")' },
  '511001030': { type: 'description', answer_code: 'print("programming")' },
  '511001040': { type: 'description', answer_code: 'print("hello")' },
  '511001050': { type: 'choice', choice_id: 5110010501 },
  '511001060': { type: 'description', answer_code: 'print("Hello")' },
  '511002010': { type: 'choice', choice_id: 5110020101 },
  '511002020': { type: 'choice', choice_id: 5110020201 },
  '511002030': { type: 'description', answer_code: 'print(19 + 40)' },
  '511002040': { type: 'description', answer_code: 'print(7 - 2)' },
  '511002050': { type: 'description', answer_code: 'print(15 / 5)' },
  '511002060': { type: 'choice', choice_id: 5110020601 },
  '511002070': { type: 'description', answer_code: 'print("The answer is " + str(2 * 5))' },
  '511002080': { type: 'choice', choice_id: 5110020801 },
  '511002090': { type: 'choice', choice_id: 5110020901 }
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
    answerQuestions: 9,
    complete: true
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


test('initializes a lesson page through the saved session without launching a browser', async () => {
  const calls = [];
  const lessonUrl = 'https://me-tp.qureo.education/chapter/511001/lecture/511001030';
  const client = {
    async request(url, options) {
      calls.push({ url, method: options.method, accept: options.headers.Accept });
      return new Response('<html>QUREO lesson</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    }
  };

  const status = await initializeLecturePage(client, lessonUrl);

  assert.equal(status, 200);
  assert.deepEqual(calls, [{
    url: lessonUrl,
    method: 'GET',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }]);
});

test('reports an unsuccessful background lesson-page initialization', async () => {
  const client = {
    async request() {
      return new Response('Not found', { status: 404 });
    }
  };

  await assert.rejects(
    initializeLecturePage(client, 'https://me-tp.qureo.education/chapter/511001/lecture/511001030'),
    error => error.code === 'LESSON_PAGE_INIT_FAILED' && error.status === 404
  );
});


test('resolves all nine verified Python chapter 2 answers against QUREO types and option IDs', () => {
  const questions = [
    {
      question: { id: 511002010, type: 'choice' },
      choices: [{ id: 5110020101 }, { id: 5110020102 }, { id: 5110020103 }, { id: 5110020104 }]
    },
    {
      question: { id: 511002020, type: 'choice' },
      choices: [{ id: 5110020201 }, { id: 5110020202 }, { id: 5110020203 }, { id: 5110020204 }]
    },
    { question: { id: 511002030, type: 'description' }, choices: [] },
    { question: { id: 511002040, type: 'description' }, choices: [] },
    { question: { id: 511002050, type: 'description' }, choices: [] },
    {
      question: { id: 511002060, type: 'choice' },
      choices: [{ id: 5110020601 }, { id: 5110020602 }, { id: 5110020603 }, { id: 5110020604 }]
    },
    { question: { id: 511002070, type: 'description' }, choices: [] },
    {
      question: { id: 511002080, type: 'choice' },
      choices: [{ id: 5110020801 }, { id: 5110020802 }, { id: 5110020803 }]
    },
    {
      question: { id: 511002090, type: 'choice' },
      choices: [{ id: 5110020901 }, { id: 5110020902 }, { id: 5110020903 }, { id: 5110020904 }]
    }
  ];

  const resolved = questions.map(item => getQuestionAnswer(item, pythonAnswers));
  assert.deepEqual(resolved, [
    { type: 'choice', choice_id: 5110020101 },
    { type: 'choice', choice_id: 5110020201 },
    { type: 'description', answer_code: 'print(19 + 40)' },
    { type: 'description', answer_code: 'print(7 - 2)' },
    { type: 'description', answer_code: 'print(15 / 5)' },
    { type: 'choice', choice_id: 5110020601 },
    { type: 'description', answer_code: 'print("The answer is " + str(2 * 5))' },
    { type: 'choice', choice_id: 5110020801 },
    { type: 'choice', choice_id: 5110020901 }
  ]);
});
