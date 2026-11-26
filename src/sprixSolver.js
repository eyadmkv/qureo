import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
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
        if (itemType !== 'chapter' && itemType !== 'review') continue;
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
    throw new Error('No SPRIX chapters or reviews were found in the curriculum.');
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
      summary: 'All SPRIX chapters and reviews are already complete.'
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
      ? 'all remaining chapters and reviews'
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

  const resolvedSubjectId = await session.resolveSubjectId(subjectId);
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
      questionsSubmitted: 0,
      skippedCompleted: selection.skippedCompleted
    };
  }

  const selectedChapters = selection.items.filter(item => item.itemType === 'chapter');
  const selectedReviews = selection.items.filter(item => item.itemType === 'review');
  const first = selection.items[0];
  const last = selection.items[selection.items.length - 1];
  onProgress(
    'SPRIX progress: selected ' + selection.selectionLabel +
    ' (' + selectedChapters.length + ' chapter(s), ' + selectedReviews.length + ' review(s)).'
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
    complete
  })) {
    const summary = 'Solve cancelled. No answers or review completions were submitted.';
    onProgress(summary);
    return {
      summary,
      chaptersProcessed: 0,
      chaptersCompleted: 0,
      reviewsProcessed: 0,
      reviewsCompleted: 0,
      questionsSubmitted: 0,
      skippedCompleted: selection.skippedCompleted,
      cancelled: true
    };
  }

  let chaptersProcessed = 0;
  let chaptersCompleted = 0;
  let reviewsProcessed = 0;
  let reviewsCompleted = 0;
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
    ? 'Preview complete: ' + chaptersProcessed + ' chapter(s) and ' + reviewsProcessed +
      ' review(s) inspected; no answers submitted.'
    : 'Solve run complete: ' + chaptersProcessed + ' chapter(s) processed, ' +
      questionsSubmitted + ' answer(s) accepted, ' + reviewsCompleted + ' review(s) completed' +
      (complete ? ', ' + chaptersCompleted + ' chapter(s) completed.' : ', chapter and review completion disabled.');
  onProgress(summary);
  return {
    summary,
    chaptersProcessed,
    chaptersCompleted,
    reviewsProcessed,
    reviewsCompleted,
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

async function confirmSprixSolve({ chapters, reviews, complete }, yes) {
  if (yes) return true;
  if (!stdin.isTTY) {
    throw new Error('SPRIX solve will submit answers and complete reviews. Use --yes to confirm in a non-interactive terminal, or --dry-run to preview.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const actionText = complete
      ? 'submit matched answers for ' + chapters.length + ' chapter(s), complete ' + chapters.length + ' chapter(s), and complete ' + reviews.length + ' review(s)'
      : 'submit matched answers for ' + chapters.length + ' chapter(s) and leave chapters and reviews uncompleted';
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
    .description('Solve all remaining SPRIX chapters in curriculum order, or one selected chapter')
    .option('--subject <id>', 'SPRIX subject ID (defaults to the saved course)')
    .option('--dry-run', 'Preview selected chapters without submitting answers')
    .option('--yes', 'Confirm the run without an interactive prompt')
    .option('--single', 'Solve the first unfinished chapter and its preceding reviews')
    .option('--max-chapters <count>', 'Stop after this many chapters')
    .option('--no-skip-completed', 'Revisit completed chapters in the selected work')
    .option('--complete', 'Complete an explicitly selected chapter after its answers are accepted')
    .option('--answers-only', 'Submit answers without completing chapters during a course-wide run')
    .option('--pause-between-chapters <seconds>', 'Wait between completed chapters', '0')
    .option('--pause-between-questions <seconds>', 'Wait between submitted answers', '0')
    .action(async (chapterId, options) => {
      const bank = loadSprixAnswerBank();
      const session = SprixHttpClient.loadSession();
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
        subjectId: options.subject,
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
