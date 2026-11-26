import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSprixAnswerBank, buildSprixChapterPlan, buildSprixCourseAnswerBank, listSprixChapters, planSprixChapterSelection, solveSprixCourse } from '../src/sprixSolver.js';

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
