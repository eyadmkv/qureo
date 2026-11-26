import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeHtmlEntities,
  htmlToText,
  extractPythonAnswerPairs,
  extractPythonLevelUrls,
  extractPythonLessonUrls
} from '../src/pythonAnswerGuide.js';

test('decodes named, decimal and hexadecimal HTML entities', () => {
  assert.equal(decodeHtmlEntities('&quot;Python&#34; &amp; &#x3C;code&#x3E;'), '"Python" & <code>');
  assert.equal(decodeHtmlEntities('&#x110000;'), '&#x110000;');
});

test('extracts multiple question and answer pairs from one lesson page', () => {
  const body = [
    'مقدمة',
    'السؤال 1',
    'ما ناتج الكود التالي؟',
    'Hello',
    'نسخ الإجابة ⧉',
    'السؤال 2',
    'ما اسم الدالة المستخدمة للطباعة؟',
    'print()',
    'نسخ الإجابة ⧉'
  ].join('\n');

  assert.deepEqual(extractPythonAnswerPairs(body), [
    { question_number: 1, question: 'ما ناتج الكود التالي؟', answer: 'Hello' },
    { question_number: 2, question: 'ما اسم الدالة المستخدمة للطباعة؟', answer: 'print()' }
  ]);
});

test('extracts only Python level links from the index', () => {
  const html = [
    '<a href="/qureo-python/l02/">Level 2</a>',
    '<a href="/qureo-python/l01/">Level 1</a>',
    '<a href="/qureo-js/l01/">JavaScript</a>',
    '<a href="https://example.com/qureo-python/l03/">External</a>'
  ].join('');

  assert.deepEqual(extractPythonLevelUrls(html), [
    'https://answers.studentplatformeg.online/qureo-python/l01/',
    'https://answers.studentplatformeg.online/qureo-python/l02/'
  ]);
});

test('extracts lesson links from the selected level only', () => {
  const html = [
    '<a href="py-l01-s02/">Lesson 2</a>',
    '<a href="py-l01-s01/">Lesson 1</a>',
    '<a href="/qureo-python/l02/py-l02-s01/">Other level</a>',
    '<a href="https://example.com/qureo-python/l01/fake/">External</a>'
  ].join('');

  assert.deepEqual(
    extractPythonLessonUrls(html, 'https://answers.studentplatformeg.online/qureo-python/l01/'),
    [
      'https://answers.studentplatformeg.online/qureo-python/l01/py-l01-s01/',
      'https://answers.studentplatformeg.online/qureo-python/l01/py-l01-s02/'
    ]
  );
});

test('searches the downloaded Python guide by question and answer text', async () => {
  const { searchPythonAnswers } = await import('../src/pythonAnswerGuide.js');
  const rows = [
    {
      question: 'ما ناتج البرنامج؟',
      answer: 'Hello',
      lesson_title: 'وحدة التحكم',
      source_url: 'https://answers.studentplatformeg.online/qureo-python/l01/py-l01-s01/'
    },
    {
      question: 'ما وظيفة المتغير؟',
      answer: 'تخزين قيمة',
      lesson_title: 'المتغيرات',
      source_url: 'https://answers.studentplatformeg.online/qureo-python/l03/py-l03-s01/'
    }
  ];

  const results = searchPythonAnswers(rows, 'وحدة التحكم', 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].question, 'ما ناتج البرنامج؟');
  assert.equal(results[0].answer, 'Hello');
});


test('extracts answers from the public guide HTML layout', () => {
  const html = `
    <main>
      <p>01</p>
      <p>السؤال 1</p>
      <h2>كم عدد لغات البرمجة في العالم؟</h2>
      <p>أكثر من 100 نوع.</p>
      <button>نسخ الإجابة ⧉</button>
    </main>
  `;
  const body = htmlToText(html);

  assert.deepEqual(extractPythonAnswerPairs(body), [
    { question_number: 1, question: 'كم عدد لغات البرمجة في العالم؟', answer: 'أكثر من 100 نوع.' }
  ]);
});

test('recognizes Arabic-Indic question numbers and invisible direction marks', () => {
  const body = [
    '\u200fالسؤال ٢',
    'ما وظيفة الدالة؟',
    'print()',
    'نسخ الإجابة ⧉'
  ].join('\n');

  assert.deepEqual(extractPythonAnswerPairs(body), [
    { question_number: 2, question: 'ما وظيفة الدالة؟', answer: 'print()' }
  ]);
});
