import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { SprixHttpClient } from './sprixHttp.js';

const SPRIX_DIR = path.join(DATA_DIR, 'sprix');
export const SPRIX_BANK_PATH = path.join(SPRIX_DIR, 'answer-bank.json');

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
  while (/\s/u.test(text[start] || '')) {}
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

export function loadSprixAnswerBank() {
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

function bestMatch(target, candidates, getText, { minimumScore, minimumMatches, margin } = {}) {
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
    question.text || question.title || question.content || question.description ||
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
  const answeredBank = bank.questions.filter(question => question.answer);
  const plan = [];
  const unmatched = [];

  for (const block of pending) {
    const prompt = blockPrompt(block);
    const options = Array.isArray(block.options) ? block.options : [];
    if (!prompt || !options.length) {
      unmatched.push({ blockId: block.id, prompt, reason: 'question prompt or options are missing' });
      continue;
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
      margin: 0.025
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

function saveBank(bank) {
  fs.mkdirSync(SPRIX_DIR, { recursive: true });
  const temporaryPath = SPRIX_BANK_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(bank, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, SPRIX_BANK_PATH);
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

  bank.command('status')
    .description('Show counts from the local SPRIX answer bank')
    .action(() => {
      const data = loadSprixAnswerBank();
      console.log('Units: ' + data.unit_count);
      console.log('Questions: ' + data.total);
      console.log('With answer notes: ' + data.answered);
      console.log('Without answer notes: ' + data.unanswered);
      console.log('Imported from: ' + data.source);
      console.log('Stored locally: ' + SPRIX_BANK_PATH);
    });
}

function registerSolveCommand(sprix) {
  sprix.command('solve <chapterId>')
    .description('Match pending chapter questions against your local bank and optionally submit high-confidence answers')
    .option('--yes', 'Submit the previewed answers to SPRIX')
    .option('--complete', 'Complete the chapter after all answers are accepted')
    .action(async (chapterId, options) => {
      const bank = loadSprixAnswerBank();
      const session = SprixHttpClient.loadSession();
      const data = await session.getChapterBlocks(chapterId);
      const result = buildSprixChapterPlan(data, bank);

      console.log('Chapter #' + chapterId + (result.chapter ? ' | ' + result.chapter : ''));
      console.log('Pending questions: ' + result.pendingQuestionCount + ' | Ready to answer: ' + result.plan.length);
      for (const entry of result.plan) {
        console.log('\\n[match] block #' + entry.blockId + ' -> option #' + entry.optionId);
        console.log('  Question: ' + entry.prompt);
        console.log('  Bank answer: ' + entry.bankAnswer);
        console.log('  Option: ' + entry.optionText);
        console.log('  Confidence: question ' + entry.questionScore.toFixed(3) + ', option ' + entry.optionScore.toFixed(3));
      }
      if (result.unmatched.length) {
        console.log('\\nUnmatched:');
        for (const item of result.unmatched) {
          console.log('  block #' + item.blockId + ': ' + item.reason + (item.prompt ? ' | ' + item.prompt : ''));
        }
      }

      if (!options.yes) {
        console.log('\\nDry run only. No answers were submitted. Review the matches, then repeat with --yes.');
        return;
      }
      if (result.unmatched.length) {
        throw new Error('At least one pending question could not be matched safely. No answers were submitted.');
      }
      if (result.pendingQuestionCount === 0) {
        console.log('No pending multiple-choice questions were found.');
      }

      for (let index = 0; index < result.plan.length; index++) {
        const entry = result.plan[index];
        const response = await session.answerChapterQuestion(chapterId, entry.blockId, entry.optionId, 0);
        if (response.data?.is_correct !== true) {
          throw new Error('SPRIX did not confirm block #' + entry.blockId + ' as correct. Stopped after ' + index + ' accepted answer(s).');
        }
        console.log('Accepted ' + (index + 1) + '/' + result.plan.length + ': block #' + entry.blockId + '.');
      }

      if (options.complete) {
        printCompletion(await session.completeChapter(chapterId), chapterId);
      } else {
        console.log('All matched answers were accepted. Run sprix complete ' + chapterId + ' --yes when you are ready.');
      }
    });
}

function printCompletion(result, chapterId) {
  console.log('Chapter ' + chapterId + ' completion request accepted.');
  if (result.data?.star_score !== undefined) console.log('Star score: ' + result.data.star_score);
}

export function registerSprixSolverCommands(sprix) {
  registerBankCommands(sprix);
  registerSolveCommand(sprix);
}
