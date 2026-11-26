import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSprixAnswerBank, parseSprixBlockAnswerBank, buildSprixChapterPlan, buildSprixTestPlan, buildSprixCourseAnswerBank, listSprixChapters, listSprixCourseItems, planSprixChapterSelection, planSprixCourseItemSelection, solveSprixCourse } from '../src/sprixSolver.js';

function sampleSource() {
  const data = {
    units: [{
      id: 1,
      title: 'أساسيات المال والتمويل',
      levels: [{
        id: 1,
        name: 'المستوى الأول',
        title: 'أساسيات المال',
        questions: [
          {
            id: 'q1',
            q: 'ما وظيفة المال في المجتمع؟',
            a: 'يعمل المال كوسيط للتبادل بين الناس'
          },
          {
            id: 'q2',
            q: 'ما الذي يدعم قيمة الأوراق النقدية؟',
            a: null
          }
        ]
      }]
    }]
  };
  return 'var DATA = ' + JSON.stringify(data) + ';';
}

test('imports the JSON DATA object from a userscript', () => {
  const bank = parseSprixAnswerBank(sampleSource(), 'source.user.js');
  assert.equal(bank.format, 'sprix-answer-bank');
  assert.equal(bank.unit_count, 1);
  assert.equal(bank.total, 2);
  assert.equal(bank.answered, 1);
  assert.equal(bank.unanswered, 1);
  assert.equal(bank.source, 'source.user.js');
});

test('imports a standalone DATA JSON object', () => {
  const source = JSON.stringify({ units: [{ id: 1, levels: [{ questions: [{ q: 'سؤال', a: 'إجابة' }] }] }] });
  const bank = parseSprixAnswerBank(source, 'bank.json');
  assert.equal(bank.total, 1);
  assert.equal(bank.answered, 1);
});

test('rejects userscripts without a DATA object', () => {
  assert.throws(() => parseSprixAnswerBank('// no bank here'), /Could not find/u);
});

test('imports subject-3 English chapter and test answer maps', () => {
  const block = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [
    String(index + 1),
    index + 1001
  ]));
  const bank = parseSprixBlockAnswerBank(JSON.stringify({
    block,
    test: Object.fromEntries(Array.from({ length: 380 }, (_, index) => [
      String(index + 1),
      index + 9999
    ]))
  }), 'https://example.test/subject3.json');

  assert.equal(bank.format, 'sprix-block-answer-bank');
  assert.equal(bank.subject_id, 3);
  assert.equal(bank.language, 'en');
  assert.equal(bank.total, 200);
  assert.equal(bank.answers['1'], 1001);
  assert.equal(bank.testTotal, 380);
  assert.equal(bank.testAnswers['1'], 9999);
  assert.equal(bank.source_url, 'https://example.test/subject3.json');
});

test('rejects an incomplete subject-3 block answer map', () => {
  assert.throws(
    () => parseSprixBlockAnswerBank(JSON.stringify({ block: { 27: 3 }, test: {} })),
    /incomplete/u
  );
});

test('uses exact English subject-3 block mappings for the first five course questions', () => {
  const bank = {
    subjectId: 3,
    questions: [],
    blockAnswers: {
      27: 3,
      50: 6,
      73: 11,
      98: 13,
      108: 20
    }
  };
  const prompts = [
    "What do you think was a major reason why barter didn't spread across society as a whole?",
    'Money was born to solve the limits of barter. Which best describes the role money plays?',
    'What mainly supports the value of modern paper money?',
    'What kind of state is "hyperinflation"?',
    'Which of the following is the most important reason money was born?'
  ];
  const optionIds = [3, 6, 11, 13, 20];
  const result = buildSprixChapterPlan({
    chapter: { title: 'How Money Began' },
    blocks: prompts.map((prompt, index) => ({
      id: [27, 50, 73, 98, 108][index],
      type: 'question',
      question: { text: prompt },
      options: [
        { id: optionIds[index] + 1000, text: 'Distractor option' },
        { id: optionIds[index], text: 'Mapped English answer' }
      ]
    }))
  }, bank);

  assert.equal(result.pendingQuestionCount, 5);
  assert.equal(result.plan.length, 5);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.plan.map(row => row.optionId), optionIds);
  assert.ok(result.plan.every(row => row.questionScore === 1 && row.optionScore === 1));
});

test('fails closed when an English block map points to an option absent from live data', () => {
  const result = buildSprixChapterPlan({
    chapter: {},
    blocks: [{
      id: 27,
      type: 'question',
      question: { text: 'English question' },
      options: [{ id: 4, text: 'Current option' }]
    }]
  }, {
    subjectId: 3,
    questions: [],
    blockAnswers: { 27: 3 }
  });

  assert.equal(result.plan.length, 0);
  assert.equal(result.unmatched.length, 1);
  assert.match(result.unmatched[0].reason, /absent from the live options/u);
});

test('builds test answer plans from test-question IDs and verifies live option IDs', () => {
  const result = buildSprixTestPlan({
    test_questions: [
      { id: 1, question_id: 62, sort_order: 1 },
      { id: 2, question_id: 63, sort_order: 2 }
    ],
    questions: {
      62: { question_text: 'Why was barter difficult?' },
      63: { question_text: 'What supports fiat currency?' }
    },
    options: {
      62: [{ id: 245, text: 'Correct option' }, { id: 247, text: 'Wrong option' }],
      63: [{ id: 250, text: 'Government and public trust' }]
    },
    question_responses: [{ test_question_id: 1, selected_option_id: 247 }]
  }, {
    testAnswers: { 1: 245, 2: 250 }
  });

  assert.equal(result.pendingQuestionCount, 2);
  assert.equal(result.plan.length, 2);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.plan.map(row => row.optionId), [245, 250]);
  assert.equal(result.plan[0].alreadySelected, false);
  assert.equal(result.plan[1].alreadySelected, false);
  assert.match(result.plan[0].prompt, /barter/u);
});

test('fails closed when a test map references an option absent from live options', () => {
  const result = buildSprixTestPlan({
    test_questions: [{ id: 1, question_id: 62 }],
    questions: { 62: { question_text: 'Question?' } },
    options: { 62: [{ id: 246, text: 'Current option' }] },
    question_responses: []
  }, { testAnswers: { 1: 245 } });

  assert.equal(result.plan.length, 0);
  assert.equal(result.unmatched.length, 1);
  assert.match(result.unmatched[0].reason, /absent from the live test options/u);
});

test('rejects test mappings explicitly marked incorrect by live SPRIX data', () => {
  const result = buildSprixTestPlan({
    test_questions: [{ id: 1, question_id: 62 }],
    questions: { 62: { question_text: 'Question?' } },
    options: { 62: [{ id: 245, text: 'Wrong', is_correct: false }] },
    question_responses: []
  }, { testAnswers: { 1: 245 } });

  assert.equal(result.plan.length, 0);
  assert.match(result.unmatched[0].reason, /explicitly marks.*incorrect/u);
});

test('matches chapter questions and option text against the imported bank', () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const result = buildSprixChapterPlan({
    chapter: { title: 'أساسيات المال', cleared_block_ids: [1] },
    blocks: [
      { id: 1, type: 'question', question: { text: 'سؤال تم حله' }, options: [] },
      {
        id: 2,
        type: 'question',
        question: { text: 'ما وظيفة المال في المجتمع؟' },
        options: [
          { id: 101, text: 'يتم تخزين المال داخل البنوك فقط' },
          { id: 102, text: 'يعمل المال كوسيط للتبادل بين الناس' },
          { id: 103, text: 'تقتصر وظيفة المال على شراء الذهب' }
        ]
      }
    ]
  }, bank);

  assert.equal(result.pendingQuestionCount, 1);
  assert.equal(result.plan.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.plan[0].blockId, 2);
  assert.equal(result.plan[0].optionId, 102);
  assert.equal(result.plan[0].questionScore, 1);
  assert.equal(result.plan[0].optionScore, 1);
});

test('matches Arabic and Western numeral combinations when the answer has no word tokens', () => {
  const source = {
    units: [{
      id: 1,
      title: 'أساسيات المال والتمويل',
      levels: [{
        id: 4,
        title: 'فهم الزكاة',
        questions: [{
          id: 'zakat-scenarios',
          q: 'من بين السيناريوهات الأربعة التالية، أي منها يصف الزكاة بأفضل شكل؟',
          a: '(١) و(٣)'
        }]
      }]
    }]
  };
  const bank = parseSprixAnswerBank(JSON.stringify(source));
  const result = buildSprixChapterPlan({
    chapter: { title: 'ما هي الزكاة؟' },
    blocks: [{
      id: 6941,
      type: 'question',
      question: { text: 'من بين السيناريوهات الأربعة التالية، أي منها يصف الزكاة بأفضل شكل؟' },
      options: [
        { id: 2681, text: '(١) و(٢)' },
        { id: 2682, text: '(1) and (3)' },
        { id: 2683, text: '(٢) و(٤)' },
        { id: 2684, text: '(٣) و(٤)' }
      ]
    }]
  }, bank);

  assert.equal(result.plan.length, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(result.plan[0].optionId, 2682);
  assert.equal(result.plan[0].optionScore, 1);
});

test('keeps numeric option matching fail-closed when more than one option has the same combination', () => {
  const source = {
    units: [{
      id: 1,
      levels: [{
        questions: [{
          q: 'ما الاختياران الصحيحان من السيناريوهات التالية؟',
          a: '(١) و(٣)'
        }]
      }]
    }]
  };
  const bank = parseSprixAnswerBank(JSON.stringify(source));
  const result = buildSprixChapterPlan({
    chapter: {},
    blocks: [{
      id: 1,
      type: 'question',
      question: { text: 'ما الاختياران الصحيحان من السيناريوهات التالية؟' },
      options: [
        { id: 10, text: '(١) و(٣)' },
        { id: 11, text: '(3) and (1)' }
      ]
    }]
  }, bank);

  assert.equal(result.plan.length, 0);
  assert.equal(result.unmatched.length, 1);
  assert.match(result.unmatched[0].reason, /ambiguous numeric match/u);
});

test('fails closed when a question has no confident bank match', () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const result = buildSprixChapterPlan({
    chapter: {},
    blocks: [{
      id: 10,
      type: 'question',
      question: { text: 'سؤال مختلف تماما عن أي سؤال محفوظ' },
      options: [{ id: 1, text: 'اختيار أول' }, { id: 2, text: 'اختيار ثان' }]
    }]
  }, bank);

  assert.equal(result.plan.length, 0);
  assert.equal(result.unmatched.length, 1);
});

test('marks duplicate matching options as ambiguous', () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const result = buildSprixChapterPlan({
    chapter: {},
    blocks: [{
      id: 11,
      type: 'question',
      question: { text: 'ما وظيفة المال في المجتمع؟' },
      options: [
        { id: 1, text: 'يعمل المال كوسيط للتبادل بين الناس' },
        { id: 2, text: 'يعمل المال كوسيط للتبادل بين الناس' }
      ]
    }]
  }, bank);

  assert.equal(result.plan.length, 0);
  assert.match(result.unmatched[0].reason, /ambiguous/u);
});

test('does not use bank records without an answer note', () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const result = buildSprixChapterPlan({
    chapter: {},
    blocks: [{
      id: 12,
      type: 'question',
      question: { text: 'ما الذي يدعم قيمة الأوراق النقدية؟' },
      options: [{ id: 1, text: 'الخيار الأول' }, { id: 2, text: 'الخيار الثاني' }]
    }]
  }, bank);

  assert.equal(result.plan.length, 0);
  assert.equal(result.unmatched.length, 1);
});


test('builds a local answer bank from SPRIX question_text fields and option IDs', () => {
  const source = {
    format: 'sprix-course-source',
    subject_id: 7,
    units: [{
      id: 10,
      title: 'أساسيات المال والتمويل',
      sections: [{
        items: [{
          id: 20,
          item_type: 'chapter',
          title: 'وظائف المال',
          source_status: 'fetched',
          data: {
            blocks: [{
              id: 30,
              type: 'question',
              question: { id: 40, question_text: 'ما وظيفة المال في المجتمع؟' },
              options: [
                { id: 50, text: 'تخزين المال فقط' },
                { id: 51, text: 'يعمل المال كوسيط للتبادل بين الناس' }
              ]
            }]
          }
        }, {
          id: 21,
          item_type: 'test',
          title: 'اختبار الوحدة'
        }]
      }]
    }]
  };
  const answerMap = {
    format: 'sprix-answer-map',
    schema_version: 1,
    subject_id: 7,
    course_id: 'sprix_subject_7_ar',
    answers: { '40': { choice_id: 51 } }
  };
  const bank = buildSprixCourseAnswerBank(source, answerMap, 'course-source.json');
  assert.equal(bank.total, 1);
  assert.equal(bank.answered, 1);
  assert.equal(bank.questions[0].question, 'ما وظيفة المال في المجتمع؟');
  assert.equal(bank.questions[0].answer, 'يعمل المال كوسيط للتبادل بين الناس');
  assert.equal(bank.coverage.chapter_questions, 1);
  assert.equal(bank.coverage.tests_listed, 1);

  const result = buildSprixChapterPlan({
    chapter: {},
    blocks: [{
      id: 30,
      type: 'question',
      question: { id: 40, question_text: 'ما وظيفة المال في المجتمع؟' },
      options: [
        { id: 50, text: 'تخزين المال فقط' },
        { id: 51, text: 'يعمل المال كوسيط للتبادل بين الناس' }
      ]
    }]
  }, bank);
  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].optionId, 51);
});

test('refuses to build a course bank when answer IDs do not cover the source', () => {
  const source = {
    format: 'sprix-course-source',
    subject_id: 7,
    units: [{
      id: 10,
      title: 'Unit',
      sections: [{
        items: [{
          id: 20,
          item_type: 'chapter',
          title: 'Chapter',
          source_status: 'fetched',
          data: {
            blocks: [{
              id: 30,
              type: 'question',
              question: { id: 40, question_text: 'Question?' },
              options: [{ id: 50, text: 'Answer' }]
            }]
          }
        }]
      }]
    }]
  };
  const answerMap = { format: 'sprix-answer-map', subject_id: 7, answers: {} };
  assert.throws(
    () => buildSprixCourseAnswerBank(source, answerMap),
    /1 source question\(s\) have no mapped option/u
  );
});

test('rejects an answer option that does not belong to its question', () => {
  const source = {
    format: 'sprix-course-source',
    subject_id: 7,
    units: [{
      id: 10,
      title: 'Unit',
      sections: [{
        items: [{
          id: 20,
          item_type: 'chapter',
          title: 'Chapter',
          source_status: 'fetched',
          data: {
            blocks: [{
              id: 30,
              type: 'question',
              question: { id: 40, question_text: 'Question?' },
              options: [{ id: 50, text: 'Answer' }]
            }]
          }
        }]
      }]
    }]
  };
  const answerMap = {
    format: 'sprix-answer-map',
    subject_id: 7,
    answers: { '40': { choice_id: 999 } }
  };
  assert.throws(
    () => buildSprixCourseAnswerBank(source, answerMap),
    /does not belong to question/u
  );
});


test('lists only chapter items in curriculum order and carries completion and unlock state', () => {
  const chapters = listSprixChapters([
    {
      title: 'Unit One',
      sections: [{
        items: [
          { id: 101, item_type: 'chapter', title: 'Chapter One', is_completed: true, is_unlocked: true },
          { id: 102, item_type: 'review', title: 'Review One' }
        ]
      }]
    },
    {
      title: 'Unit Two',
      items: [
        { id: 201, item_type: 'chapter', title: 'Chapter Two', is_completed: false, is_unlocked: false },
        { id: 202, item_type: 'test', title: 'Test Two' }
      ]
    }
  ]);

  assert.deepEqual(chapters.map(chapter => chapter.id), ['101', '201']);
  assert.deepEqual(chapters.map(chapter => chapter.sequence), [1, 2]);
  assert.equal(chapters[0].completed, true);
  assert.equal(chapters[0].unlocked, true);
  assert.equal(chapters[1].completed, false);
  assert.equal(chapters[1].unlocked, false);
  assert.equal(chapters[1].unitTitle, 'Unit Two');
});

test('plans all unfinished SPRIX chapters from the first unfinished chapter', () => {
  const chapters = [
    { id: '101', sequence: 1, completed: true },
    { id: '201', sequence: 2, completed: false },
    { id: '301', sequence: 3, completed: false },
    { id: '401', sequence: 4, completed: true }
  ];

  const result = planSprixChapterSelection(chapters);
  assert.deepEqual(result.chapters.map(chapter => chapter.id), ['201', '301']);
  assert.equal(result.selectionLabel, 'all remaining chapters');
});

test('supports single-chapter and maximum-chapter SPRIX solve limits', () => {
  const chapters = [
    { id: '101', sequence: 1, completed: true },
    { id: '201', sequence: 2, completed: false },
    { id: '301', sequence: 3, completed: false }
  ];

  const single = planSprixChapterSelection(chapters, { single: true });
  assert.deepEqual(single.chapters.map(chapter => chapter.id), ['201']);

  const limited = planSprixChapterSelection(chapters, { maxChapters: 1 });
  assert.deepEqual(limited.chapters.map(chapter => chapter.id), ['201']);

  const targeted = planSprixChapterSelection(chapters, { chapterId: '301' });
  assert.deepEqual(targeted.chapters.map(chapter => chapter.id), ['301']);
});

test('lists chapters, reviews and tests in curriculum order', () => {
  const items = listSprixCourseItems([{
    title: 'Unit One',
    sections: [{
      items: [
        { id: 101, item_type: 'chapter', title: 'Chapter One', is_completed: true },
        { id: 151, item_type: 'review', title: 'Review One', is_completed: false },
        { id: 201, item_type: 'test', title: 'Test One' },
        { id: 202, item_type: 'chapter', title: 'Chapter Two', is_completed: false }
      ]
    }]
  }]);

  assert.deepEqual(items.map(item => [item.itemType, item.id]), [
    ['chapter', '101'],
    ['review', '151'],
    ['test', '201'],
    ['chapter', '202']
  ]);
  assert.deepEqual(items.map(item => item.sequence), [1, 2, 3, 4]);
  assert.deepEqual(items.map(item => item.chapterSequence), [1, null, null, 2]);
  assert.equal(items[1].completed, false);
  assert.equal(items[1].unitTitle, 'Unit One');
});

test('plans reviews in order before the first unfinished chapter and respects chapter limits', () => {
  const items = [
    { id: '101', itemType: 'chapter', completed: true },
    { id: '151', itemType: 'review', completed: false },
    { id: '201', itemType: 'chapter', completed: false },
    { id: '251', itemType: 'review', completed: false },
    { id: '301', itemType: 'chapter', completed: false }
  ];

  const single = planSprixCourseItemSelection(items, { single: true });
  assert.deepEqual(single.items.map(item => item.id), ['151', '201']);

  const limited = planSprixCourseItemSelection(items, { maxChapters: 1 });
  assert.deepEqual(limited.items.map(item => item.id), ['151', '201']);

  const all = planSprixCourseItemSelection(items);
  assert.deepEqual(all.items.map(item => item.id), ['151', '201', '251', '301']);
});

test('automatically completes reviews at their position in the SPRIX course sequence', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const units = [{
    title: 'Unit',
    items: [
      { id: 101, item_type: 'chapter', title: 'Completed chapter', is_completed: true, is_unlocked: true },
      { id: 151, item_type: 'review', title: 'Required review', is_completed: false, is_unlocked: true },
      { id: 201, item_type: 'chapter', title: 'Next chapter', is_completed: false, is_unlocked: true }
    ]
  }];
  const calls = [];
  const session = {
    async getCurriculum() {
      return structuredClone(units);
    },
    async getReviewItems() {
      assert.fail('The solver does not need to fetch protected review items before completing a review.');
    },
    async completeReview(reviewId) {
      calls.push('complete-review:' + reviewId);
      units[0].items.find(item => String(item.id) === String(reviewId)).is_completed = true;
      return { data: { is_completed: true } };
    },
    async getChapterBlocks(chapterId) {
      calls.push('read-chapter:' + chapterId);
      return {
        chapter: { title: 'Next chapter', cleared_block_ids: [] },
        blocks: [{
          id: 202,
          type: 'question',
          question: { text: 'ما وظيفة المال في المجتمع؟' },
          options: [
            { id: 203, text: 'يعمل المال كوسيط للتبادل بين الناس' },
            { id: 204, text: 'تقتصر وظيفة المال على شراء الذهب' }
          ]
        }]
      };
    },
    async answerChapterQuestion(chapterId, blockId, optionId) {
      calls.push('answer:' + chapterId + ':' + blockId + ':' + optionId);
      return { data: { is_correct: true } };
    },
    async completeChapter(chapterId) {
      calls.push('complete-chapter:' + chapterId);
      units[0].items.find(item => String(item.id) === String(chapterId)).is_completed = true;
      return { data: { is_completed: true } };
    }
  };

  const result = await solveSprixCourse(session, bank, {
    onConfirm: async details => {
      assert.equal(details.chapters.length, 1);
      assert.equal(details.reviews.length, 1);
      return true;
    },
    onProgress: () => {}
  });

  assert.equal(result.chaptersProcessed, 1);
  assert.equal(result.chaptersCompleted, 1);
  assert.equal(result.reviewsProcessed, 1);
  assert.equal(result.reviewsCompleted, 1);
  assert.equal(result.questionsSubmitted, 1);
  assert.deepEqual(calls, [
    'complete-review:151',
    'read-chapter:201',
    'answer:201:202:203',
    'complete-chapter:201'
  ]);
});

test('dry-run previews reviews without fetching protected review items or completing them', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const calls = [];
  const session = {
    async getCurriculum() {
      return [{
        title: 'Unit',
        items: [{ id: 151, item_type: 'review', title: 'Review One', is_completed: false, is_unlocked: true }]
      }];
    },
    async getReviewItems() {
      assert.fail('Dry-run must not fetch protected review items.');
    },
    async completeReview() {
      assert.fail('Dry-run must not complete reviews.');
    }
  };

  const result = await solveSprixCourse(session, bank, {
    dryRun: true,
    onConfirm: async () => assert.fail('Dry-run must not ask for confirmation.'),
    onProgress: () => {}
  });

  assert.equal(result.reviewsProcessed, 1);
  assert.equal(result.reviewsCompleted, 0);
  assert.deepEqual(calls, []);
});

test('probes the live chapter endpoint when the curriculum lock flag is false', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const units = [{
    title: 'أساسيات المال والتمويل',
    is_accessible: true,
    items: [
      { id: 101, item_type: 'chapter', title: 'Previous chapter', is_completed: true, is_unlocked: true },
      { id: 201, item_type: 'chapter', title: 'Next chapter', is_completed: false, is_unlocked: false, is_accessible: false }
    ]
  }];
  const calls = [];
  const session = {
    async getCurriculum() {
      return structuredClone(units);
    },
    async getChapterBlocks(chapterId) {
      calls.push('read:' + chapterId);
      return {
        chapter: { title: 'Next chapter', cleared_block_ids: [] },
        blocks: [{
          id: 202,
          type: 'question',
          question: { text: 'ما وظيفة المال في المجتمع؟' },
          options: [
            { id: 203, text: 'يعمل المال كوسيط للتبادل بين الناس' },
            { id: 204, text: 'تقتصر وظيفة المال على شراء الذهب' }
          ]
        }]
      };
    },
    async answerChapterQuestion(chapterId, blockId, optionId) {
      calls.push('answer:' + chapterId + ':' + blockId + ':' + optionId);
      return { data: { is_correct: true } };
    },
    async completeChapter(chapterId) {
      calls.push('complete:' + chapterId);
      units[0].items.find(item => String(item.id) === String(chapterId)).is_completed = true;
      return { data: { is_completed: true, star_score: 5 } };
    }
  };

  const result = await solveSprixCourse(session, bank, {
    onConfirm: async () => true,
    onProgress: () => {}
  });

  assert.equal(result.chaptersCompleted, 1);
  assert.equal(result.questionsSubmitted, 1);
  assert.deepEqual(calls, ['read:201', 'answer:201:202:203', 'complete:201']);
});

test('stops safely when SPRIX denies a read-only chapter probe for a curriculum-locked chapter', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  let answersSubmitted = 0;
  const session = {
    async getCurriculum() {
      return [{
        title: 'Unit',
        is_accessible: true,
        items: [{ id: 201, item_type: 'chapter', title: 'Locked chapter', is_completed: false, is_unlocked: false, is_accessible: false }]
      }];
    },
    async getChapterBlocks() {
      throw new Error('SPRIX GET /api/v1/chapters/201/blocks failed: HTTP 403');
    },
    async answerChapterQuestion() {
      answersSubmitted++;
      return { data: { is_correct: true } };
    },
    async completeChapter() {
      assert.fail('A denied chapter must not be completed.');
    }
  };

  await assert.rejects(
    solveSprixCourse(session, bank, {
      onConfirm: async () => true,
      onProgress: () => {}
    }),
    /curriculum, and SPRIX denied the read-only chapter request/u
  );
  assert.equal(answersSubmitted, 0);
});

test('solves SPRIX chapters in order and refreshes progress to unlock the next chapter', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const units = [{
    title: 'Unit',
    items: [
      { id: 101, item_type: 'chapter', title: 'Chapter One', is_completed: false, is_unlocked: true },
      { id: 201, item_type: 'chapter', title: 'Chapter Two', is_completed: false, is_unlocked: false }
    ]
  }];
  const calls = [];
  const session = {
    async getCurriculum() {
      return structuredClone(units);
    },
    async getChapterBlocks(chapterId) {
      return {
        chapter: { title: 'Chapter ' + chapterId, cleared_block_ids: [] },
        blocks: [{
          id: Number(chapterId) + 1,
          type: 'question',
          question: { text: 'ما وظيفة المال في المجتمع؟' },
          options: [
            { id: Number(chapterId) + 2, text: 'يعمل المال كوسيط للتبادل بين الناس' },
            { id: Number(chapterId) + 3, text: 'تقتصر وظيفة المال على شراء الذهب' }
          ]
        }]
      };
    },
    async answerChapterQuestion(chapterId, blockId, optionId) {
      calls.push('answer:' + chapterId + ':' + blockId + ':' + optionId);
      return { data: { is_correct: true } };
    },
    async completeChapter(chapterId) {
      calls.push('complete:' + chapterId);
      const chapter = units[0].items.find(item => String(item.id) === String(chapterId));
      chapter.is_completed = true;
      const next = units[0].items.find(item => item.id > chapter.id && item.item_type === 'chapter');
      if (next) next.is_unlocked = true;
      return { data: { star_score: 3 } };
    }
  };

  const result = await solveSprixCourse(session, bank, {
    onConfirm: async () => true,
    onProgress: () => {}
  });

  assert.equal(result.chaptersProcessed, 2);
  assert.equal(result.chaptersCompleted, 2);
  assert.equal(result.questionsSubmitted, 2);
  assert.deepEqual(calls, [
    'answer:101:102:103',
    'complete:101',
    'answer:201:202:203',
    'complete:201'
  ]);
});

test('solves tests in curriculum order, remaps previously selected answers and unlocks the next chapter', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  bank.testAnswers = { 1: 245 };
  const units = [{
    title: 'Unit',
    items: [
      { id: 101, item_type: 'chapter', title: 'Completed chapter', is_completed: true, is_unlocked: true },
      { id: 151, item_type: 'review', title: 'Completed review', is_completed: true, is_unlocked: true },
      { id: 1, item_type: 'test', title: 'Role of Money', is_completed: false, is_unlocked: true },
      { id: 201, item_type: 'chapter', title: 'Next chapter', is_completed: false, is_unlocked: false }
    ]
  }];
  const calls = [];
  const session = {
    async getCurriculum() {
      return structuredClone(units);
    },
    async startTest(testId) {
      calls.push('start-test:' + testId);
      return {
        data: {
          test_questions: [{ id: 1, question_id: 62, sort_order: 1 }],
          questions: { 62: { question_text: 'Why was barter difficult?' } },
          options: { 62: [{ id: 245, text: 'Correct option' }, { id: 247, text: 'Wrong option' }] },
          question_responses: [{ test_question_id: 1, selected_option_id: 247 }]
        }
      };
    },
    async answerTestQuestion(testId, testQuestionId, optionId) {
      calls.push('test-answer:' + testId + ':' + testQuestionId + ':' + optionId);
      return { data: { saved: true } };
    },
    async submitTest(testId) {
      calls.push('submit-test:' + testId);
      units[0].items.find(item => String(item.id) === String(testId)).is_completed = true;
      units[0].items.find(item => item.id === 201).is_unlocked = true;
      return { data: { response: { status: 'completed', passed: true, total_score: 100 } } };
    },
    async getChapterBlocks(chapterId) {
      calls.push('read-chapter:' + chapterId);
      return {
        chapter: { title: 'Next chapter', cleared_block_ids: [] },
        blocks: [{
          id: 202,
          type: 'question',
          question: { text: 'ما وظيفة المال في المجتمع؟' },
          options: [
            { id: 203, text: 'يعمل المال كوسيط للتبادل بين الناس' },
            { id: 204, text: 'تقتصر وظيفة المال على شراء الذهب' }
          ]
        }]
      };
    },
    async answerChapterQuestion(chapterId, blockId, optionId) {
      calls.push('answer:' + chapterId + ':' + blockId + ':' + optionId);
      return { data: { is_correct: true } };
    },
    async completeChapter(chapterId) {
      calls.push('complete-chapter:' + chapterId);
      units[0].items.find(item => String(item.id) === String(chapterId)).is_completed = true;
      return { data: { is_completed: true } };
    }
  };

  const result = await solveSprixCourse(session, bank, {
    onConfirm: async details => {
      assert.equal(details.tests.length, 1);
      assert.equal(details.chapters.length, 1);
      return true;
    },
    onProgress: () => {}
  });

  assert.equal(result.testsCompleted, 1);
  assert.equal(result.testAnswersSubmitted, 1);
  assert.equal(result.chaptersCompleted, 1);
  assert.deepEqual(calls, [
    'start-test:1',
    'test-answer:1:1:245',
    'submit-test:1',
    'read-chapter:201',
    'answer:201:202:203',
    'complete-chapter:201'
  ]);
});

test('stops a dry-run at a test without starting an attempt or touching later locked chapters', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  bank.testAnswers = { 1: 245 };
  const calls = [];
  const session = {
    async getCurriculum() {
      return [{
        title: 'Unit',
        items: [
          { id: 1, item_type: 'test', title: 'Role of Money', is_completed: false, is_unlocked: true },
          { id: 201, item_type: 'chapter', title: 'Locked chapter', is_completed: false, is_unlocked: false }
        ]
      }];
    },
    async startTest() {
      calls.push('start');
      assert.fail('Dry-run must not start tests.');
    },
    async getChapterBlocks() {
      calls.push('chapter');
      assert.fail('Dry-run should stop at the test boundary.');
    }
  };

  const result = await solveSprixCourse(session, bank, {
    dryRun: true,
    onConfirm: async () => assert.fail('Dry-run must not ask for confirmation.'),
    onProgress: () => {}
  });

  assert.equal(result.testsProcessed, 1);
  assert.equal(result.testsCompleted, 0);
  assert.deepEqual(calls, []);
});

test('SPRIX dry-run previews the course without confirmation or state-changing requests', async () => {
  const bank = parseSprixAnswerBank(sampleSource());
  const session = {
    async getCurriculum() {
      return [{
        title: 'Unit',
        items: [{ id: 101, item_type: 'chapter', title: 'Chapter One', is_completed: false, is_unlocked: true }]
      }];
    },
    async getChapterBlocks() {
      return {
        chapter: { title: 'Chapter One', cleared_block_ids: [] },
        blocks: [{
          id: 102,
          type: 'question',
          question: { text: 'ما وظيفة المال في المجتمع؟' },
          options: [
            { id: 103, text: 'يعمل المال كوسيط للتبادل بين الناس' },
            { id: 104, text: 'تقتصر وظيفة المال على شراء الذهب' }
          ]
        }]
      };
    },
    async answerChapterQuestion() {
      assert.fail('Dry-run must not submit answers.');
    },
    async completeChapter() {
      assert.fail('Dry-run must not complete chapters.');
    }
  };

  const result = await solveSprixCourse(session, bank, {
    dryRun: true,
    onConfirm: async () => assert.fail('Dry-run must not ask for confirmation.'),
    onProgress: () => {}
  });

  assert.equal(result.chaptersProcessed, 1);
  assert.equal(result.chaptersCompleted, 0);
  assert.equal(result.questionsSubmitted, 0);
});
