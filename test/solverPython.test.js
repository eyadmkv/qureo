import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCourseData, getChapterAnswerCoverage, getQuestionAnswer, initializeLecture } from '../src/solver.js';

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


test('loads lesson content through the observed QUREO lecture endpoint', async () => {
  const calls = [];
  const lessonId = '511002020';
  const referer = 'https://me-tp.qureo.education/chapter/511002/lecture/511002020';
  const lessonContent = {
    chapter: { id: 511002, name: 'الحسابات والنصوص', question_count: 9 },
    lecture: { chapter_id: 511002, id: 511002020, seq: 2, title: 'طريقة الحساب' },
    section: { course_id: 'python_short_ar', id: 106 },
    summaries: [],
    talks: [{ id: 51100202001, lecture_id: 511002020, type: 'teacher', body: { serif: 'درس تجريبي' } }]
  };
  const client = {
    async request(url, options) {
      calls.push({
        url,
        method: options.method,
        accept: options.headers.Accept,
        referer: options.headers.Referer
      });
      return new Response(JSON.stringify(lessonContent), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  };

  const result = await initializeLecture(client, lessonId, referer);

  assert.deepEqual(result, lessonContent);
  assert.deepEqual(calls, [{
    url: 'https://me-tp.qureo.education/api/study/lectures/511002020',
    method: 'GET',
    accept: 'application/json, text/plain, */*',
    referer
  }]);
});

test('rejects lecture content that belongs to a different lesson', async () => {
  const client = {
    async request() {
      return new Response(JSON.stringify({
        lecture: { id: 511001030 },
        talks: []
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  };

  await assert.rejects(
    initializeLecture(client, '511002020', 'https://me-tp.qureo.education/chapter/511002/lecture/511002020'),
    error => error.code === 'LESSON_INIT_UNCONFIRMED'
  );
});

test('reports a failed QUREO lecture API initialization', async () => {
  const client = {
    async request() {
      return new Response('Not found', { status: 404 });
    }
  };

  await assert.rejects(
    initializeLecture(client, '511001030', 'https://me-tp.qureo.education/chapter/511001/lecture/511001030'),
    error => error.code === 'HTTP_ERROR' && error.status === 404
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
