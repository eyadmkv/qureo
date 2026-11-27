import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { DATA_DIR } from './paths.js';
import { SprixHttpClient } from './sprixHttp.js';

const SPRIX_DIR = path.join(DATA_DIR, 'sprix');
export const SPRIX_BANK_PATH = path.join(SPRIX_DIR, 'answer-bank.json');
export const SPRIX_ENGLISH_BLOCK_BANK_PATH = path.join(SPRIX_DIR, 'block-answer-bank-subject3.json');
export const SPRIX_ARABIC_BLOCK_BANK_PATH = path.join(SPRIX_DIR, 'block-answer-bank-subject7.json');
export const SPRIX_ARABIC_ARCHIVE_PATH = path.join(SPRIX_DIR, 'answer-archive-subject7.json');
export const SPRIX_ENGLISH_ARCHIVE_PATH = path.join(SPRIX_DIR, 'answer-archive-subject3.json');
const SPRIX_ANSWER_SOURCE_BASE_URL = 'https://raw.githubusercontent.com/kky84rgkjy-maker/mohammad/9e73d17e0667c6eb8f358ceda53c2abec2e9a7db';
const SPRIX_ENGLISH_BLOCK_BANK_URL = SPRIX_ANSWER_SOURCE_BASE_URL + '/spx_api_bank_subject3.json';
const SPRIX_ENGLISH_ARCHIVE_URL = SPRIX_ANSWER_SOURCE_BASE_URL + '/answers_archive_subject3.json';
const SPRIX_ARABIC_BLOCK_BANK_URL = SPRIX_ANSWER_SOURCE_BASE_URL + '/spx_api_bank.json';
const SPRIX_ARABIC_ARCHIVE_URL = SPRIX_ANSWER_SOURCE_BASE_URL + '/answers_archive.json';

const STOP_WORDS = new Set((
  'اي ايه أي مما يلي من في عن على الى الي هذا هذه تلك ذلك التي الذي الذين اللاتي ' +
  'ما ماذا كيف هل هو هي هم هن كان كانت يكون تكون يتم تم قد مع او و ثم ان انه انها ' +
  'لكن بين عند عندما اذا لو لنفترض قبل بعد خلال لكل كل بعض احد واحد واحدة اخرى ' +
  'التالية التالي التاليه بشكل افضل أفضل اكبر اكثر أقل اقل وصف يصف يصفه حالة مشهد ' +
  'الاربعة اربعة الاثنين الاثنينين نحو حتى حيث جدا مازال'
).split(/\s+/u));

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('ar')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/gu, '')
    .replace(/[أإآ]/gu, 'ا')
    .replace(/ى/gu, 'ي')
    .replace(/[^\u0600-\u06FF\u2460-\u2473a-z0-9\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokens(value) {
  return Array.from(new Set(normalize(value).split(/\s+/u)
    .filter(word => (word.length > 2 || /^[\u2460-\u2473]$/u.test(word)) && !STOP_WORDS.has(word))));
}

export function wordSimilarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || !b.length) return { score: 0, matches: 0 };
  const setB = new Set(b);
  const matches = a.filter(word => setB.has(word)).length;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  return {
    score: 0.68 * (matches / shorter) + 0.32 * (matches / longer),
    matches
  };
}

function extractDataObject(source) {
  const text = String(source || '').replace(/^\uFEFF/u, '').trim();
  if (text.startsWith('{')) return JSON.parse(text);
  const assignment = /(?:var|let|const)\s+DATA\s*=\s*/u.exec(text);
  if (!assignment) throw new Error('Could not find a JSON DATA object in the userscript.');
  const start = assignment.index + assignment[0].length;
  // The DATA assignment regex already consumes optional whitespace before the object.
  if (text[start] !== '{') throw new Error('The DATA assignment is not a JSON object.');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') depth++;
    if (character === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error('The DATA object appears to be incomplete.');
}

export function parseSprixAnswerArchive(source, sourceName = 'answers_archive.json') {
  let archive;
  try {
    archive = JSON.parse(String(source || ''));
  } catch {
    throw new Error('The SPRIX answer archive is not valid JSON.');
  }

  if (!archive || !Array.isArray(archive.lessons)) {
    throw new Error('The SPRIX answer archive must contain a lessons array.');
  }

  const questions = [];
  const seen = new Set();
  for (const lesson of archive.lessons) {
    for (const row of lesson.questions || []) {
      const prompt = typeof row.question === 'string' ? row.question.trim() : '';
      const answer = typeof row.answer?.text === 'string' ? row.answer.text.trim() : '';
      if (!prompt || !answer) continue;

      const key = normalize(prompt) + '|' + normalize(answer);
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push({
        id: String(row.id || ''),
        question: prompt,
        answer,
        unitId: lesson.id ?? null,
        unit: lesson.title || lesson.name || '',
        levelId: null,
        level: ''
      });
    }
  }

  if (!questions.length) {
    throw new Error('The SPRIX answer archive contains no answered questions.');
  }

  return {
    format: 'sprix-answer-bank',
    schema_version: 1,
    imported_at: new Date().toISOString(),
    source: String(sourceName || 'answers_archive.json'),
    unit_count: archive.lessons.length,
    total: questions.length,
    answered: questions.length,
    unanswered: 0,
    questions
  };
}

export function parseSprixAnswerBank(source, sourceName = 'userscript') {
  const data = extractDataObject(source);
  if (!Array.isArray(data.units)) throw new Error('The imported DATA object has no units array.');
  const questions = [];
  const seen = new Set();

  for (const unit of data.units) {
    for (const level of unit.levels || []) {
      for (const question of level.questions || []) {
        const prompt = String(question.q || '').trim();
        const answer = typeof question.a === 'string' ? question.a.trim() : '';
        if (!prompt) continue;
        const key = normalize(prompt) + '|' + normalize(answer);
        if (seen.has(key)) continue;
        seen.add(key);
        questions.push({
          id: String(question.id || ''),
          question: prompt,
          answer: answer || null,
          unitId: unit.id ?? null,
          unit: unit.title || '',
          levelId: level.id ?? null,
          level: level.title || level.name || ''
        });
      }
    }
  }

  if (!questions.length) throw new Error('No usable questions were found in the imported DATA object.');
  return {
    format: 'sprix-answer-bank',
    schema_version: 1,
    imported_at: new Date().toISOString(),
    source: path.basename(String(sourceName || 'userscript')),
    unit_count: data.units.length,
    total: questions.length,
    answered: questions.filter(question => question.answer).length,
    unanswered: questions.filter(question => !question.answer).length,
    questions
  };
}

export function parseSprixBlockAnswerBank(
  source,
  sourceUrl = SPRIX_ENGLISH_BLOCK_BANK_URL,
  subjectId = 3
) {
  const resolvedSubjectId = Number(subjectId);
  if (resolvedSubjectId !== 3 && resolvedSubjectId !== 7) {
    throw new Error('SPRIX block-answer maps are only configured for subjects 3 and 7.');
  }
  const language = resolvedSubjectId === 7 ? 'ar' : 'en';
  const languageLabel = resolvedSubjectId === 7 ? 'Arabic' : 'English';
  let data;
  try {
    data = JSON.parse(String(source || ''));
  } catch {
    throw new Error('The public SPRIX block-answer map is not valid JSON.');
  }

  if (!data ||
      typeof data.block !== 'object' ||
      Array.isArray(data.block) ||
      !data.test ||
      typeof data.test !== 'object' ||
      Array.isArray(data.test)) {
    throw new Error('The public SPRIX answer map must contain block and test answer objects.');
  }

  const answers = {};
  for (const [rawBlockId, rawOptionId] of Object.entries(data.block)) {
    if (!/^[1-9]\d*$/u.test(rawBlockId)) {
      throw new Error('The public SPRIX answer map contains an invalid block ID.');
    }
    const optionId = Number(rawOptionId);
    if (!Number.isSafeInteger(optionId) || optionId < 1) {
      throw new Error('The public SPRIX answer map contains an invalid option ID for block #' + rawBlockId + '.');
    }
    answers[rawBlockId] = optionId;
  }

  const testAnswers = {};
  for (const [rawTestQuestionId, rawOptionId] of Object.entries(data.test)) {
    if (!/^[1-9]\d*$/u.test(rawTestQuestionId)) {
      throw new Error('The public SPRIX answer map contains an invalid test-question ID.');
    }
    const optionId = Number(rawOptionId);
    if (!Number.isSafeInteger(optionId) || optionId < 1) {
      throw new Error('The public SPRIX answer map contains an invalid option ID for test question #' + rawTestQuestionId + '.');
    }
    testAnswers[rawTestQuestionId] = optionId;
  }

  const total = Object.keys(answers).length;
  const testTotal = Object.keys(testAnswers).length;
  if (total < 200) {
    throw new Error('The public ' + languageLabel + ' answer map is incomplete (' + total + ' block answers). Nothing was imported.');
  }
  if (testTotal < 100) {
    throw new Error('The public ' + languageLabel + ' test answer map is incomplete (' + testTotal + ' answers). Nothing was imported.');
  }

  return {
    format: 'sprix-block-answer-bank',
    schema_version: 1,
    subject_id: resolvedSubjectId,
    language,
    imported_at: new Date().toISOString(),
    source_url: sourceUrl,
    total,
    answers,
    testTotal,
    testAnswers
  };
}

function saveSprixBlockAnswerBank(bank, outputPath = SPRIX_ENGLISH_BLOCK_BANK_PATH) {
  fs.mkdirSync(SPRIX_DIR, { recursive: true });
  const temporaryPath = outputPath + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(bank, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, outputPath);
}

function saveSprixArchiveBank(bank, outputPath) {
  fs.mkdirSync(SPRIX_DIR, { recursive: true });
  const temporaryPath = outputPath + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(bank, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, outputPath);
}

function readLocalSprixBank(filePath, label) {
  if (!fs.existsSync(filePath)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('The local ' + label + ' is invalid JSON: ' + filePath);
  }
  if (data?.format !== 'sprix-answer-bank' || data?.schema_version !== 1 || !Array.isArray(data.questions)) {
    throw new Error('The local ' + label + ' has an unsupported format: ' + filePath);
  }
  return data;
}

function readLocalSprixBlockBank(filePath, subjectId, language, label) {
  if (!fs.existsSync(filePath)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('The local ' + label + ' is invalid JSON. Run the matching bank import command again.');
  }
  if (data?.format !== 'sprix-block-answer-bank' ||
      data?.schema_version !== 1 ||
      data?.subject_id !== subjectId ||
      data?.language !== language ||
      !data.answers ||
      typeof data.answers !== 'object' ||
      Array.isArray(data.answers) ||
      !data.testAnswers ||
      typeof data.testAnswers !== 'object' ||
      Array.isArray(data.testAnswers)) {
    throw new Error('The local ' + label + ' has an unsupported format. Run the matching bank import command again.');
  }
  return data;
}

function mergeSprixQuestionBanks(...banks) {
  const questions = [];
  const seen = new Set();
  for (const bank of banks.filter(Boolean)) {
    for (const question of bank.questions || []) {
      const key = normalize(question.question) + '|' + normalize(question.answer);
      if (!question.question || !question.answer || seen.has(key)) continue;
      seen.add(key);
      questions.push(question);
    }
  }
  return questions;
}

export function loadSprixAnswerBank(subjectId = null) {
  if (Number(subjectId) === 7) {
    const localBank = readLocalSprixBank(SPRIX_BANK_PATH, 'Arabic SPRIX answer bank');
    const mappedBank = readLocalSprixBlockBank(
      SPRIX_ARABIC_BLOCK_BANK_PATH,
      7,
      'ar',
      'Arabic SPRIX API answer map'
    );
    const archiveBank = readLocalSprixBank(SPRIX_ARABIC_ARCHIVE_PATH, 'Arabic SPRIX answer archive');

    if (!localBank && !mappedBank && !archiveBank) {
      throw new Error(
        'No Arabic SPRIX answer source is installed. Run: sprix bank import-arabic'
      );
    }

    const questions = mergeSprixQuestionBanks(localBank, archiveBank);
    const imported = [localBank?.imported_at, archiveBank?.imported_at].filter(Boolean).sort().at(-1) || mappedBank?.imported_at || null;
    return {
      format: 'sprix-answer-bank',
      schema_version: 1,
      subjectId: 7,
      imported_at: imported,
      source: [localBank?.source, archiveBank?.source, mappedBank?.source_url].filter(Boolean).join('; ') || 'local Arabic SPRIX answer sources',
      total: questions.length,
      answered: questions.length,
      unanswered: 0,
      questions,
      blockAnswers: mappedBank?.answers || null,
      blockAnswerSource: mappedBank?.source_url || null,
      blockAnswerTotal: mappedBank?.total || 0,
      testAnswers: mappedBank?.testAnswers || {},
      testAnswerTotal: mappedBank?.testTotal || 0,
      archiveQuestionTotal: archiveBank?.total || 0
    };
  }

  if (Number(subjectId) === 3) {
    if (!fs.existsSync(SPRIX_ENGLISH_BLOCK_BANK_PATH)) {
      throw new Error(
        'No English SPRIX answer map is installed for subject 3. Run: sprix bank import-english'
      );
    }

    let englishBank;
    try {
      englishBank = JSON.parse(fs.readFileSync(SPRIX_ENGLISH_BLOCK_BANK_PATH, 'utf8'));
    } catch {
      throw new Error('The local English SPRIX answer map is invalid. Run sprix bank import-english again.');
    }

    if (englishBank?.format !== 'sprix-block-answer-bank' ||
        englishBank?.schema_version !== 1 ||
        englishBank?.subject_id !== 3 ||
        englishBank?.language !== 'en' ||
        !englishBank.answers ||
        typeof englishBank.answers !== 'object' ||
        Array.isArray(englishBank.answers)) {
      throw new Error('The local English SPRIX answer map has an unsupported format. Run sprix bank import-english again.');
    }

    const englishArchive = readLocalSprixBank(
      SPRIX_ENGLISH_ARCHIVE_PATH,
      'English SPRIX answer archive'
    );
    const questions = mergeSprixQuestionBanks(englishArchive);
    return {
      format: 'sprix-answer-bank',
      schema_version: 1,
      subjectId: 3,
      imported_at: [englishBank.imported_at, englishArchive?.imported_at].filter(Boolean).sort().at(-1) || null,
      source: [englishBank.source_url, englishArchive?.source].filter(Boolean).join('; '),
      total: questions.length,
      answered: questions.length,
      unanswered: 0,
      questions,
      archiveQuestionTotal: englishArchive?.total || 0,
      blockAnswers: englishBank.answers,
      blockAnswerSource: englishBank.source_url,
      testAnswers: englishBank.testAnswers && typeof englishBank.testAnswers === 'object'
        ? englishBank.testAnswers
        : {},
      testAnswerTotal: Number.isInteger(englishBank.testTotal)
        ? englishBank.testTotal
        : Object.keys(englishBank.testAnswers || {}).length
    };
  }

  if (!fs.existsSync(SPRIX_BANK_PATH)) {
    throw new Error('No local SPRIX answer bank. Import your userscript with: sprix bank import --file .\\script.js');
  }
  let bank;
  try {
    bank = JSON.parse(fs.readFileSync(SPRIX_BANK_PATH, 'utf8'));
  } catch {
    throw new Error('The local SPRIX answer bank is not valid JSON. Re-import the source file.');
  }
  if (bank?.format !== 'sprix-answer-bank' || bank?.schema_version !== 1 || !Array.isArray(bank.questions)) {
    throw new Error('The local SPRIX answer bank format is unsupported. Re-import the source file.');
  }
  return bank;
}

function numericSignature(value) {
  const ascii = String(value || '')
    .replace(/[٠-٩]/gu, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, digit => String(digit.charCodeAt(0) - 0x06f0));
  const values = ascii.match(/\d+/gu) || [];
  if (values.length < 2) return null;
  return values
    .map(value => value.replace(/^0+(?=\d)/u, ''))
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

function bestMatch(target, candidates, getText, { minimumScore, minimumMatches, margin, numericMatch = false } = {}) {
  if (numericMatch) {
    const expectedNumbers = numericSignature(target);
    if (expectedNumbers) {
      const expectedKey = JSON.stringify(expectedNumbers);
      const exactNumericMatches = candidates.filter(item => {
        const candidateNumbers = numericSignature(getText(item));
        return candidateNumbers && JSON.stringify(candidateNumbers) === expectedKey;
      });
      if (exactNumericMatches.length === 1) {
        return { match: exactNumericMatches[0], score: 1, matches: expectedNumbers.length, numeric: true };
      }
      if (exactNumericMatches.length > 1) {
        return { match: null, reason: 'ambiguous numeric match', bestScore: 1 };
      }
    }
  }

  const ranked = candidates.map(item => ({ item, ...wordSimilarity(target, getText(item)) }))
    .sort((a, b) => b.score - a.score || b.matches - a.matches);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < minimumScore || best.matches < minimumMatches) {
    return { match: null, reason: 'below confidence threshold', bestScore: best?.score || 0 };
  }
  if (second && best.score - second.score < margin) {
    return { match: null, reason: 'ambiguous match', bestScore: best.score };
  }
  return { match: best.item, score: best.score, matches: best.matches };
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

function blockPrompt(block) {
  const question = block.question || {};
  return cleanText(
    question.question_text || question.text || question.title || question.content || question.description ||
    question.prompt || question.question || block.text || block.description || block.content
  );
}

function optionText(option) {
  return cleanText(option.text || option.title || option.content || option.label || option.name || option.value);
}

export function buildSprixChapterPlan(data, bank) {
  const chapter = data.chapter || {};
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const cleared = new Set(Array.isArray(chapter.cleared_block_ids) ? chapter.cleared_block_ids : []);
  const pending = blocks.filter(block =>
    !cleared.has(block.id) &&
    (block.type === 'question' || (block.question && Array.isArray(block.options)))
  );
  const answeredBank = Array.isArray(bank.questions)
    ? bank.questions.filter(question => question.answer)
    : [];
  const blockAnswers = (Number(bank.subjectId) === 3 || Number(bank.subjectId) === 7) && bank.blockAnswers
    ? bank.blockAnswers
    : null;
  const blockMapLabel = Number(bank.subjectId) === 7
    ? 'Arabic subject-7'
    : 'English subject-3';
  const plan = [];
  const unmatched = [];

  for (const block of pending) {
    const prompt = blockPrompt(block);
    const options = Array.isArray(block.options) ? block.options : [];
    if (!prompt || !options.length) {
      unmatched.push({ blockId: block.id, prompt, reason: 'question prompt or options are missing' });
      continue;
    }

    if (blockAnswers) {
      const mappedOptionId = blockAnswers[String(block.id)];
      if (mappedOptionId !== undefined) {
        const mappedOption = options.find(option => String(option.id) === String(mappedOptionId));
        if (!mappedOption) {
          unmatched.push({
            blockId: block.id,
            prompt,
            reason: blockMapLabel + ' answer map points to option #' + mappedOptionId + ', which is absent from the live options'
          });
          continue;
        }

        plan.push({
          blockId: block.id,
          prompt,
          bankQuestion: blockMapLabel + ' block answer map',
          bankAnswer: 'Mapped option #' + mappedOptionId,
          optionId: mappedOption.id,
          optionText: optionText(mappedOption),
          questionScore: 1,
          optionScore: 1
        });
        continue;
      }
    }

    const questionResult = bestMatch(prompt, answeredBank, row => row.question, {
      minimumScore: 0.28,
      minimumMatches: 3,
      margin: 0.035
    });
    if (!questionResult.match) {
      unmatched.push({ blockId: block.id, prompt, reason: 'question ' + questionResult.reason });
      continue;
    }

    const answerTokens = tokens(questionResult.match.answer);
    const optionResult = bestMatch(questionResult.match.answer, options, optionText, {
      minimumScore: 0.24,
      minimumMatches: Math.min(2, answerTokens.length || 1),
      margin: 0.025,
      numericMatch: true
    });
    if (!optionResult.match) {
      unmatched.push({
        blockId: block.id,
        prompt,
        bankQuestion: questionResult.match.question,
        answer: questionResult.match.answer,
        reason: 'answer option ' + optionResult.reason
      });
      continue;
    }

    plan.push({
      blockId: block.id,
      prompt,
      bankQuestion: questionResult.match.question,
      bankAnswer: questionResult.match.answer,
      optionId: optionResult.match.id,
      optionText: optionText(optionResult.match),
      questionScore: questionResult.score,
      optionScore: optionResult.score
    });
  }

  return {
    chapter: chapter.title || chapter.name || null,
    clearedCount: cleared.size,
    totalBlocks: blocks.length,
    pendingQuestionCount: pending.length,
    plan,
    unmatched
  };
}

export function buildSprixTestPlan(data, bank) {
  const questions = Array.isArray(data?.test_questions)
    ? [...data.test_questions].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : [];
  if (!questions.length) {
    return {
      pendingQuestionCount: 0,
      plan: [],
      unmatched: [{ testQuestionId: null, reason: 'the live test attempt did not return any questions' }]
    };
  }

  const responses = new Map((Array.isArray(data.question_responses) ? data.question_responses : [])
    .map(response => [String(response.test_question_id), response]));
  const answers = bank?.testAnswers && typeof bank.testAnswers === 'object'
    ? bank.testAnswers
    : {};
  const answeredBank = Array.isArray(bank?.questions)
    ? bank.questions.filter(question => question && question.answer)
    : [];
  const plan = [];
  const unmatched = [];

  for (const testQuestion of questions) {
    const testQuestionId = String(testQuestion.id ?? '');
    const sourceQuestionId = String(testQuestion.question_id ?? '');
    if (!testQuestionId || !sourceQuestionId) {
      unmatched.push({ testQuestionId: testQuestionId || null, reason: 'test question is missing its ID or source question ID' });
      continue;
    }

    const question = data.questions?.[sourceQuestionId] || {};
    const prompt = cleanText(question.question_text || question.text || question.title || question.content || question.prompt || '');
    const options = Array.isArray(data.options?.[sourceQuestionId])
      ? data.options[sourceQuestionId]
      : [];
    if (!options.length) {
      unmatched.push({
        testQuestionId,
        sourceQuestionId,
        prompt,
        reason: 'the live test question has no available options'
      });
      continue;
    }

    const existing = responses.get(testQuestionId);
    const mappedOptionId = answers[testQuestionId];
    let selected;
    let bankQuestion;
    let bankAnswer;
    let questionScore = 1;
    let optionScore = 1;
    let answerSource = 'test-answer-map';

    if (mappedOptionId !== undefined) {
      selected = options.find(option => String(option.id) === String(mappedOptionId));
      if (!selected) {
        unmatched.push({
          testQuestionId,
          sourceQuestionId,
          prompt,
          reason: 'test answer map points to option #' + mappedOptionId + ', which is absent from the live test options'
        });
        continue;
      }
    } else {
      if (!prompt || !answeredBank.length) {
        unmatched.push({
          testQuestionId,
          sourceQuestionId,
          prompt,
          reason: 'no test-answer mapping or answered local question bank is available'
        });
        continue;
      }

      const questionResult = bestMatch(prompt, answeredBank, row => row.question, {
        minimumScore: 0.28,
        minimumMatches: 3,
        margin: 0.035
      });
      if (!questionResult.match) {
        unmatched.push({
          testQuestionId,
          sourceQuestionId,
          prompt,
          reason: 'local answer-bank question ' + questionResult.reason
        });
        continue;
      }

      bankQuestion = questionResult.match.question;
      bankAnswer = questionResult.match.answer;
      const answerTokens = tokens(bankAnswer);
      const optionResult = bestMatch(bankAnswer, options, optionText, {
        minimumScore: 0.24,
        minimumMatches: Math.min(2, answerTokens.length || 1),
        margin: 0.025,
        numericMatch: true
      });
      if (!optionResult.match) {
        unmatched.push({
          testQuestionId,
          sourceQuestionId,
          prompt,
          bankQuestion,
          bankAnswer,
          reason: 'local answer-bank option ' + optionResult.reason
        });
        continue;
      }

      selected = optionResult.match;
      questionScore = questionResult.score;
      optionScore = optionResult.score;
      answerSource = 'local-question-bank';
    }

    if (selected.is_correct === false) {
      unmatched.push({
        testQuestionId,
        sourceQuestionId,
        prompt,
        bankQuestion,
        bankAnswer,
        reason: 'SPRIX explicitly marks selected option #' + selected.id + ' as incorrect'
      });
      continue;
    }

    plan.push({
      testQuestionId: testQuestion.id,
      sourceQuestionId,
      prompt,
      optionId: selected.id,
      optionText: optionText(selected),
      bankQuestion,
      bankAnswer,
      answerSource,
      questionScore,
      optionScore,
      alreadySelected: String(existing?.selected_option_id ?? '') === String(selected.id)
    });
  }

  return { pendingQuestionCount: questions.length, plan, unmatched };
}

function saveBank(bank) {
  fs.mkdirSync(SPRIX_DIR, { recursive: true });
  const temporaryPath = SPRIX_BANK_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(bank, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, SPRIX_BANK_PATH);
}

function unitSections(unit) {
  if (Array.isArray(unit.sections) && unit.sections.length > 0) return unit.sections;
  if (Array.isArray(unit.items)) return [{ id: null, items: unit.items }];
  return [];
}

export function listSprixChapters(units) {
  if (!Array.isArray(units)) throw new Error('SPRIX curriculum did not contain a unit list.');

  const chapters = [];
  for (const unit of units) {
    for (const section of unitSections(unit)) {
      for (const item of section.items || []) {
        if (String(item.item_type || '').toLowerCase() !== 'chapter') continue;
        if (item.id === undefined || item.id === null || String(item.id).trim() === '') {
          throw new Error('A SPRIX chapter is missing its ID. The course run was stopped.');
        }
        chapters.push({
          ...item,
          id: String(item.id),
          sequence: chapters.length + 1,
          title: item.title || item.name || 'Untitled chapter',
          unitTitle: unit.title || unit.name || 'Unit',
          completed: item.is_completed === true,
          unlocked: unit.is_accessible !== false &&
            item.is_accessible !== false &&
            item.is_unlocked !== false
        });
      }
    }
  }
  return chapters;
}

export function listSprixCourseItems(units) {
  if (!Array.isArray(units)) throw new Error('SPRIX curriculum did not contain a unit list.');

  const items = [];
  let chapterSequence = 0;
  for (const unit of units) {
    for (const section of unitSections(unit)) {
      for (const item of section.items || []) {
        const itemType = String(item.item_type || '').toLowerCase();
        if (itemType !== 'chapter' && itemType !== 'review' && itemType !== 'test') continue;
        if (item.id === undefined || item.id === null || String(item.id).trim() === '') {
          throw new Error('A SPRIX ' + itemType + ' is missing its ID. The course run was stopped.');
        }

        if (itemType === 'chapter') chapterSequence++;
        items.push({
          ...item,
          id: String(item.id),
          itemType,
          sequence: items.length + 1,
          chapterSequence: itemType === 'chapter' ? chapterSequence : null,
          title: item.title || item.name || 'Untitled ' + itemType,
          unitTitle: unit.title || unit.name || 'Unit',
          completed: item.is_completed === true,
          unlocked: unit.is_accessible !== false &&
            item.is_accessible !== false &&
            item.is_unlocked !== false
        });
      }
    }
  }
  return items;
}

export function planSprixCourseItemSelection(items, {
  single = false,
  maxChapters = null,
  skipCompleted = true
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No SPRIX chapters, reviews or tests were found in the curriculum.');
  }
  if (maxChapters !== null && (!Number.isInteger(maxChapters) || maxChapters < 1)) {
    throw new Error('Maximum chapter count must be a positive integer.');
  }

  const startIndex = items.findIndex(item => !item.completed);
  if (startIndex < 0) {
    return {
      items: [],
      skippedCompleted: 0,
      selectionLabel: 'all course items',
      summary: 'All SPRIX chapters, reviews and tests are already complete.'
    };
  }

  let endIndex = items.length - 1;
  if (single) {
    const firstUnfinishedChapter = items.findIndex((item, index) =>
      index >= startIndex &&
      item.itemType === 'chapter' &&
      (!skipCompleted || !item.completed)
    );
    if (firstUnfinishedChapter >= 0) endIndex = firstUnfinishedChapter;
  }

  if (maxChapters !== null) {
    let chapterCount = 0;
    for (let index = startIndex; index <= endIndex; index++) {
      const item = items[index];
      if (item.itemType !== 'chapter' || (skipCompleted && item.completed)) continue;
      chapterCount++;
      if (chapterCount === maxChapters) {
        endIndex = index;
        break;
      }
    }
  }

  const selected = [];
  let skippedCompleted = 0;
  for (let index = startIndex; index <= endIndex; index++) {
    const item = items[index];
    if (skipCompleted && item.completed) {
      skippedCompleted++;
      continue;
    }
    selected.push(item);
  }

  const selectionLabel = single
    ? 'the first unfinished chapter and its preceding reviews'
    : maxChapters === null
      ? 'all remaining chapters, reviews and tests'
      : 'up to ' + maxChapters + ' unfinished chapter(s) and their preceding reviews';

  return {
    items: selected,
    skippedCompleted,
    selectionLabel,
    summary: selected.length ? null : 'No unfinished SPRIX chapters or reviews remain.'
  };
}

export function planSprixChapterSelection(chapters, {
  chapterId = null,
  single = false,
  maxChapters = null,
  skipCompleted = true
} = {}) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('No chapters were found in the SPRIX curriculum.');
  }
  if (maxChapters !== null && (!Number.isInteger(maxChapters) || maxChapters < 1)) {
    throw new Error('Maximum chapter count must be a positive integer.');
  }

  const target = chapterId === null || chapterId === undefined ? '' : String(chapterId).trim();
  let targetIndex = -1;
  if (target) {
    targetIndex = chapters.findIndex(chapter => String(chapter.id) === target);
    if (targetIndex < 0 && /^\d+$/u.test(target)) {
      targetIndex = chapters.findIndex(chapter => chapter.sequence === Number(target));
    }
    if (targetIndex < 0) throw new Error('Chapter "' + target + '" was not found in the SPRIX curriculum.');
  }

  const firstUnfinishedIndex = chapters.findIndex(chapter => !chapter.completed);
  const startIndex = target ? targetIndex : firstUnfinishedIndex;
  if (startIndex < 0) {
    return {
      chapters: [],
      skippedCompleted: 0,
      selectionLabel: 'all chapters',
      summary: 'All SPRIX chapters are already complete.'
    };
  }

  const endIndex = target ? targetIndex : single ? startIndex : chapters.length - 1;
  const candidates = [];
  let skippedCompleted = 0;
  for (let index = startIndex; index <= endIndex; index++) {
    const chapter = chapters[index];
    if (!chapter) continue;
    if (skipCompleted && chapter.completed) {
      skippedCompleted++;
      continue;
    }
    candidates.push(chapter);
  }

  const selected = maxChapters === null ? candidates : candidates.slice(0, maxChapters);
  const selectionLabel = target
    ? 'chapter ' + chapters[targetIndex].sequence
    : single
      ? 'the first unfinished chapter'
      : 'all remaining chapters';
  const summary = selected.length
    ? null
    : target && skipCompleted && chapters[targetIndex].completed
      ? 'Chapter ' + chapters[targetIndex].sequence + ' is already complete.'
      : 'No unfinished SPRIX chapters remain.';

  return { chapters: selected, skippedCompleted, selectionLabel, summary };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function refreshUntilSprixReviewCompleted(session, subjectId, reviewId, completionResponse) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const units = await session.getCurriculum(subjectId);
    const current = listSprixCourseItems(units).find(item =>
      item.itemType === 'review' && item.id === String(reviewId)
    );
    if (!current) throw new Error('Review ' + reviewId + ' disappeared from the SPRIX curriculum after completion.');
    if (current.completed ||
        completionResponse?.data?.is_completed === true ||
        completionResponse?.data?.completed === true) {
      return units;
    }
    if (attempt < 3) await wait(350);
  }
  throw new Error(
    'SPRIX accepted the completion request for review ' + reviewId +
    ', but the curriculum did not confirm it as completed. Stopping before the next course item.'
  );
}

async function refreshUntilSprixTestCompleted(session, subjectId, testId, completionResponse) {
  const response = completionResponse?.data?.response ?? completionResponse?.data?.result?.response ?? completionResponse?.data;
  if (response?.passed !== true) {
    throw new Error(
      'SPRIX submitted test ' + testId + ' but did not confirm a passing result' +
      (response?.total_score !== undefined ? ' (score ' + response.total_score + '%)' : '') +
      '. Stopping before the next course item.'
    );
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const units = await session.getCurriculum(subjectId);
    const current = listSprixCourseItems(units).find(item =>
      item.itemType === 'test' && item.id === String(testId)
    );
    if (!current) throw new Error('Test ' + testId + ' disappeared from the SPRIX curriculum after submission.');
    if (current.completed) return units;
    if (attempt < 3) await wait(350);
  }
  throw new Error(
    'SPRIX graded test ' + testId + ' as passed, but the curriculum did not confirm it as completed. ' +
    'Stopping before the next course item.'
  );
}

async function refreshUntilSprixChapterCompleted(session, subjectId, chapterId, completionResponse) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const units = await session.getCurriculum(subjectId);
    const current = listSprixChapters(units).find(chapter => chapter.id === String(chapterId));
    if (!current) throw new Error('Chapter ' + chapterId + ' disappeared from the SPRIX curriculum after completion.');
    if (current.completed ||
        completionResponse?.data?.is_completed === true ||
        completionResponse?.data?.completed === true) {
      return units;
    }
    if (attempt < 3) await wait(350);
  }
  throw new Error(
    'SPRIX accepted the completion request for chapter ' + chapterId +
    ', but the curriculum did not confirm it as completed. Stopping before the next chapter.'
  );
}

export async function solveSprixCourse(session, bank, {
  subjectId = null,
  chapterId = null,
  dryRun = false,
  single = false,
  maxChapters = null,
  skipCompleted = true,
  complete = true,
  chapterDelayMs = 0,
  questionDelayMs = 0,
  onProgress = message => console.log(message),
  onConfirm = async () => true
} = {}) {
  for (const [name, value] of [['Chapter pause', chapterDelayMs], ['Question pause', questionDelayMs]]) {
    if (!Number.isInteger(value) || value < 0 || value > 3600000) {
      throw new Error(name + ' must be between 0 and 3600 seconds.');
    }
  }

  const resolvedSubjectId = typeof session.resolveSubjectId === 'function'
    ? await session.resolveSubjectId(subjectId)
    : subjectId ?? '7';
  let units = await session.getCurriculum(resolvedSubjectId);
  const allChapters = listSprixChapters(units);
  const targetedChapter = chapterId !== null && chapterId !== undefined;
  let selection;
  let courseItemCount;

  if (targetedChapter) {
    const chapterSelection = planSprixChapterSelection(allChapters, {
      chapterId,
      single,
      maxChapters,
      skipCompleted
    });
    selection = {
      ...chapterSelection,
      items: chapterSelection.chapters.map(chapter => ({
        ...chapter,
        itemType: 'chapter',
        chapterSequence: chapter.sequence,
        sequence: chapter.sequence
      }))
    };
    courseItemCount = allChapters.length;
  } else {
    const courseItems = listSprixCourseItems(units);
    selection = planSprixCourseItemSelection(courseItems, {
      single,
      maxChapters,
      skipCompleted
    });
    courseItemCount = courseItems.length;
  }

  if (!selection.items.length) {
    const summary = selection.summary || 'No SPRIX course items were selected.';
    onProgress(summary);
    return {
      summary,
      chaptersProcessed: 0,
      chaptersCompleted: 0,
      reviewsProcessed: 0,
      reviewsCompleted: 0,
      testsProcessed: 0,
      testsCompleted: 0,
      testAnswersSubmitted: 0,
      questionsSubmitted: 0,
      skippedCompleted: selection.skippedCompleted
    };
  }

  const selectedChapters = selection.items.filter(item => item.itemType === 'chapter');
  const selectedReviews = selection.items.filter(item => item.itemType === 'review');
  const selectedTests = selection.items.filter(item => item.itemType === 'test');
  const first = selection.items[0];
  const last = selection.items[selection.items.length - 1];
  onProgress(
    'SPRIX progress: selected ' + selection.selectionLabel +
    ' (' + selectedChapters.length + ' chapter(s), ' + selectedReviews.length +
    ' review(s), ' + selectedTests.length + ' test(s)).'
  );
  onProgress(
    'Curriculum range: item ' + first.sequence + ' through ' + last.sequence +
    ' (' + selection.items.length + ' item(s)).'
  );
  if (selection.skippedCompleted) {
    onProgress('Skipping ' + selection.skippedCompleted + ' completed course item(s).');
  }
  if (maxChapters !== null) onProgress('Maximum unfinished chapter limit: ' + maxChapters + '.');
  if (dryRun) onProgress('Dry run enabled: no answers or completion requests will be sent.');

  if (!dryRun && !await onConfirm({
    chapters: selectedChapters,
    reviews: selectedReviews,
    tests: complete ? selectedTests : [],
    complete
  })) {
    const summary = 'Solve cancelled. No answers, review completions or tests were submitted.';
    onProgress(summary);
    return {
      summary,
      chaptersProcessed: 0,
      chaptersCompleted: 0,
      reviewsProcessed: 0,
      reviewsCompleted: 0,
      testsProcessed: 0,
      testsCompleted: 0,
      testAnswersSubmitted: 0,
      questionsSubmitted: 0,
      skippedCompleted: selection.skippedCompleted,
      cancelled: true
    };
  }

  let chaptersProcessed = 0;
  let chaptersCompleted = 0;
  let reviewsProcessed = 0;
  let reviewsCompleted = 0;
  let testsProcessed = 0;
  let testsCompleted = 0;
  let testAnswersSubmitted = 0;
  let questionsSubmitted = 0;
  let skippedCompleted = selection.skippedCompleted;

  for (let position = 0; position < selection.items.length; position++) {
    const selected = selection.items[position];
    const currentItems = targetedChapter
      ? listSprixChapters(units).map(chapter => ({
        ...chapter,
        itemType: 'chapter',
        chapterSequence: chapter.sequence,
        sequence: chapter.sequence
      }))
      : listSprixCourseItems(units);
    const current = currentItems.find(item =>
      item.itemType === selected.itemType && item.id === selected.id
    );
    if (!current) {
      throw new Error(
        'SPRIX ' + selected.itemType + ' ' + selected.id +
        ' is missing from the refreshed curriculum. Stopping the run.'
      );
    }
    if (skipCompleted && current.completed) {
      skippedCompleted++;
      onProgress('Skipping completed ' + current.itemType + ' ' + current.sequence + ': ' + current.title);
      continue;
    }

    if (current.itemType === 'review') {
      onProgress(
        '\nReview ' + current.sequence + '/' + courseItemCount + ': ' + current.title +
        (current.unitTitle ? ' | ' + current.unitTitle : '')
      );

      if (dryRun) {
        onProgress('[review] Would complete review ' + current.id + ' through POST /api/v1/reviews/' + current.id + '/complete.');
      } else if (!complete) {
        onProgress('[review] Left review ' + current.id + ' uncompleted by --answers-only.');
      } else {
        onProgress('Completing review ' + current.id + '...');
        const completion = await session.completeReview(current.id);
        units = await refreshUntilSprixReviewCompleted(session, resolvedSubjectId, current.id, completion);
        reviewsCompleted++;
        onProgress('SPRIX confirmed review ' + current.id + ' as complete.');
      }

      reviewsProcessed++;
      continue;
    }

    if (current.itemType === 'test') {
      onProgress(
        '\nTest ' + current.id + ': ' + current.title +
        (current.unitTitle ? ' | ' + current.unitTitle : '')
      );

      if (dryRun) {
        onProgress('[test] Would start the test, apply mapped answers, and submit it for grading. Dry-run does not create test attempts or send test answers.');
        testsProcessed++;
        onProgress('[test] Stopping the preview here because later course items may remain locked until this test is passed.');
        break;
      }

      if (!complete) {
        onProgress('[test] Skipped because --answers-only leaves tests unsubmitted. Stopping before the next course item.');
        testsProcessed++;
        break;
      }

      if (!current.unlocked) {
        throw new Error(
          'Test ' + current.id + ' (' + current.title +
          ') is flagged as locked by the curriculum. No test attempt was started.'
        );
      }

      const hasTestAnswerMap = bank.testAnswers && Object.keys(bank.testAnswers).length > 0;
      const hasAnsweredQuestionBank = Array.isArray(bank.questions) &&
        bank.questions.some(question => question && question.answer);
      if (!hasTestAnswerMap && !hasAnsweredQuestionBank) {
        throw new Error(
          'No usable SPRIX test-answer source is installed. Import a subject-specific test map or an answered local question bank before solving tests.'
        );
      }

      const started = await session.startTest(current.id);
      const testData = started?.data ?? started;
      const testResult = buildSprixTestPlan(testData, bank);

      onProgress(
        'Test questions: ' + testResult.pendingQuestionCount +
        ' | mapped: ' + testResult.plan.length
      );
      for (const entry of testResult.plan) {
        onProgress(
          '\n[match] test question #' + entry.testQuestionId + ' -> option #' + entry.optionId +
          (entry.prompt ? '\n  Question: ' + entry.prompt : '') +
          (entry.bankQuestion ? '\n  Bank question: ' + entry.bankQuestion : '') +
          (entry.bankAnswer ? '\n  Bank answer: ' + entry.bankAnswer : '') +
          '\n  Option: ' + entry.optionText +
          (entry.answerSource === 'local-question-bank'
            ? '\n  Confidence: question ' + entry.questionScore.toFixed(3) + ', option ' + entry.optionScore.toFixed(3)
            : '')
        );
      }

      if (testResult.unmatched.length) {
        onProgress('\nUnmatched test questions:');
        for (const item of testResult.unmatched) {
          onProgress(
            '  test question #' + (item.testQuestionId ?? '?') + ': ' + item.reason +
            (item.prompt ? ' | ' + item.prompt : '')
          );
        }
        throw new Error(
          'Test ' + current.id + ' has ' + testResult.unmatched.length +
          ' unmatched question(s). No test answers were submitted. The test attempt may remain open.'
        );
      }

      if (!testResult.plan.length || testResult.plan.length !== testResult.pendingQuestionCount) {
        throw new Error('Test ' + current.id + ' did not produce a complete answer plan. No test answers were submitted.');
      }

      for (let index = 0; index < testResult.plan.length; index++) {
        const entry = testResult.plan[index];
        if (entry.alreadySelected) {
          onProgress('Already selected test question #' + entry.testQuestionId + '.');
          continue;
        }
        const answer = await session.answerTestQuestion(current.id, entry.testQuestionId, entry.optionId);
        if (answer?.data?.saved === false) {
          throw new Error(
            'SPRIX did not save test question #' + entry.testQuestionId +
            '. Test answers saved before this point remain in the active attempt.'
          );
        }
        testAnswersSubmitted++;
        onProgress('Saved test answer ' + (index + 1) + '/' + testResult.plan.length + ': question #' + entry.testQuestionId + '.');
        if (questionDelayMs > 0 && index < testResult.plan.length - 1) {
          onProgress('Waiting ' + (questionDelayMs / 1000).toFixed(1) + 's before the next test answer.');
          await wait(questionDelayMs);
        }
      }

      onProgress('Submitting test ' + current.id + ' for grading...');
      const submission = await session.submitTest(current.id);
      const graded = submission?.data?.response ?? submission?.data?.result?.response ?? submission?.data;
      if (graded?.passed !== true) {
        throw new Error(
          'Test ' + current.id + ' was submitted but did not pass' +
          (graded?.total_score !== undefined ? ' (score ' + graded.total_score + '%)' : '') +
          '. The solver stopped before the next course item.'
        );
      }

      units = await refreshUntilSprixTestCompleted(session, resolvedSubjectId, current.id, submission);
      testsCompleted++;
      testsProcessed++;
      onProgress(
        'SPRIX confirmed test ' + current.id + ' as passed' +
        (graded.total_score !== undefined ? ' with ' + graded.total_score + '%' : '') + '.'
      );

      if (chapterDelayMs > 0 && position < selection.items.length - 1) {
        onProgress('Waiting ' + (chapterDelayMs / 1000).toFixed(1) + 's before the next course item.');
        await wait(chapterDelayMs);
      }
      continue;
    }

    if (!current.unlocked) {
      onProgress(
        '[access] Curriculum marks chapter ' + current.chapterSequence +
        ' as locked; checking the live chapter endpoint before deciding.'
      );
    }

    let data;
    try {
      data = await session.getChapterBlocks(current.id);
    } catch (error) {
      if (!current.unlocked) {
        throw new Error(
          'Chapter ' + current.chapterSequence + ' (' + current.title +
          ') is flagged as locked by the curriculum, and SPRIX denied the read-only chapter request: ' +
          error.message + ' No answers were submitted for this chapter.'
        );
      }
      throw error;
    }

    const result = buildSprixChapterPlan(data, bank);
    if (!current.unlocked && result.pendingQuestionCount === 0) {
      throw new Error(
        'Chapter ' + current.chapterSequence + ' (' + current.title +
        ') is flagged as locked, and SPRIX returned no pending questions. ' +
        'The solver stopped without submitting answers or requesting completion.'
      );
    }
    onProgress(
      '\nChapter ' + current.chapterSequence + '/' + allChapters.length + ': ' + current.title +
      (current.unitTitle ? ' | ' + current.unitTitle : '') +
      ' | ' + result.pendingQuestionCount + ' pending question(s), ' +
      result.plan.length + ' matched answer(s)'
    );

    for (const entry of result.plan) {
      onProgress(
        '\n[match] block #' + entry.blockId + ' -> option #' + entry.optionId +
        '\n  Question: ' + entry.prompt +
        '\n  Bank answer: ' + entry.bankAnswer +
        '\n  Option: ' + entry.optionText +
        '\n  Confidence: question ' + entry.questionScore.toFixed(3) +
        ', option ' + entry.optionScore.toFixed(3)
      );
    }

    if (result.unmatched.length) {
      onProgress('\nUnmatched:');
      for (const item of result.unmatched) {
        onProgress('  block #' + item.blockId + ': ' + item.reason + (item.prompt ? ' | ' + item.prompt : ''));
      }
      if (!dryRun) {
        throw new Error(
          'Chapter ' + current.chapterSequence + ' has ' + result.unmatched.length +
          ' unmatched question(s). No answers were submitted for this chapter. The course run stopped here.'
        );
      }
    }

    if (result.pendingQuestionCount === 0) onProgress('No pending multiple-choice questions were found.');

    if (dryRun) {
      chaptersProcessed++;
      continue;
    }

    for (let index = 0; index < result.plan.length; index++) {
      const entry = result.plan[index];
      const response = await session.answerChapterQuestion(current.id, entry.blockId, entry.optionId, 0);
      if (response.data?.is_correct !== true) {
        throw new Error(
          'SPRIX did not confirm block #' + entry.blockId + ' as correct. Accepted ' +
          index + '/' + result.plan.length + ' answer(s) in this chapter. Stopping the course run.'
        );
      }
      questionsSubmitted++;
      onProgress('Accepted ' + (index + 1) + '/' + result.plan.length + ': block #' + entry.blockId + '.');
      if (questionDelayMs > 0 && index < result.plan.length - 1) {
        onProgress('Waiting ' + (questionDelayMs / 1000).toFixed(1) + 's before the next question.');
        await wait(questionDelayMs);
      }
    }

    if (complete) {
      onProgress('Completing chapter ' + current.chapterSequence + '...');
      const completion = await session.completeChapter(current.id);
      if (completion?.data?.star_score !== undefined) {
        onProgress('Star score: ' + completion.data.star_score);
      }
      units = await refreshUntilSprixChapterCompleted(session, resolvedSubjectId, current.id, completion);
      chaptersCompleted++;
      onProgress('SPRIX confirmed chapter ' + current.chapterSequence + ' as complete.');
    } else {
      onProgress('All matched answers were accepted. Chapter completion was not requested.');
    }

    chaptersProcessed++;
    if (chapterDelayMs > 0 && position < selection.items.length - 1) {
      onProgress('Waiting ' + (chapterDelayMs / 1000).toFixed(1) + 's before the next curriculum item.');
      await wait(chapterDelayMs);
    }
  }

  const summary = dryRun
    ? 'Preview complete: ' + chaptersProcessed + ' chapter(s), ' + reviewsProcessed +
      ' review(s), and ' + testsProcessed + ' test(s) inspected; no answers submitted.'
    : 'Solve run complete: ' + chaptersProcessed + ' chapter(s) processed, ' +
      questionsSubmitted + ' chapter answer(s) accepted, ' + reviewsCompleted + ' review(s) completed, ' +
      testsCompleted + ' test(s) passed, and ' + testAnswersSubmitted + ' test answer(s) saved' +
      (complete ? ', ' + chaptersCompleted + ' chapter(s) completed.' : ', chapter and review completion disabled; tests skipped.');
  onProgress(summary);
  return {
    summary,
    chaptersProcessed,
    chaptersCompleted,
    reviewsProcessed,
    reviewsCompleted,
    testsProcessed,
    testsCompleted,
    testAnswersSubmitted,
    questionsSubmitted,
    skippedCompleted
  };
}
function countChapterQuestions(data) {
  return (Array.isArray(data?.blocks) ? data.blocks : []).filter(block =>
    block.type === 'question' || (block.question && Array.isArray(block.options) && block.options.length > 0)
  ).length;
}

function countReviewQuestions(payload) {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data.length;
  if (Array.isArray(data?.items)) return data.items.length;
  if (Array.isArray(data?.questions)) return data.questions.length;
  return 0;
}

export function buildSprixCourseAnswerBank(source, answerMap, sourceName = 'course-source.json') {
  if (source?.format !== 'sprix-course-source' || !Array.isArray(source.units)) {
    throw new Error('The source file is not a SPRIX course export. Run sprix bank harvest first.');
  }
  if (answerMap?.format !== 'sprix-answer-map' || !answerMap.answers || typeof answerMap.answers !== 'object') {
    throw new Error('The answer map format is unsupported.');
  }
  if (Number(answerMap.subject_id) !== Number(source.subject_id)) {
    throw new Error('The answer map subject does not match the course export.');
  }

  const answerIds = new Set(Object.keys(answerMap.answers).map(String));
  const sourceIds = new Set();
  const units = [];
  let chaptersFetched = 0;
  let testsListed = 0;

  for (const unit of source.units) {
    const levels = [];
    for (const section of unitSections(unit)) {
      for (const item of section.items || []) {
        if (item.item_type === 'test') testsListed++;
        if (item.item_type !== 'chapter' || item.source_status !== 'fetched') continue;
        chaptersFetched++;

        const questions = [];
        for (const block of item.data?.blocks || []) {
          const question = block.question || {};
          const isQuestion = block.type === 'question' || (Array.isArray(block.options) && block.options.length > 0);
          if (!isQuestion) continue;

          const questionId = String(question.id ?? '');
          if (!questionId) throw new Error('A chapter question is missing its question ID (block #' + block.id + ').');
          if (sourceIds.has(questionId)) throw new Error('Duplicate SPRIX question ID in course export: ' + questionId);
          sourceIds.add(questionId);

          const answer = answerMap.answers[questionId];
          if (!answer) continue;

          const selectedOptionId = String(answer.choice_id ?? answer.option_id ?? '');
          const selectedOption = (block.options || []).find(option => String(option.id) === selectedOptionId);
          if (!selectedOption) {
            throw new Error('Answer map option #' + selectedOptionId + ' does not belong to question #' + questionId + '.');
          }

          const prompt = cleanText(
            question.question_text || question.text || question.title || question.content ||
            question.description || question.prompt || question.question
          );
          const answerText = optionText(selectedOption);
          if (!prompt || !answerText) {
            throw new Error('Question #' + questionId + ' is missing its prompt or selected option text.');
          }

          questions.push({ id: questionId, q: prompt, a: answerText });
        }

        if (questions.length) levels.push({ id: item.id, title: item.title || '', questions });
      }
    }
    if (levels.length) units.push({ id: unit.id ?? null, title: unit.title || '', levels });
  }

  const missing = [...sourceIds].filter(id => !answerIds.has(id));
  const unknown = [...answerIds].filter(id => !sourceIds.has(id));
  if (missing.length || unknown.length) {
    const details = [];
    if (missing.length) details.push(missing.length + ' source question(s) have no mapped option');
    if (unknown.length) details.push(unknown.length + ' answer-map ID(s) are absent from the source export');
    throw new Error('The course export and answer map do not match: ' + details.join('; ') + '. No bank was saved.');
  }

  const bank = parseSprixAnswerBank(JSON.stringify({ units }), sourceName);
  bank.course_id = answerMap.course_id || 'sprix_subject_' + Number(source.subject_id);
  bank.subject_id = Number(source.subject_id);
  bank.source_format = source.format;
  bank.source_export = path.basename(String(sourceName));
  bank.answer_basis = answerMap.method || 'Derived from course question wording, hints and option text.';
  bank.coverage = {
    units: source.units.length,
    chapters_fetched: chaptersFetched,
    chapter_questions: sourceIds.size,
    mapped_chapter_questions: bank.total,
    tests_listed: testsListed,
    test_questions_fetched: 0,
    test_answers_mapped: 0
  };
  return bank;
}

async function harvestCourseSource(subjectId, outputPath) {
  const session = SprixHttpClient.loadSession();
  const resolvedSubjectId = await session.resolveSubjectId(subjectId);
  const units = await session.getCurriculum(resolvedSubjectId);
  const output = {
    format: 'sprix-course-source',
    schema_version: 1,
    subject_id: resolvedSubjectId,
    exported_at: new Date().toISOString(),
    extraction_method: 'SPRIX authenticated read-only curriculum, chapter and review GET requests',
    coverage: {
      units: units.length,
      chapters: 0,
      reviews: 0,
      tests: 0,
      chapter_questions: 0,
      review_items: 0,
      errors: 0
    },
    units: [],
    errors: []
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let processed = 0;

  for (const unit of units) {
    const exportedUnit = {
      id: unit.id ?? null,
      title: unit.title || unit.name || '',
      is_accessible: unit.is_accessible ?? null,
      sections: []
    };

    for (const section of unitSections(unit)) {
      const exportedSection = {
        id: section.id ?? null,
        title: section.title || section.name || '',
        items: []
      };

      for (const item of section.items || []) {
        const exportedItem = {
          id: item.id,
          item_type: item.item_type || 'unknown',
          title: item.title || item.name || '',
          is_completed: Boolean(item.is_completed),
          is_unlocked: Boolean(item.is_unlocked),
          source_status: 'metadata-only'
        };

        if (item.item_type === 'chapter') {
          try {
            const data = await session.getChapterBlocks(item.id);
            exportedItem.source_status = 'fetched';
            exportedItem.data = data;
            exportedItem.question_count = countChapterQuestions(data);
            output.coverage.chapters++;
            output.coverage.chapter_questions += exportedItem.question_count;
          } catch (error) {
            exportedItem.source_status = 'error';
            exportedItem.error = error.message;
            output.errors.push({
              type: 'chapter',
              id: item.id,
              title: exportedItem.title,
              message: error.message
            });
          }
        } else if (item.item_type === 'review') {
          try {
            const payload = await session.getReviewItems(item.id);
            exportedItem.source_status = 'fetched';
            exportedItem.data = payload?.data ?? payload;
            exportedItem.question_count = countReviewQuestions(payload);
            output.coverage.reviews++;
            output.coverage.review_items += exportedItem.question_count;
          } catch (error) {
            exportedItem.source_status = 'error';
            exportedItem.error = error.message;
            output.errors.push({
              type: 'review',
              id: item.id,
              title: exportedItem.title,
              message: error.message
            });
          }
        } else if (item.item_type === 'test') {
          output.coverage.tests++;
          exportedItem.note = 'Test questions were not started or submitted by this read-only export.';
        }

        exportedSection.items.push(exportedItem);
        processed++;
        if (item.item_type === 'chapter' || item.item_type === 'review') {
          if (processed % 4 === 0) {
            console.log('Fetched ' + output.coverage.chapters + ' chapter(s) and ' +
              output.coverage.reviews + ' review(s); ' + output.errors.length + ' error(s).');
          }
          await sleep(120);
        }
      }

      exportedUnit.sections.push(exportedSection);
    }

    output.units.push(exportedUnit);
  }

  output.coverage.errors = output.errors.length;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = outputPath + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(output, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, outputPath);

  console.log('\nSPRIX course export finished.');
  console.log('Units: ' + output.coverage.units);
  console.log('Chapters fetched: ' + output.coverage.chapters);
  console.log('Chapter question blocks: ' + output.coverage.chapter_questions);
  console.log('Reviews fetched: ' + output.coverage.reviews);
  console.log('Review items: ' + output.coverage.review_items);
  console.log('Tests listed, without opening attempts: ' + output.coverage.tests);
  console.log('Errors: ' + output.coverage.errors);
  console.log('Saved locally: ' + outputPath);
  console.log('This export is local and contains course content. Review it before sharing.');
}

function registerBankCommands(sprix) {
  const bank = sprix.command('bank').description('Import and inspect your local SPRIX answer bank');
  bank.command('import')
    .description('Import the DATA object from your userscript into the ignored local data directory')
    .requiredOption('--file <path>', 'Path to the userscript .js file or exported DATA JSON')
    .option('--replace', 'Replace the existing local answer bank')
    .action(options => {
      if (fs.existsSync(SPRIX_BANK_PATH) && !options.replace) {
        throw new Error('A local answer bank already exists. Use --replace to overwrite it.');
      }
      const file = path.resolve(options.file);
      if (!fs.existsSync(file)) throw new Error('Answer-bank source file not found: ' + file);
      const bankData = parseSprixAnswerBank(fs.readFileSync(file, 'utf8'), file);
      saveBank(bankData);
      console.log('Imported ' + bankData.total + ' unique question(s) from ' + bankData.source + '.');
      console.log('Answer notes: ' + bankData.answered + ' | Missing answers: ' + bankData.unanswered);
      console.log('Saved locally: ' + SPRIX_BANK_PATH);
      console.log('This bank is not committed or uploaded.');
    });

  bank.command('build')
    .description('Build a local text-matching bank from the course export and a question-ID answer map')
    .option('--source <path>', 'Course export JSON path', path.join(SPRIX_DIR, 'course-source.json'))
    .option('--answers <path>', 'Answer map JSON path', path.join(SPRIX_DIR, 'answer-map.json'))
    .option('--replace', 'Replace the existing local answer bank')
    .action(options => {
      if (fs.existsSync(SPRIX_BANK_PATH) && !options.replace) {
        throw new Error('A local answer bank already exists. Use --replace to overwrite it.');
      }
      const sourcePath = path.resolve(options.source);
      const answersPath = path.resolve(options.answers);
      if (!fs.existsSync(sourcePath)) throw new Error('Course export not found: ' + sourcePath);
      if (!fs.existsSync(answersPath)) throw new Error('SPRIX answer map not found: ' + answersPath);

      let source;
      let answerMap;
      try {
        source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
        answerMap = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
      } catch {
        throw new Error('The course export or answer map is not valid JSON.');
      }

      const bankData = buildSprixCourseAnswerBank(source, answerMap, sourcePath);
      saveBank(bankData);
      console.log('Built ' + bankData.answered + ' answered question(s) across ' + bankData.unit_count + ' unit(s).');
      console.log('Chapter questions mapped: ' + bankData.coverage.mapped_chapter_questions + '/' + bankData.coverage.chapter_questions);
      console.log('Tests listed but not included: ' + bankData.coverage.tests_listed);
      console.log('Stored locally: ' + SPRIX_BANK_PATH);
      console.log('Review the dry-run output from sprix solve <chapter-id> before submitting anything.');
    });

  bank.command('harvest')
    .description('Export all chapter and review question content through read-only SPRIX API requests')
    .option('--subject <id>', 'SPRIX subject ID (defaults to the saved course)')
    .option('--out <path>', 'Output JSON path')
    .action(async options => {
      const outputPath = path.resolve(options.out || path.join(SPRIX_DIR, 'course-source.json'));
      await harvestCourseSource(options.subject, outputPath);
    });

  bank.command('import-english')
    .description('Download the public English Financial Literacy subject-3 ID maps and text archive into the ignored local data directory')
    .action(async () => {
      const [mapResponse, archiveResponse] = await Promise.all([
        fetch(SPRIX_ENGLISH_BLOCK_BANK_URL, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(20000)
        }),
        fetch(SPRIX_ENGLISH_ARCHIVE_URL, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(20000)
        })
      ]);
      if (!mapResponse.ok) {
        throw new Error('The public English SPRIX answer map download failed (HTTP ' + mapResponse.status + ').');
      }
      if (!archiveResponse.ok) {
        throw new Error('The public English SPRIX answer archive download failed (HTTP ' + archiveResponse.status + ').');
      }

      const [mapSource, archiveSource] = await Promise.all([
        mapResponse.text(),
        archiveResponse.text()
      ]);
      const imported = parseSprixBlockAnswerBank(mapSource, SPRIX_ENGLISH_BLOCK_BANK_URL);
      const archive = parseSprixAnswerArchive(archiveSource, SPRIX_ENGLISH_ARCHIVE_URL);
      saveSprixBlockAnswerBank(imported);
      saveSprixArchiveBank(archive, SPRIX_ENGLISH_ARCHIVE_PATH);
      console.log('Imported ' + imported.total + ' English subject-3 chapter block-answer mappings.');
      console.log('Imported ' + imported.testTotal + ' English subject-3 test-answer mappings.');
      console.log('Imported ' + archive.total + ' English subject-3 text answers for fallback matching.');
      console.log('Source: ' + imported.source_url);
      console.log('Text archive: ' + archive.source);
      console.log('Saved locally: ' + SPRIX_ENGLISH_BLOCK_BANK_PATH);
      console.log('Saved locally: ' + SPRIX_ENGLISH_ARCHIVE_PATH);
      console.log('The solver validates mapped option IDs against live options and uses the text archive when no ID mapping exists.');
      console.log('This third-party answer data is unverified and is stored locally only.');
    });

  bank.command('import-arabic')
    .description('Download the Arabic subject-7 API answer map and question-text archive into the ignored local data directory')
    .action(async () => {
      const fetchSource = async (url, label) => {
        let response;
        try {
          response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(30000)
          });
        } catch (error) {
          throw new Error('Could not download ' + label + ': ' + error.message);
        }
        if (!response.ok) {
          throw new Error(label + ' download failed (HTTP ' + response.status + ').');
        }
        return response.text();
      };

      const [mapSource, archiveSource] = await Promise.all([
        fetchSource(SPRIX_ARABIC_BLOCK_BANK_URL, 'the Arabic SPRIX API answer map'),
        fetchSource(SPRIX_ARABIC_ARCHIVE_URL, 'the Arabic SPRIX answer archive')
      ]);
      const mapped = parseSprixBlockAnswerBank(mapSource, SPRIX_ARABIC_BLOCK_BANK_URL, 7);
      const archive = parseSprixAnswerArchive(archiveSource, SPRIX_ARABIC_ARCHIVE_URL);

      saveSprixBlockAnswerBank(mapped, SPRIX_ARABIC_BLOCK_BANK_PATH);
      saveSprixBlockAnswerBank(archive, SPRIX_ARABIC_ARCHIVE_PATH);
      console.log('Imported ' + mapped.total + ' Arabic subject-7 chapter block-answer mappings.');
      console.log('Imported ' + mapped.testTotal + ' Arabic subject-7 test-answer mappings.');
      console.log('Imported ' + archive.total + ' answered questions from the Arabic text archive.');
      console.log('API map source: ' + mapped.source_url);
      console.log('Text archive source: ' + archive.source);
      console.log('Saved locally under: ' + SPRIX_DIR);
      console.log('The solver validates every mapped option ID against the live question options before using it.');
      console.log('The upstream answer data is third-party and unverified; it remains local and is not committed.');
    });

  bank.command('status')
    .description('Show counts from the local SPRIX answer bank')
    .option('--subject <id>', 'SPRIX subject ID')
    .action(options => {
      const data = loadSprixAnswerBank(options.subject);
      console.log('Units: ' + (data.unit_count ?? 'n/a'));
      console.log('Questions: ' + (data.total ?? 0));
      console.log('With answer notes: ' + (data.answered ?? 0));
      console.log('Without answer notes: ' + (data.unanswered ?? 0));
      console.log('Imported from: ' + (data.source || 'local answer map'));
      if (data.blockAnswerSource) console.log('Block-answer source: ' + data.blockAnswerSource);
      if (Number(options.subject) === 3 || Number(options.subject) === 7) {
        console.log('Chapter block mappings: ' + (data.blockAnswerTotal ?? Object.keys(data.blockAnswers || {}).length));
        console.log('Test answer mappings: ' + (data.testAnswerTotal ?? Object.keys(data.testAnswers || {}).length));
      }
      if (Number(options.subject) === 3) console.log('English archive questions: ' + (data.archiveQuestionTotal ?? 0));
      if (Number(options.subject) === 7) console.log('Arabic archive questions: ' + (data.archiveQuestionTotal ?? 0));
      const bankPath = Number(options.subject) === 3
        ? SPRIX_ENGLISH_BLOCK_BANK_PATH
        : Number(options.subject) === 7
          ? SPRIX_ARABIC_BLOCK_BANK_PATH
          : SPRIX_BANK_PATH;
      console.log('Stored locally: ' + bankPath);
    });
}

async function confirmSprixSolve({ chapters, reviews, tests = [], complete }, yes) {
  if (yes) return true;
  if (!stdin.isTTY) {
    throw new Error('SPRIX solve will submit answers, complete reviews, and submit tests for grading. Use --yes to confirm in a non-interactive terminal, or --dry-run to preview.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const actions = [];
    if (chapters.length) {
      actions.push(
        complete
          ? 'submit matched answers for ' + chapters.length + ' chapter(s) and complete them'
          : 'submit answers for ' + chapters.length + ' chapter(s) without completing them'
      );
    }
    if (complete && reviews.length) actions.push('complete ' + reviews.length + ' review(s)');
    if (tests.length) actions.push('start, answer, and submit ' + tests.length + ' test(s) for grading');
    const actionText = actions.length ? actions.join(', ') : 'process the selected course items';
    const response = await rl.question(
      'This will ' + actionText + ' and update your course progress. Continue? [y/N] '
    );
    return /^(?:y|yes)$/iu.test(response.trim());
  } finally {
    rl.close();
  }
}

function parseSolvePause(value, label) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    throw new Error(label + ' must be between 0 and 3600 seconds.');
  }
  return Math.round(seconds * 1000);
}

function registerSolveCommand(sprix) {
  sprix.command('solve [chapterId]')
    .description('Solve chapters, reviews and tests in curriculum order, or one selected chapter')
    .option('--subject <id>', 'SPRIX subject ID (defaults to the saved course)')
    .option('--dry-run', 'Preview chapters, reviews and tests without submitting answers or starting tests')
    .option('--yes', 'Confirm the run without an interactive prompt')
    .option('--single', 'Solve the first unfinished chapter and its preceding reviews')
    .option('--max-chapters <count>', 'Stop after this many chapters')
    .option('--no-skip-completed', 'Revisit completed chapters in the selected work')
    .option('--complete', 'Complete an explicitly selected chapter after its answers are accepted')
    .option('--answers-only', 'Submit answers without completing chapters during a course-wide run')
    .option('--pause-between-chapters <seconds>', 'Wait between completed chapters', '0')
    .option('--pause-between-questions <seconds>', 'Wait between submitted answers', '0')
    .action(async (chapterId, options) => {
      const session = SprixHttpClient.loadSession();
      const subjectId = await session.resolveSubjectId(options.subject);
      const bank = loadSprixAnswerBank(subjectId);
      const maxChapters = options.maxChapters === undefined
        ? null
        : Number.parseInt(options.maxChapters, 10);
      if (options.maxChapters !== undefined &&
          (!Number.isInteger(maxChapters) || maxChapters < 1 || String(maxChapters) !== String(options.maxChapters).trim())) {
        throw new Error('--max-chapters must be a positive integer.');
      }
      if (options.complete && options.answersOnly) {
        throw new Error('Use either --complete or --answers-only, not both.');
      }

      const complete = chapterId
        ? Boolean(options.complete)
        : !Boolean(options.answersOnly);

      const result = await solveSprixCourse(session, bank, {
        subjectId,
        chapterId: chapterId || null,
        dryRun: Boolean(options.dryRun),
        single: Boolean(options.single),
        maxChapters,
        skipCompleted: options.skipCompleted !== false,
        complete,
        chapterDelayMs: parseSolvePause(options.pauseBetweenChapters, 'Chapter pause'),
        questionDelayMs: parseSolvePause(options.pauseBetweenQuestions, 'Question pause'),
        onProgress: message => console.log(message),
        onConfirm: details => confirmSprixSolve(details, Boolean(options.yes))
      });
      return result.summary;
    });
}

export function registerSprixSolverCommands(sprix) {
  registerBankCommands(sprix);
  registerSolveCommand(sprix);
}
