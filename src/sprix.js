import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { DATA_DIR } from './paths.js';

const SPRIX_DIR = path.join(DATA_DIR, 'sprix');
const STORE_PATH = path.join(SPRIX_DIR, 'study.json');
const SUBJECT_URL = 'https://egy.app.spx-learning-square.com/subjects/7/curriculum';

export const SPRIX_CURRICULUM = Object.freeze([
  { sequence: 1, title: 'أساسيات المال والتمويل', elements: 28 },
  { sequence: 2, title: 'أساسيات الأعمال والاقتصاد', elements: 23 },
  { sequence: 3, title: 'التمويل الشخصي والائتمان واتخاذ القرار', elements: 23 },
  { sequence: 4, title: 'ريادة الأعمال', elements: 23 },
  { sequence: 5, title: 'أساسيات الاستثمار وإدارة الثروات', elements: 23 },
  { sequence: 6, title: 'الذكاء الاصطناعي والتمويل ومستقبل الأعمال', elements: 14 }
]);

const MIN_LESSON_CHARACTERS = 500;
const ACTION_LINE = /^(?:ورّيني تلميح|وريني تلميح|راجع إجابتي|المحاولات السابقة|التالي|ممتاز!?|تمام!?|خلصت ده قبل كده)(?:\s*\(.*\))?$/u;
const QUESTION_MARKER = /^(?:اختار|اختر|اختاري)\s+(?:إجابة|الاجابة|الإجابة)/u;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function normalizeSprixText(value = '') {
  return String(value)
    .toLocaleLowerCase('ar')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function parseOptionLine(line) {
  const match = String(line).trim().match(/^([A-D])(?:[.)،:]|[\s-]+)?(.*)$/iu);
  if (!match) return null;
  return { label: match[1].toUpperCase(), text: (match[2] || '').trim() };
}

export function parseSprixQuestions(rawText) {
  const lines = String(rawText)
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00a0/gu, ' ')
    .split('\n')
    .map(line => line.trim());
  const parsed = [];

  for (let index = 0; index < lines.length; index++) {
    if (!QUESTION_MARKER.test(lines[index])) continue;

    let promptIndex = index - 1;
    while (promptIndex >= 0 && !lines[promptIndex]) promptIndex--;
    const prompt = promptIndex >= 0 ? lines[promptIndex] : '';
    if (prompt.length < 5) continue;

    let firstOption = index + 1;
    while (firstOption < lines.length && firstOption <= index + 8 && !parseOptionLine(lines[firstOption])) firstOption++;
    if (!parseOptionLine(lines[firstOption] || '')) continue;

    const choices = [];
    let current = null;
    let cursor = firstOption;

    for (; cursor < lines.length && cursor < firstOption + 100; cursor++) {
      const line = lines[cursor];
      if (ACTION_LINE.test(line) || QUESTION_MARKER.test(line)) break;

      const option = parseOptionLine(line);
      const expected = String.fromCharCode(65 + choices.length);
      if (option && option.label === expected) {
        if (current) choices.push({ label: current.label, text: current.text.join('\n').trim() });
        current = { label: option.label, text: option.text ? [option.text] : [] };
        continue;
      }

      if (option && option.label !== expected) {
        current = null;
        break;
      }

      if (current && line) current.text.push(line);
    }

    if (current) choices.push({ label: current.label, text: current.text.join('\n').trim() });
    if (choices.length !== 4 || choices.some(choice => !choice.text)) continue;

    const id = 'spx_' + digest(normalizeSprixText(prompt) + '|' +
      choices.map(choice => normalizeSprixText(choice.text)).join('|'));
    if (!parsed.some(question => question.id === id)) {
      parsed.push({ id, prompt, choices, correctOption: null, explanation: '' });
    }

    index = cursor - 1;
  }

  return parsed;
}

function emptyStore() {
  return {
    format: 'qureo-sprix-study',
    schema_version: 1,
    subject: {
      id: '7',
      title: 'الثقافة المالية',
      grade: 'تانية بكالوريا',
      url: SUBJECT_URL
    },
    updated_at: null,
    captures: [],
    questions: []
  };
}

export function loadSprixStore() {
  if (!fs.existsSync(STORE_PATH)) return emptyStore();
  let store;
  try {
    store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    throw new Error('SPRIX study data is invalid JSON: ' + STORE_PATH);
  }
  if (store?.format !== 'qureo-sprix-study' || store?.schema_version !== 1 ||
      !Array.isArray(store.captures) || !Array.isArray(store.questions)) {
    throw new Error('SPRIX study data uses an unsupported format. Move data/sprix/study.json aside and capture the lesson again.');
  }
  return store;
}

export function saveSprixStore(store) {
  fs.mkdirSync(SPRIX_DIR, { recursive: true });
  store.updated_at = new Date().toISOString();
  const temporaryPath = STORE_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, STORE_PATH);
}

export function captureSprixLesson({ title, unit = '', rawText, source = 'clipboard', allowShort = false }) {
  const cleanTitle = String(title || '').trim();
  const body = String(rawText || '').trim();
  if (!cleanTitle) throw new Error('Lesson title is required. Use --title "اسم الدرس".');
  if (body.length < 40) {
    throw new Error('Captured text is too short. Copy the lesson content, then run the capture command again.');
  }
  if (body.length < MIN_LESSON_CHARACTERS && !allowShort) {
    throw new Error(
      'Only ' + body.length + ' characters were read from the clipboard. This looks like a partial selection, not a complete SPRIX lesson. ' +
      'Click inside the lesson content, press Ctrl+A then Ctrl+C, and verify with "qureo sprix clipboard". ' +
      'Use --allow-short only when you intentionally want to save a short excerpt.'
    );
  }
  if (body.length > 2_000_000) throw new Error('Captured lesson exceeds the 2 MB limit.');

  const store = loadSprixStore();
  const normalizedUnit = normalizeSprixText(unit);
  const normalizedTitle = normalizeSprixText(cleanTitle);
  const captureId = 'lesson_' + digest(normalizedUnit + '|' + normalizedTitle);
  const questions = parseSprixQuestions(body);
  const existingCapture = store.captures.findIndex(item =>
    item.id === captureId ||
    (normalizeSprixText(item.title) === normalizedTitle && normalizeSprixText(item.unit) === normalizedUnit)
  );
  const previousCapture = existingCapture >= 0 ? store.captures[existingCapture] : null;
  const capture = {
    id: captureId,
    title: cleanTitle,
    unit: String(unit || '').trim(),
    source,
    source_url: SUBJECT_URL,
    captured_at: new Date().toISOString(),
    character_count: body.length,
    question_ids: questions.map(question => question.id),
    raw_text: body
  };

  if (existingCapture >= 0) store.captures[existingCapture] = capture;
  else store.captures.push(capture);

  const currentQuestionIds = new Set(questions.map(question => question.id));
  const retainedByOtherCapture = new Set(store.captures
    .filter(item => item.id !== captureId)
    .flatMap(item => item.question_ids || []));
  if (previousCapture) {
    store.questions = store.questions.filter(question =>
      !previousCapture.question_ids.includes(question.id) ||
      currentQuestionIds.has(question.id) ||
      retainedByOtherCapture.has(question.id)
    );
  }

  for (const question of questions) {
    const existing = store.questions.find(item => item.id === question.id);
    if (existing) {
      existing.prompt = question.prompt;
      existing.choices = question.choices;
      existing.capture_id = captureId;
      existing.lesson_title = cleanTitle;
      existing.unit = capture.unit;
    } else {
      store.questions.push({
        ...question,
        capture_id: captureId,
        lesson_title: cleanTitle,
        unit: capture.unit,
        captured_at: capture.captured_at
      });
    }
  }

  saveSprixStore(store);
  return { capture, questions, store };
}

function readClipboard() {
  if (process.platform !== 'win32') throw new Error('Clipboard capture requires Windows PowerShell. Use --file <path> on this platform.');
  const result = spawnSync('pwsh', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard -Raw'
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || 'Could not read the Windows clipboard.').trim());
  return result.stdout.replace(/^\uFEFF/u, '');
}

function inspectClipboard() {
  const text = readClipboard();
  const lines = text.split(/\r?\n/u).filter(line => line.trim());
  const questions = parseSprixQuestions(text);
  console.log('Clipboard characters: ' + text.length.toLocaleString('en-US'));
  console.log('Non-empty lines: ' + lines.length.toLocaleString('en-US'));
  console.log('Questions detected: ' + questions.length);
  console.log('Preview (first 700 characters):');
  console.log(text.slice(0, 700) || '(clipboard is empty)');
  if (text.length < MIN_LESSON_CHARACTERS) {
    console.log('\nClipboard looks too short. Click inside the lesson dialogue, press Ctrl+A, then Ctrl+C.');
  }
}

function findQuestion(store, id) {
  return store.questions.find(question => question.id === id);
}

function printQuestion(question, includeKey = true) {
  console.log('\n' + question.id + ' | ' + (question.lesson_title || 'درس غير محدد'));
  if (question.unit) console.log('الوحدة: ' + question.unit);
  console.log(question.prompt);
  for (const choice of question.choices) console.log('  ' + choice.label + '. ' + choice.text);
  if (includeKey && question.correctOption) {
    console.log('\nالإجابة المرجعية المحفوظة: ' + question.correctOption);
    if (question.explanation) console.log('التفسير: ' + question.explanation);
  }
}

export function registerSprixCommands(program) {
  const sprix = program.command('sprix').description('Local study tools for the SPRIX financial-literacy course');

  sprix.command('curriculum')
    .description('List the six units in the second-year Baccalaureate financial-literacy course')
    .action(() => {
      console.log('الثقافة المالية | تانية بكالوريا');
      console.log(SUBJECT_URL);
      console.log('');
      for (const unit of SPRIX_CURRICULUM) {
        console.log(unit.sequence + '. ' + unit.title + ' | ' + unit.elements + ' عنصر');
      }
      console.log('\nالإجمالي: ' + SPRIX_CURRICULUM.reduce((sum, unit) => sum + unit.elements, 0) + ' عنصر');
    });

  sprix.command('status')
    .description('Show locally captured SPRIX lessons and questions')
    .action(() => {
      const store = loadSprixStore();
      const keyed = store.questions.filter(question => question.correctOption).length;
      console.log('Course: ' + store.subject.title + ' | ' + store.subject.grade);
      console.log('Captured lessons: ' + store.captures.length);
      console.log('Captured questions: ' + store.questions.length);
      console.log('Questions with your saved reference keys: ' + keyed);
      console.log('Local store: ' + STORE_PATH);
      console.log('Platform submissions: none');
    });

  sprix.command('clipboard')
    .description('Inspect the current Windows clipboard before capturing a lesson')
    .action(inspectClipboard);

  sprix.command('capture')
    .description('Capture visible lesson text from the clipboard or a UTF-8 text file')
    .requiredOption('--title <title>', 'Lesson title, for example "كيف نشأ المال"')
    .option('--unit <unit>', 'Unit title')
    .option('--file <path>', 'Read lesson text from a UTF-8 text file instead of the clipboard')
    .option('--allow-short', 'Allow capturing fewer than 500 characters as an excerpt')
    .action(options => {
      const source = options.file ? path.resolve(options.file) : 'clipboard';
      if (options.file && !fs.existsSync(source)) throw new Error('Input file not found: ' + source);
      const rawText = options.file ? fs.readFileSync(source, 'utf8') : readClipboard();
      const result = captureSprixLesson({
        title: options.title,
        unit: options.unit || '',
        rawText,
        source: options.file ? source : 'clipboard',
        allowShort: Boolean(options.allowShort)
      });
      console.log('Captured: ' + result.capture.title);
      console.log('Unit: ' + (result.capture.unit || '(not set)'));
      console.log('Characters: ' + result.capture.character_count.toLocaleString('en-US'));
      console.log('Questions detected: ' + result.questions.length);
      if (result.capture.character_count < MIN_LESSON_CHARACTERS) {
        console.log('Warning: this is a short excerpt and may not contain the lesson questions.');
      }
      console.log('Saved locally: ' + STORE_PATH);
      if (!result.questions.length) console.log('No four-option questions matched the current parser. The full lesson text was still saved.');
    });

  sprix.command('lessons')
    .description('List captured SPRIX lessons')
    .action(() => {
      const store = loadSprixStore();
      if (!store.captures.length) return console.log('No lessons captured yet. Open a lesson, copy its visible text, then run qureo sprix capture.');
      for (const lesson of [...store.captures].reverse()) {
        console.log(lesson.id + ' | ' + (lesson.unit || 'بدون وحدة') + ' | ' + lesson.title + ' | ' + lesson.question_ids.length + ' question(s)');
      }
    });

  sprix.command('lesson <captureId>')
    .description('Display the locally captured text of a lesson')
    .action(captureId => {
      const store = loadSprixStore();
      const lesson = store.captures.find(item => item.id === captureId);
      if (!lesson) throw new Error('Captured lesson not found: ' + captureId);
      console.log(lesson.title + (lesson.unit ? ' | ' + lesson.unit : ''));
      console.log('Captured: ' + lesson.captured_at);
      console.log('Source: ' + lesson.source_url);
      console.log('\n' + lesson.raw_text);
    });

  sprix.command('questions')
    .description('List questions extracted from captured lessons')
    .option('--unit <unit>', 'Filter by unit title')
    .action(options => {
      const store = loadSprixStore();
      const unitQuery = normalizeSprixText(options.unit || '');
      const questions = store.questions.filter(question => !unitQuery || normalizeSprixText(question.unit).includes(unitQuery));
      if (!questions.length) return console.log('No matching questions. Capture a lesson first with qureo sprix capture.');
      for (const question of questions) {
        console.log('\n' + question.id + ' | ' + question.lesson_title + ' | ' + (question.correctOption ? 'key ' + question.correctOption : 'no key'));
        console.log(question.prompt);
        for (const choice of question.choices) console.log('  ' + choice.label + '. ' + choice.text);
      }
    });

  sprix.command('question <questionId>')
    .description('Display a captured multiple-choice question')
    .action(questionId => {
      const question = findQuestion(loadSprixStore(), questionId);
      if (!question) throw new Error('SPRIX question not found: ' + questionId);
      printQuestion(question);
    });

  sprix.command('key <questionId> <option>')
    .description('Save your own reference answer for local practice (A, B, C or D)')
    .option('--explanation <text>', 'Explanation for the saved answer', '')
    .action((questionId, option, options) => {
      const normalizedOption = String(option).toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(normalizedOption)) throw new Error('Option must be A, B, C or D.');
      const store = loadSprixStore();
      const question = findQuestion(store, questionId);
      if (!question) throw new Error('SPRIX question not found: ' + questionId);
      question.correctOption = normalizedOption;
      if (options.explanation) question.explanation = options.explanation;
      saveSprixStore(store);
      console.log('Saved local reference key ' + normalizedOption + ' for ' + questionId + '.');
      console.log('This is stored only in data/sprix/study.json. Nothing was submitted to SPRIX.');
    });

  sprix.command('practice [questionId]')
    .description('Practice questions with reference keys that you have saved locally')
    .action(async questionId => {
      if (!stdin.isTTY) throw new Error('Practice mode requires an interactive PowerShell terminal.');
      const store = loadSprixStore();
      const questions = questionId
        ? [findQuestion(store, questionId)].filter(Boolean)
        : store.questions.filter(question => question.correctOption);
      if (!questions.length) {
        throw new Error(questionId
          ? 'Question not found or no local reference key exists for ' + questionId + '.'
          : 'No reference keys saved yet. Save one with qureo sprix key <questionId> <A|B|C|D>.');
      }
      const rl = readline.createInterface({ input: stdin, output: stdout });
      let correct = 0;
      let answered = 0;
      try {
        for (const question of questions) {
          printQuestion(question, false);
          const response = (await rl.question('\nYour answer (A-D, S to skip, Q to quit): ')).trim().toUpperCase();
          if (response === 'Q') break;
          if (response === 'S' || !response) continue;
          if (!['A', 'B', 'C', 'D'].includes(response)) {
            console.log('Enter A, B, C, D, S or Q.');
            continue;
          }
          answered++;
          const accepted = response === question.correctOption;
          if (accepted) correct++;
          console.log(accepted ? 'Correct.' : 'Reference answer: ' + question.correctOption + '.');
          if (question.explanation) console.log(question.explanation);
        }
      } finally {
        rl.close();
      }
      console.log('\nPractice result: ' + correct + '/' + answered + ' correct.');
      console.log('This practice session did not interact with your SPRIX account.');
    });

  sprix.command('search <query>')
    .description('Search your locally captured lesson text and questions')
    .action(query => {
      const store = loadSprixStore();
      const needle = normalizeSprixText(query);
      if (!needle) throw new Error('Search query cannot be empty.');
      let found = 0;
      for (const lesson of store.captures) {
        if (normalizeSprixText(lesson.title + ' ' + lesson.unit + ' ' + lesson.raw_text).includes(needle)) {
          found++;
          console.log('\n[LESSON] ' + lesson.title + ' | ' + (lesson.unit || 'بدون وحدة') + ' | ' + lesson.id);
          const at = lesson.raw_text.toLocaleLowerCase('ar').indexOf(String(query).toLocaleLowerCase('ar'));
          console.log(lesson.raw_text.slice(Math.max(0, at - 100), Math.min(lesson.raw_text.length, at + 260)).replace(/\n{3,}/gu, '\n\n'));
        }
      }
      for (const question of store.questions) {
        if (normalizeSprixText(question.prompt + ' ' + question.choices.map(choice => choice.text).join(' ')).includes(needle)) {
          found++;
          console.log('\n[QUESTION] ' + question.id + ' | ' + question.lesson_title);
          console.log(question.prompt);
        }
      }
      if (!found) console.log('No local matches for: ' + query);
    });

  sprix.command('export')
    .description('Export your locally captured SPRIX study data as JSON')
    .option('--out <path>', 'Output JSON path', path.join(SPRIX_DIR, 'study-export.json'))
    .action(options => {
      const store = loadSprixStore();
      const outputPath = path.resolve(options.out);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(store, null, 2) + '\n', 'utf8');
      console.log('Exported ' + store.captures.length + ' lesson(s) and ' + store.questions.length + ' question(s).');
      console.log(outputPath);
      console.log('Review this file before sharing. Captures may contain copyrighted course material and your personal notes.');
    });
}
