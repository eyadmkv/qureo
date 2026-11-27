import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCourseData, getChapterAnswerCoverage, getQuestionAnswer, initializeLecture, isCompleted, markLectureCompleted, prepareQuestionAnswer, solveChapter } from '../src/solver.js';

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

test('recognizes completed chapters from best_correct_count when the count is complete', () => {
  assert.equal(isCompleted({ best_correct_count: 5 }, { question_count: 5 }), true);
  assert.equal(isCompleted({ best_correct_count: 4 }, { question_count: 5 }), false);
  assert.equal(isCompleted({ best_correct_count: 5 }, { question_count: 0 }), false);
  assert.equal(isCompleted({ completed_at: '2026-11-27T10:00:00Z' }, null), true);
});

test('uses a live choice option when a stale description answer is stored', () => {
  const prepared = prepareQuestionAnswer({
    question: { id: 511021030, type: 'choice' },
    choices: [{ id: 5110210302 }, { id: 5110210301 }]
  }, {
    '511021030': { type: 'description', answer_code: 'print(1)' }
  });

  assert.deepEqual(prepared, {
    answer: { type: 'choice', choice_id: 5110210302 },
    bootstrap: true
  });
});

test('uses a temporary description when a stale choice answer is stored', () => {
  const prepared = prepareQuestionAnswer({
    question: { id: 511021050, type: 'description' },
    choices: []
  }, {
    '511021050': { type: 'choice', choice_id: 5110210501 }
  });

  assert.deepEqual(prepared, {
    answer: { type: 'description', answer_code: 'print(1)' },
    bootstrap: true
  });
});

test('uses the first available option when a question type is omitted but choices exist', () => {
  const prepared = prepareQuestionAnswer({
    question: { id: 511021060 },
    choices: [{ id: 5110210602 }, { id: 5110210601 }]
  }, {});

  assert.deepEqual(prepared, {
    answer: { type: 'choice', choice_id: 5110210602 },
    bootstrap: true
  });
});

test('does not guess a choice question when its live options have no usable IDs', () => {
  assert.equal(prepareQuestionAnswer({
    question: { id: 511021070, type: 'choice' },
    choices: [{ text: 'Option without an ID' }]
  }, {}), null);
});

test('completes a type-safe bootstrap attempt, harvests official answers, and retries', async () => {
  const questionRows = [
    {
      question: { id: 511021030, type: 'choice' },
      choices: [{ id: 5110210302 }, { id: 5110210301 }]
    },
    {
      question: { id: 511021050, type: 'description' },
      choices: []
    }
  ];
  const answers = {
    '511021030': { type: 'description', answer_code: 'print(1)' },
    '511021050': { type: 'choice', choice_id: 5110210501 }
  };
  const officialDescription = 'print("QUREO model answer")';
  const answerCalls = [];
  const attempts = [];
  let attempt = 0;
  const client = {
    async request(url, options) {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/students/chapters/511021/test')) {
        attempt++;
        attempts.push(attempt);
        return new Response('{}', { status: 200 });
      }

      const match = pathname.match(/\/students\/review-questions\/(\d+)\/answer\/(choice|description)$/);
      assert.ok(match, 'unexpected request: ' + pathname);
      const body = JSON.parse(options.body);
      answerCalls.push({ attempt, questionId: match[1], type: match[2], body });
      const correct = attempt > 1;
      return new Response(JSON.stringify({ result: { correct } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    async json(pathname) {
      assert.equal(pathname, '/students/chapters/511021/review/result');
      return {
        result: {
          correct_count: attempt > 1 ? 2 : 0,
          choice_results: [{
            question_id: '511021030',
            choices: [
              { choice: { id: 5110210302 }, correct: false },
              { choice: { id: 5110210301 }, correct: true }
            ]
          }],
          description_results: [{
            question_id: '511021050',
            model_answer: officialDescription
          }]
        }
      };
    }
  };
  const persisted = [];

  const result = await solveChapter(
    client,
    { id: 511021, seq: 21, name: 'Python', test_type: 'review' },
    { lectures: [] },
    questionRows,
    answers,
    {
      dryRun: false,
      lessonsAlreadyCompleted: true,
      onProgress: () => {},
      persistRetrievedAnswer: record => {
        persisted.push(record);
        return { answer_id: persisted.length };
      }
    }
  );

  assert.equal(result.attempts, 2);
  assert.equal(result.correct, 2);
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(answerCalls.slice(0, 2), [
    { attempt: 1, questionId: '511021030', type: 'choice', body: { choice_id: 5110210302 } },
    { attempt: 1, questionId: '511021050', type: 'description', body: { answer_code: 'print(1)' } }
  ]);
  assert.deepEqual(answerCalls.slice(2), [
    { attempt: 2, questionId: '511021030', type: 'choice', body: { choice_id: 5110210301 } },
    { attempt: 2, questionId: '511021050', type: 'description', body: { answer_code: officialDescription } }
  ]);
  assert.equal(answers['511021030'].choice_id, 5110210301);
  assert.equal(answers['511021050'].answer_code, officialDescription);
  assert.equal(persisted.length, 2);
});

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

test('preserves full Chapter 9 source code in description answer payloads', () => {
  const answers = {
    '511009040': {
      type: 'description',
      answer_code: 'a = 5\nb = 10\nif a == 5 or b == 10:\n    print("The condition is met")'
    }
  };

  assert.deepEqual(getQuestionAnswer({
    question: {
      id: 511009040,
      type: 'description',
      content: 'أنهي سطر يتحط مكان الفراغ؟'
    }
  }, answers), {
    type: 'description',
    answer_code: 'a = 5\nb = 10\nif a == 5 or b == 10:\n    print("The condition is met")'
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


test('initializes a lesson before opening the hidden browser after completion returns 404', async () => {
  const requests = [];
  const browserCalls = [];
  const client = {
    async request(url, options) {
      requests.push({ url, method: options.method });
      return requests.length === 1
        ? new Response('{}', { status: 200 })
        : new Response('Not found', { status: 404 });
    }
  };
  const browser = {
    async completeLecture(lessonId, lectureUrl) {
      browserCalls.push({ lessonId, lectureUrl });
      return { status: 200, ok: true, body: '' };
    }
  };
  const progress = [];

  await markLectureCompleted(
    client,
    '511002',
    { id: 511002030 },
    false,
    message => progress.push(message),
    browser
  );

  assert.deepEqual(requests, [
    {
      url: 'https://me-tp.qureo.education/api/study/students/lectures/511002030',
      method: 'PUT'
    },
    {
      url: 'https://me-tp.qureo.education/api/study/students/lectures/511002030/complete',
      method: 'PUT'
    }
  ]);
  assert.deepEqual(browserCalls, [{
    lessonId: 511002030,
    lectureUrl: 'https://me-tp.qureo.education/chapter/511002/lecture/511002030'
  }]);
  assert.equal(progress.at(-1), '  lesson 511002030: completed');
});

test('does not open a browser when lesson initialization and completion succeed', async () => {
  const requests = [];
  const client = {
    async request(url, options) {
      requests.push({ url, method: options.method });
      return new Response('{}', { status: 200 });
    }
  };
  const browser = {
    async completeLecture() {
      assert.fail('Browser should not be launched for an already available completion API.');
    }
  };

  await markLectureCompleted(
    client,
    '511002',
    { id: 511002010 },
    false,
    () => {},
    browser
  );
  assert.deepEqual(requests.map(row => new URL(row.url).pathname), [
    '/api/study/students/lectures/511002010',
    '/api/study/students/lectures/511002010/complete'
  ]);
});

test('does not retry a completion 404 after browser initialization also fails', async () => {
  let directRequests = 0;
  const client = {
    async request() {
      directRequests++;
      return directRequests === 1
        ? new Response('{}', { status: 200 })
        : new Response('Not found', { status: 404 });
    }
  };
  const browser = {
    async completeLecture() {
      return { status: 404, ok: false, body: 'Still unavailable' };
    }
  };

  await assert.rejects(
    markLectureCompleted(
      client,
      '511002',
      { id: 511002030 },
      false,
      () => {},
      browser
    ),
    error => error.code === 'LESSON_COMPLETION_FAILED' && error.status === 404
  );
  assert.equal(directRequests, 2);
});

test('completes a failed assessment attempt, harvests QUREO model answers, and retries the same chapter', async () => {
  const modelAnswer4 = 'a = 5\nb = 10\nif a == 5 or b == 10:\n    print("The condition is met")';
  const modelAnswer5 = 'a = 4\nb = 3\nif a >= 2 and b >= 3:\n    print("The condition is met")';
  const questionRows = [
    {
      question: { id: 511009010, type: 'choice' },
      choices: [{ id: 5110090101 }, { id: 5110090102 }]
    },
    {
      question: { id: 511009020, type: 'choice' },
      choices: [{ id: 5110090201 }, { id: 5110090202 }]
    },
    {
      question: { id: 511009030, type: 'choice' },
      choices: [{ id: 5110090301 }, { id: 5110090302 }]
    },
    {
      question: { id: 511009040, type: 'description', content: 'Question 4' },
      choices: []
    },
    {
      question: { id: 511009050, type: 'description', content: 'Question 5' },
      choices: []
    }
  ];
  const answers = {
    '511009010': { type: 'choice', choice_id: 5110090101 },
    '511009020': { type: 'choice', choice_id: 5110090201 },
    '511009030': { type: 'choice', choice_id: 5110090301 },
    '511009040': { type: 'description', answer_code: 'if a == 5 or b == 10:' },
    '511009050': { type: 'description', answer_code: 'if a >= 2 and b >= 3:' }
  };
  const answerCalls = [];
  const persisted = [];
  let attempt = 0;
  const client = {
    async request(url, options) {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/students/chapters/511009/test')) {
        attempt++;
        return new Response('{}', { status: 200 });
      }

      const match = pathname.match(/\/students\/review-questions\/(\d+)\/answer\/(choice|description)$/);
      assert.ok(match, 'unexpected request: ' + pathname);
      const questionId = match[1];
      const body = JSON.parse(options.body);
      answerCalls.push({ attempt, questionId, body });
      const incorrect = attempt === 1 && ['511009040', '511009050'].includes(questionId);
      return new Response(JSON.stringify({ result: { correct: !incorrect } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    },
    async json(pathname) {
      assert.equal(pathname, '/students/chapters/511009/review/result');
      if (attempt === 1) {
        return {
          result: {
            correct_count: 3,
            choice_results: [],
            description_results: [
              { question_id: '511009040', model_answer: modelAnswer4 },
              { question_id: '511009050', model_answer: modelAnswer5 }
            ]
          }
        };
      }
      return {
        result: {
          correct_count: 5,
          choice_results: [],
          description_results: [
            { question_id: '511009040', model_answer: modelAnswer4 },
            { question_id: '511009050', model_answer: modelAnswer5 }
          ]
        }
      };
    }
  };

  const result = await solveChapter(
    client,
    { id: 511009, seq: 9, name: 'العامل المنطقي', test_type: 'review' },
    { lectures: [] },
    questionRows,
    answers,
    {
      dryRun: false,
      lessonsAlreadyCompleted: true,
      onProgress: () => {},
      persistRetrievedAnswer: record => {
        persisted.push(record);
        return { answer_id: persisted.length };
      }
    }
  );

  assert.equal(result.attempts, 2);
  assert.equal(result.submitted, 10);
  assert.equal(result.correct, 5);
  assert.equal(answerCalls.length, 10);
  assert.deepEqual(answerCalls.slice(0, 5).map(call => call.questionId), [
    '511009010', '511009020', '511009030', '511009040', '511009050'
  ]);
  assert.equal(answerCalls[3].body.answer_code, 'if a == 5 or b == 10:');
  assert.equal(answerCalls[8].body.answer_code, modelAnswer4);
  assert.equal(answerCalls[9].body.answer_code, modelAnswer5);
  assert.ok(persisted.some(row => row.questionKey === '511009040' && row.answerText === modelAnswer4));
  assert.ok(persisted.some(row => row.questionKey === '511009050' && row.answerText === modelAnswer5));
});

