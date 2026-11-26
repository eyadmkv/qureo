import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPythonAssessmentAnswers } from '../src/pythonAutoAnswers.js';

const levelTwoAnswers = [
  {
    id: 'py-l02-s05-q1',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 1,
    question: 'احسب 50+100.',
    answer: 'print(50 + 100)'
  },
  {
    id: 'py-l02-s05-q2',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 2,
    question: 'ما رمز القسمة في بايثون؟',
    answer: '/'
  },
  {
    id: 'py-l02-s05-q3',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 3,
    question: 'احسب 19+40.',
    answer: 'print(19 + 40)'
  },
  {
    id: 'py-l02-s05-q4',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 4,
    question: 'اكتب عملية الطرح كما وردت في الإجابة.',
    answer: 'print(7 - 2)'
  },
  {
    id: 'py-l02-s05-q5',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 5,
    question: 'اكتب عملية القسمة كما وردت في الإجابة.',
    answer: 'print(15 / 5)'
  },
  {
    id: 'py-l02-s05-q6',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 6,
    question: 'اطبع جملة تحسب اليوم قبل 7 أيام من اليوم 17.',
    answer: 'print("Today is the 17th. 7 days ago was the " + str(17 - 7) + "th.")'
  },
  {
    id: 'py-l02-s05-q7',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 7,
    question: 'اطبع ناتج 2*5 داخل جملة.',
    answer: 'print("The answer is " + str(2 * 5))'
  },
  {
    id: 'py-l02-s05-q8',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 8,
    question: 'ما نوع "50+30"؟',
    answer: 'نص (String).\nالكود:\nprint("50+30")'
  },
  {
    id: 'py-l02-s05-q9',
    level_id: '02',
    lesson_id: 'py-l02-s05',
    lesson_title: 'مراجعة المستوى',
    question_number: 9,
    question: 'اعرض نوع "1".',
    answer: 'print(type("1"))'
  }
];

const chapterTwoQuestions = [
  {
    question: { id: 511002010, type: 'choice', content: 'اختر البرنامج الصحيح لطباعة نتيجة حساب "50+100" في وحدة التحكم.' },
    choices: [
      { id: 5110020101, content: '[[bdi]]print(50 + 100)[[/bdi]]' },
      { id: 5110020104, content: '[[bdi]]print("50" + 100)[[/bdi]]' },
      { id: 5110020102, content: '[[bdi]]print("50 + 100")[[/bdi]]' },
      { id: 5110020103, content: '[[bdi]]print("50" + "100")[[/bdi]]' }
    ]
  },
  {
    question: { id: 511002020, type: 'choice', content: 'اختر رمز القسمة الصحيح الذي يستخدم في البرنامج.' },
    choices: [
      { id: 5110020202, content: '÷' },
      { id: 5110020201, content: '/' },
      { id: 5110020203, content: '-' },
      { id: 5110020204, content: '*' }
    ]
  },
  {
    question: { id: 511002030, type: 'description', content: 'اجعل الكمبيوتر يحسب "19+40" ويطبع نتيجة الحساب في وحدة التحكم.' },
    choices: []
  },
  {
    question: { id: 511002040, type: 'description', content: 'اجعل الكمبيوتر يحسب "7-2" ويطبع نتيجة الحساب في وحدة التحكم.' },
    choices: []
  },
  {
    question: { id: 511002050, type: 'description', content: 'اجعل الكمبيوتر يحسب "15÷5" ويطبع نتيجة الحساب في وحدة التحكم.' },
    choices: []
  },
  {
    question: { id: 511002060, type: 'choice', content: 'اختر البرنامج الصحيح لطباعة "Today is the 17th. 7 days ago was the 10th." في وحدة التحكم.' },
    choices: [
      { id: 5110020604, content: 'print("Today is the 17th. 7 days ago was the " + "17 - 7" + "th.")' },
      { id: 5110020603, content: 'print("Today is the 17th. 7 days ago was the (17 - 7)th.")' },
      { id: 5110020601, content: 'print("Today is the 17th. 7 days ago was the " + str(17 - 7) + "th.")' },
      { id: 5110020602, content: 'print("Today is the 17th. 7 days ago was the + 17 - 7 + th.")' }
    ]
  },
  {
    question: { id: 511002070, type: 'description', content: 'اجعل الكمبيوتر يحسب "2*5" ويطبع "The answer is 10" في وحدة التحكم.' },
    choices: []
  },
  {
    question: { id: 511002080, type: 'choice', content: 'اختر نوع البيانات الصحيح لما يلي. print("50+30")' },
    choices: [
      { id: 5110020803, content: 'لا شيء مما سبق' },
      { id: 5110020802, content: 'نوع رقمي' },
      { id: 5110020801, content: 'نوع السلسلة النصية' }
    ]
  },
  {
    question: { id: 511002090, type: 'choice', content: 'اختر البرنامج الذي يطبع "<class \'str\'>" بشكل صحيح.' },
    choices: [
      { id: 5110020902, content: 'print(type(1))' },
      { id: 5110020901, content: 'print(type("1"))' },
      { id: 5110020904, content: 'print(string("1"))' },
      { id: 5110020903, content: 'print(str("1"))' }
    ]
  }
];

test('maps the complete Python level 2 review to live QUREO assessment IDs and types', () => {
  const result = matchPythonAssessmentAnswers(chapterTwoQuestions, levelTwoAnswers, '02');

  assert.equal(result.matches.length, 9);
  assert.deepEqual(result.unmatched, []);
  assert.deepEqual(result.answers, {
    '511002010': { type: 'choice', choice_id: 5110020101 },
    '511002020': { type: 'choice', choice_id: 5110020201 },
    '511002030': { type: 'description', answer_code: 'print(19 + 40)' },
    '511002040': { type: 'description', answer_code: 'print(7 - 2)' },
    '511002050': { type: 'description', answer_code: 'print(15 / 5)' },
    '511002060': { type: 'choice', choice_id: 5110020601 },
    '511002070': { type: 'description', answer_code: 'print("The answer is " + str(2 * 5))' },
    '511002080': { type: 'choice', choice_id: 5110020801 },
    '511002090': { type: 'choice', choice_id: 5110020901 }
  });
  assert.ok(result.matches.every(match => match.strategy === 'review-order'));
});

test('does not invent a choice ID when the guide answer cannot match a visible option', () => {
  const result = matchPythonAssessmentAnswers([{
    question: { id: 511003010, type: 'choice', content: 'اختر نوع البيانات' },
    choices: [
      { id: 5110030101, content: 'خيار أ' },
      { id: 5110030102, content: 'خيار ب' }
    ]
  }], [{
    level_id: '03',
    lesson_id: 'py-l03-s03',
    lesson_title: 'مراجعة المستوى',
    question_number: 1,
    question: 'اختر نوع البيانات',
    answer: 'إجابة غير موجودة ضمن الاختيارات'
  }], '03');

  assert.deepEqual(result.answers, {});
  assert.equal(result.unmatched[0].question_id, '511003010');
});



test('resolves the Python multiplication operator from the live question and exported choices', () => {
  const result = matchPythonAssessmentAnswers([{
    question: {
      id: 511004050,
      type: 'choice',
      content: 'اختر رمز الضرب الصحيح المستخدم في البرنامج.'
    },
    choices: [
      { id: 5110040504, content: '/' },
      { id: 5110040502, content: '+' },
      { id: 5110040503, content: '-' },
      { id: 5110040501, content: '*' }
    ]
  }], [{
    id: 'py-l04-s02-q5',
    level_id: '04',
    lesson_id: 'py-l04-s02',
    lesson_title: 'مراجعة المستوى',
    question_number: 5,
    question: 'سؤال عن رمز الضرب',
    answer: 'عملية الضرب'
  }], '04');

  assert.deepEqual(result.answers, {
    '511004050': { type: 'choice', choice_id: 5110040501 }
  });
  assert.deepEqual(result.unmatched, []);
});

test('matches symbol-only choices when the guide wraps the answer in a Markdown heading', () => {
  const result = matchPythonAssessmentAnswers([{
    question: {
      id: 511004050,
      type: 'choice',
      content: 'اختر رمز الضرب الصحيح في لغة Python.'
    },
    choices: [
      { id: 5110040504, content: '/' },
      { id: 5110040502, content: '+' },
      { id: 5110040503, content: '-' },
      { id: 5110040501, content: '*' }
    ]
  }], [{
    id: 'py-l04-s02-q5',
    level_id: '04',
    lesson_id: 'py-l04-s02',
    lesson_title: 'مراجعة المستوى',
    question_number: 5,
    question: 'ما رمز الضرب في لغة Python؟',
    answer: '## *'
  }], '04');

  assert.deepEqual(result.answers, {
    '511004050': { type: 'choice', choice_id: 5110040501 }
  });
  assert.deepEqual(result.unmatched, []);
});


test('resolves all five Chapter 6 review answers from live questions and guide order', () => {
  const questions = [
    {
      question: {
        id: 511006010,
        type: 'choice',
        content: 'اختر الشكل الصحيح للبرنامج: إذا كان ~ فافعل [[bdi]]A[[/bdi]]، وإلا فافعل [[bdi]]B.[[/bdi]]'
      },
      choices: [
        { id: 5110060102, content: '[[bdi]]if condition: else:\n    A\n    B[[/bdi]]' },
        { id: 5110060103, content: '[[bdi]]else condition:\n    A\nif:\n    B[[/bdi]]' },
        { id: 5110060104, content: '[[bdi]]else:\n    B\nif condition:\n    A[[/bdi]]' },
        { id: 5110060101, content: '[[bdi]]if condition:\n    A\nelse:\n    B[[/bdi]]' }
      ]
    },
    {
      question: {
        id: 511006020,
        type: 'description',
        content: 'أنشئ برنامجا كما يلي: num = 5 ثم إذا كان num يساوي 10 اطبع Win وإلا اطبع No prize.'
      },
      choices: []
    },
    {
      question: {
        id: 511006030,
        type: 'choice',
        content: 'اختر البرنامج الذي يحتوي على التعبير الشرطي "قيمة المتغير [[bdi]]num[[/bdi]] تساوي 80 أو أقل".'
      },
      choices: [
        { id: 5110060301, content: '[[bdi]]num <= 80[[/bdi]]' },
        { id: 5110060304, content: 'num < 80' },
        { id: 5110060303, content: 'num > 80' },
        { id: 5110060302, content: '[[bdi]]num == 80[[/bdi]]' }
      ]
    },
    {
      question: {
        id: 511006040,
        type: 'choice',
        content: 'اختر البرنامج الذي يحتوي على التعبير الشرطي "قيمة المتغير [[bdi]]num[[/bdi]] أكبر من 30".'
      },
      choices: [
        { id: 5110060403, content: 'num < 30' },
        { id: 5110060401, content: 'num > 30' },
        { id: 5110060404, content: '[[bdi]]num >= 30[[/bdi]]' },
        { id: 5110060402, content: '[[bdi]]num == 30[[/bdi]]' }
      ]
    },
    {
      question: {
        id: 511006050,
        type: 'description',
        content: 'إذا كانت score تساوي 60 أو أكبر، أدخل التعبير الشرطي في المربع الملون.'
      },
      choices: []
    }
  ];

  const guide = [1, 2, 3, 4, 5].map((question_number) => ({
    id: 'py-l06-s06-q' + question_number,
    level_id: '06',
    lesson_id: 'py-l06-s06',
    lesson_title: 'مراجعة المستوى',
    question_number,
    question: 'دليل إجابة سؤال مراجعة ' + question_number,
    answer: [
      'لا توجد إجابة قابلة للمطابقة في الدليل',
      'num = 5\nif num == 10:\n    print("Win")\nelse:\n    print("No prize")',
      'تعذر استخراج الإجابة من الدليل',
      'تعذر استخراج الإجابة من الدليل',
      'score >= 60'
    ][question_number - 1]
  }));

  const result = matchPythonAssessmentAnswers(questions, guide, '06');

  assert.equal(result.matches.length, 5);
  assert.deepEqual(result.answers, {
    '511006010': { type: 'choice', choice_id: 5110060101 },
    '511006020': {
      type: 'description',
      answer_code: 'num = 5\nif num == 10:\n    print("Win")\nelse:\n    print("No prize")'
    },
    '511006030': { type: 'choice', choice_id: 5110060301 },
    '511006040': { type: 'choice', choice_id: 5110060401 },
    '511006050': { type: 'description', answer_code: 'score >= 60' }
  });
  assert.deepEqual(result.unmatched, []);
  assert.ok(result.matches.every(match => match.strategy === 'review-order'));
});


test('does not guess when a prompt-derived Python choice is ambiguous', () => {
  const result = matchPythonAssessmentAnswers([{
    question: {
      id: 511006099,
      type: 'choice',
      content: 'اختر البرنامج الذي يحتوي على التعبير الشرطي "قيمة المتغير num أكبر من 30".'
    },
    choices: [
      { id: 5110060991, content: 'num > 30' },
      { id: 5110060992, content: 'num > 30' },
      { id: 5110060993, content: 'num < 30' }
    ]
  }], [{
    id: 'py-l06-s06-q1',
    level_id: '06',
    lesson_id: 'py-l06-s06',
    lesson_title: 'مراجعة المستوى',
    question_number: 1,
    question: 'مقارنة رقمية',
    answer: 'لا توجد إجابة مطابقة'
  }], '06');

  assert.deepEqual(result.answers, {});
  assert.equal(result.unmatched[0].question_id, '511006099');
});

test('extracts a comparison-only answer for a Python fill-in description', () => {
  const result = matchPythonAssessmentAnswers([{
    question: {
      id: 511006050,
      type: 'description',
      content: 'أدخل التعبير الشرطي الذي يجعل score أكبر من أو يساوي 60.'
    },
    choices: []
  }], [{
    id: 'py-l06-s06-q5',
    level_id: '06',
    lesson_id: 'py-l06-s06',
    lesson_title: 'مراجعة المستوى',
    question_number: 5,
    question: 'أدخل التعبير الشرطي',
    answer: 'score >= 60'
  }], '06');

  assert.deepEqual(result.answers, {
    '511006050': { type: 'description', answer_code: 'score >= 60' }
  });
  assert.deepEqual(result.unmatched, []);
});

test('matches the Chapter 7 elif structure despite title-case keyword in the public guide', () => {
  const result = matchPythonAssessmentAnswers([{
    question: {
      id: 511007010,
      type: 'choice',
      content: 'اختر الشكل الصحيح لجملة if و elif.'
    },
    choices: [
      { id: 5110070101, content: 'if condition:\n    A\nelif conditions:\n    B' },
      { id: 5110070102, content: 'if condition:\n    A\nelse if conditions:\n    B' },
      { id: 5110070103, content: 'if condition:\n    A\nelif:\n    B' },
      { id: 5110070104, content: 'elif condition:\n    A\nif condition:\n    B' }
    ]
  }], [{
    id: 'py-l07-s04-q1',
    level_id: '07',
    lesson_id: 'py-l07-s04',
    lesson_title: 'مراجعة المستوى',
    question_number: 1,
    question: 'اكتب شكل if وelif.',
    answer: 'If condition:\n    A\nelif conditions:\n    B'
  }], '07');

  assert.deepEqual(result.answers, {
    '511007010': { type: 'choice', choice_id: 5110070101 }
  });
  assert.deepEqual(result.unmatched, []);
});

test('normalizes title-case Python keywords before submitting description answers', () => {
  const result = matchPythonAssessmentAnswers([{
    question: { id: 511007020, type: 'description', content: 'اكتب برنامج if و elif.' },
    choices: []
  }], [{
    id: 'py-l07-s04-q2',
    level_id: '07',
    lesson_id: 'py-l07-s04',
    lesson_title: 'مراجعة المستوى',
    question_number: 2,
    question: 'اكتب البرنامج.',
    answer: 'If num == 1:\n    print("One")\nelif num == 2:\n    print("Two")'
  }], '07');

  assert.deepEqual(result.answers, {
    '511007020': {
      type: 'description',
      answer_code: 'if num == 1:\n    print("One")\nelif num == 2:\n    print("Two")'
    }
  });
  assert.deepEqual(result.unmatched, []);
});