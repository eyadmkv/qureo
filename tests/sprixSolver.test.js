import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSprixAnswerBank, buildSprixChapterPlan, buildSprixCourseAnswerBank } from '../src/sprixSolver.js';

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
