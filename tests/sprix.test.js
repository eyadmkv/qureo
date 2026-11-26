import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSprixQuestions, normalizeSprixText, captureSprixLesson } from '../src/sprix.js';

test('parses four-option Arabic multiple-choice questions', () => {
  const source = [
    'في رأيك، ما السبب الرئيسي الذي حال دون انتشار نظام المقايضة في المجتمع ككل؟',
    'اختار إجابة واحدة!',
    '',
    'A',
    'كان من الصعب حمل الأشياء المراد تبادلها، فكانت التجارة مع أشخاص بعيدين أمرًا صعبًا',
    'B',
    'كانت الأشياء تختلف في حجمها ووزنها، مما جعل من الضروري وجود أدوات للقياس',
    'C',
    'من الصعب أن تجد شخصًا يملك ما تريده ويريد ما تملكه',
    'D',
    'كانت الفصول والأحوال المناخية تحدّ من نوعية الأشياء التي يمكن تبادلها عند الحاجة',
    'ورّيني تلميح (فاضل 1)',
    'راجع إجابتي',
    'المحاولات السابقة'
  ].join('\n');

  const questions = parseSprixQuestions(source);
  assert.equal(questions.length, 1);
  assert.match(questions[0].id, /^spx_[a-f0-9]{16}$/u);
  assert.equal(questions[0].prompt, 'في رأيك، ما السبب الرئيسي الذي حال دون انتشار نظام المقايضة في المجتمع ككل؟');
  assert.deepEqual(questions[0].choices.map(choice => choice.label), ['A', 'B', 'C', 'D']);
  assert.match(questions[0].choices[2].text, /شخصًا يملك/u);
});

test('parses multiple questions from one captured lesson', () => {
  const source = [
    'ما هو دور المال؟',
    'اختار إجابة واحدة!',
    'A',
    'الخيار الأول',
    'B',
    'الخيار الثاني',
    'C',
    'الخيار الثالث',
    'D',
    'الخيار الرابع',
    'ورّيني تلميح',
    'ما الذي يدعم قيمة الأوراق النقدية؟',
    'اختر إجابة واحدة!',
    'A',
    'خيار أول',
    'B',
    'خيار ثان',
    'C',
    'خيار ثالث',
    'D',
    'خيار رابع',
    'راجع إجابتي'
  ].join('\n');

  assert.equal(parseSprixQuestions(source).length, 2);
});

test('ignores incomplete and non-question content', () => {
  const source = [
    'نص الدرس من دون سؤال.',
    'اختار إجابة واحدة!',
    'A',
    'خيار واحد فقط',
    'ورّيني تلميح'
  ].join('\n');

  assert.deepEqual(parseSprixQuestions(source), []);
});

test('normalizes Arabic diacritics and letter variants for search', () => {
  assert.equal(normalizeSprixText('إِدَارَةُ الْمَالِ'), 'ادارة المال');
});


test('parses options when labels and option text share a line', () => {
  const source = [
    'ما الذي يدعم قيمة الأوراق النقدية الحديثة؟',
    'اختار إجابة واحدة!',
    'A جودة الورق الخاص المستخدم والتقنيات المتطورة لمنع التزييف',
    'B كمية المعادن النادرة مثل الذهب والفضة الموجودة في مادة الورقة النقدية',
    'C ضمان الحكومة وثقة المجتمع المشتركة بأن يمكن استخدامها لشراء الأشياء',
    'D حجم شركات الطباعة وسجلّها في إنتاج الأوراق النقدية وإدارتها',
    'ورّيني تلميح (فاضل 1)',
    'راجع إجابتي'
  ].join('\n');

  const questions = parseSprixQuestions(source);
  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].choices.map(choice => choice.label), ['A', 'B', 'C', 'D']);
  assert.match(questions[0].choices[2].text, /ثقة المجتمع/u);
});


test('rejects a partial clipboard selection by default', () => {
  assert.throws(
    () => captureSprixLesson({ title: 'كيف نشأ المال', unit: 'أساسيات المال والتمويل', rawText: 'نص قصير منسوخ من جزء صغير في الصفحة'.repeat(3) }),
    /Only \d+ characters were read from the clipboard/u
  );
});
