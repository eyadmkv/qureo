import fs from 'node:fs';
import {
  SPRIX_ORIGIN,
  SprixHttpClient,
  parseSprixCookieHeader,
  readSprixClipboard
} from './sprixHttp.js';

function client() {
  return SprixHttpClient.loadSession();
}

function requireConfirmation(options, action) {
  if (!options.yes) throw new Error(action + ' changes your SPRIX account. Review the IDs, then repeat the command with --yes.');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function itemName(item) {
  return item.title || item.name || (item.item_type ? item.item_type + ' #' + item.id : 'Item #' + item.id);
}

function sectionsOf(unit) {
  if (Array.isArray(unit.sections) && unit.sections.length > 0) return unit.sections;
  if (Array.isArray(unit.items)) return [{ items: unit.items }];
  return [];
}

function listCurriculum(units) {
  let count = 0;
  for (const unit of units) {
    console.log('\n' + (unit.title || unit.name || 'Unit') + (unit.is_accessible === false ? ' [locked]' : ''));
    for (const section of sectionsOf(unit)) {
      for (const item of section.items || []) {
        count++;
        const flags = [
          item.is_completed ? 'completed' : null,
          item.is_unlocked ? 'unlocked' : null,
          item.is_accessible === false ? 'inaccessible' : null
        ].filter(Boolean).join(', ');
        console.log('  ' + String(item.item_type || 'item').padEnd(8) + ' #' + item.id + '  ' + itemName(item) + (flags ? '  [' + flags + ']' : ''));
      }
    }
  }
  console.log('\n' + units.length + ' unit(s), ' + count + ' learning item(s).');
}

function listBlocks(chapterId, data) {
  const chapter = data.chapter || {};
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];
  const cleared = new Set(Array.isArray(chapter.cleared_block_ids) ? chapter.cleared_block_ids : []);
  console.log('Chapter #' + chapterId + (chapter.title ? ' | ' + chapter.title : ''));
  console.log('Cleared blocks: ' + cleared.size + ' | Total blocks: ' + blocks.length);
  for (const block of blocks) {
    const question = block.question || {};
    const prompt = question.text || question.title || question.content || question.prompt || block.text || block.description || '';
    const isQuestion = block.type === 'question' || (question && Array.isArray(block.options));
    console.log('\n' + (cleared.has(block.id) ? '[cleared]' : '[pending]') + ' block #' + block.id + ' | ' + (block.type || question.type || 'content'));
    if (prompt) console.log(String(prompt).replace(/\s+/gu, ' ').trim());
    if (isQuestion) {
      for (const option of block.options || []) {
        const label = option.text || option.title || option.content || option.label || option.name || '';
        console.log('  option #' + option.id + ': ' + String(label).replace(/\s+/gu, ' ').trim());
      }
    }
  }
}

function renderTest(data) {
  const questions = [...(data.test_questions || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const existing = new Map((data.question_responses || []).map(row => [row.test_question_id, row]));
  console.log('Test attempt opened. Questions: ' + questions.length);
  for (const row of questions) {
    const questionId = String(row.question_id);
    const question = data.questions?.[questionId] || {};
    const options = data.options?.[questionId] || [];
    const response = existing.get(row.id);
    const prompt = question.text || question.title || question.content || question.prompt || question.question || '';
    console.log('\nTest question #' + row.id + ' | source question #' + questionId + (response?.status ? ' | ' + response.status : ''));
    if (prompt) console.log(String(prompt).replace(/\s+/gu, ' ').trim());
    for (const option of options) {
      const label = option.text || option.title || option.content || option.label || option.name || '';
      console.log('  option #' + option.id + ': ' + String(label).replace(/\s+/gu, ' ').trim());
    }
  }
  console.log('\nUse the test-question ID and option ID with: sprix test answer <testId> <testQuestionId> <optionId> --yes');
  console.log('Submit only after reviewing your answers: sprix test submit <testId> --yes');
}

function registerSessionCommands(sprix) {
  sprix.command('login')
    .description('Import your signed-in SPRIX browser session from a copied cURL request')
    .option('--clipboard', 'Read the copied cURL request from the Windows clipboard')
    .option('--cookie-file <path>', 'Read a Cookie header or cURL command from a UTF-8 file')
    .option('--origin <url>', 'SPRIX origin', SPRIX_ORIGIN)
    .option('--subject <id>', 'Subject ID to validate', '7')
    .action(async options => {
      if (Boolean(options.clipboard) === Boolean(options.cookieFile)) {
        throw new Error('Choose exactly one source: --clipboard or --cookie-file <path>.');
      }
      const raw = options.clipboard
        ? readSprixClipboard()
        : fs.readFileSync(options.cookieFile, 'utf8');
      const cookie = parseSprixCookieHeader(raw);
      const session = new SprixHttpClient({ cookie, origin: options.origin });
      const curriculum = await session.getCurriculum(options.subject);
      session.saveSession({ subjectId: Number(options.subject), validated: true });
      console.log('SPRIX session validated.');
      console.log('Imported session saved encrypted with Windows DPAPI.');
      console.log('Subject ' + options.subject + ': ' + curriculum.length + ' unit(s) available.');
      console.log('The copied cURL command and Cookie header were not printed or sent to ChatGPT.');
    });

  sprix.command('logout')
    .description('Delete the locally saved SPRIX session')
    .action(() => {
      SprixHttpClient.clearSession();
      console.log('Saved SPRIX session removed.');
    });

  const session = sprix.command('session').description('Inspect the saved SPRIX session');
  session.command('status')
    .description('Validate the local session with a read-only curriculum request')
    .option('--subject <id>', 'Subject ID to check', '7')
    .action(async options => {
      if (!SprixHttpClient.hasSession()) return console.log('No saved SPRIX session. Run sprix login --clipboard.');
      const curriculum = await client().getCurriculum(options.subject);
      console.log('SPRIX session: valid');
      console.log('Subject ' + options.subject + ': ' + curriculum.length + ' unit(s).');
    });
}

function registerReadCommands(sprix) {
  sprix.command('curriculum [subjectId]')
    .description('Fetch the live SPRIX subject curriculum and completion state')
    .option('--json', 'Print the full JSON response')
    .action(async (subjectId = '7', options) => {
      const units = await client().getCurriculum(subjectId);
      if (options.json) printJson(units);
      else listCurriculum(units);
    });

  sprix.command('chapter <chapterId>')
    .description('Fetch the chapter blocks, question text, option IDs and completion state')
    .option('--json', 'Print the full JSON response')
    .action(async (chapterId, options) => {
      const data = await client().getChapterBlocks(chapterId);
      if (options.json) printJson(data);
      else listBlocks(chapterId, data);
    });

  const review = sprix.command('review').description('Read or complete SPRIX review items');
  review.command('items <reviewId>')
    .description('Fetch review items')
    .option('--json', 'Print the full JSON response')
    .action(async (reviewId, options) => {
      const result = await client().getReviewItems(reviewId);
      if (options.json) printJson(result);
      else {
        const items = result.data?.items || result.data || [];
        printJson(items);
      }
    });
}

function registerMutationCommands(sprix) {
  sprix.command('answer <chapterId> <blockId> <optionId>')
    .description('Submit one option for a chapter question block')
    .option('--hint-used', 'Record that a hint was used')
    .option('--yes', 'Confirm this account-changing request')
    .action(async (chapterId, blockId, optionId, options) => {
      requireConfirmation(options, 'Submitting a chapter answer');
      const result = await client().answerChapterQuestion(chapterId, blockId, optionId, options.hintUsed ? 1 : 0);
      printJson(result);
    });

  sprix.command('complete <chapterId>')
    .description('Mark a chapter complete through the SPRIX API')
    .option('--yes', 'Confirm this account-changing request')
    .action(async (chapterId, options) => {
      requireConfirmation(options, 'Completing a chapter');
      printJson(await client().completeChapter(chapterId));
    });

  const review = sprix.commands.find(command => command.name() === 'review');
  review.command('complete <reviewId>')
    .description('Complete a review')
    .option('--yes', 'Confirm this account-changing request')
    .action(async (reviewId, options) => {
      requireConfirmation(options, 'Completing a review');
      printJson(await client().completeReview(reviewId));
    });

  const test = sprix.command('test').description('Manage a SPRIX test attempt');
  test.command('start <testId>')
    .description('Start a test attempt and display its questions and options')
    .option('--yes', 'Confirm that a new test attempt will be opened')
    .action(async (testId, options) => {
      requireConfirmation(options, 'Starting a test attempt');
      const result = await client().startTest(testId);
      if (!result.data) return printJson(result);
      renderTest(result.data);
    });

  test.command('answer <testId> <testQuestionId> <optionId>')
    .description('Save one selected option in the active test attempt')
    .option('--yes', 'Confirm this account-changing request')
    .action(async (testId, testQuestionId, optionId, options) => {
      requireConfirmation(options, 'Saving a test answer');
      printJson(await client().answerTestQuestion(testId, testQuestionId, optionId));
    });

  test.command('submit <testId>')
    .description('Submit the active test attempt for grading')
    .option('--yes', 'Confirm that this test attempt will be submitted')
    .action(async (testId, options) => {
      requireConfirmation(options, 'Submitting a test');
      printJson(await client().submitTest(testId));
    });

  const achievements = sprix.command('achievements').description('SPRIX achievement operations');
  achievements.command('unlock <subjectId>')
    .description('Request achievement unlock processing for a subject')
    .option('--yes', 'Confirm this account-changing request')
    .action(async (subjectId, options) => {
      requireConfirmation(options, 'Unlocking achievements');
      printJson(await client().unlockAchievements(subjectId));
    });
}

export function registerSprixApiCommands(sprix) {
  registerSessionCommands(sprix);
  registerReadCommands(sprix);
  registerMutationCommands(sprix);
}
