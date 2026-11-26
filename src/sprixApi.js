import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { DATA_DIR } from './paths.js';
import { askHidden } from './hiddenInput.js';
import {
  SPRIX_ORIGIN,
  SprixHttpClient,
  parseSprixCookieHeader,
  readSprixClipboard,
  parseSprixCurlRequest
} from './sprixHttp.js';

const SPRIX_DIR = path.join(DATA_DIR, 'sprix');
const CURRICULUM_CACHE = path.join(SPRIX_DIR, 'curriculum.json');

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
    const prompt = question.question_text || question.text || question.title || question.content || question.prompt || block.text || block.description || '';
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
    const prompt = question.question_text || question.text || question.title || question.content || question.prompt || question.question || '';
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

async function promptLoginId() {
  if (!stdin.isTTY) throw new Error('Interactive SPRIX login requires a PowerShell terminal.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question('SPRIX Login ID: ')).trim();
  } finally {
    rl.close();
  }
}

function printLoginSuccess(subjectId, unitCount) {
  console.log('SPRIX login successful.');
  console.log('Session validated against subject ' + subjectId + ': ' + unitCount + ' unit(s) available.');
  console.log('Session cookies saved encrypted with Windows DPAPI. Your password was not stored.');
}


function registerDiagnosticCommands(sprix) {
  sprix.command('inspect-action')
    .description('Safely inspect a copied SPRIX cURL request, with credentials and tokens redacted')
    .action(() => {
      const parsed = parseSprixCurlRequest(readSprixClipboard());
      printJson(parsed);
      console.log('\nOnly the sanitized output above is safe to share. Never paste the raw cURL command.');
    });
}

function registerSessionCommands(sprix) {
  sprix.command('login')
    .description('Sign in with your SPRIX Login ID and password, or import an existing browser session')
    .option('--login-id <id>', 'SPRIX Login ID; the password is always prompted securely')
    .option('--clipboard', 'Import a copied authenticated request as a fallback')
    .option('--cookie-file <path>', 'Import a Cookie header or cURL command from a UTF-8 file')
    .option('--origin <url>', 'SPRIX origin', SPRIX_ORIGIN)
    .option('--subject <id>', 'Subject ID to validate (auto-detected when omitted)')
    .action(async options => {
      const cookieMode = Boolean(options.clipboard || options.cookieFile);
      if (cookieMode && (Boolean(options.clipboard) === Boolean(options.cookieFile) || options.loginId)) {
        throw new Error('Choose either password login, --clipboard, or --cookie-file <path>.');
      }

      if (!cookieMode) {
        const loginId = options.loginId || await promptLoginId();
        if (!loginId) throw new Error('SPRIX Login ID is required.');
        let password = await askHidden('SPRIX password: ');
        if (!password) throw new Error('SPRIX password is required.');

        try {
          const result = await SprixHttpClient.login({
            loginId,
            password,
            origin: options.origin,
            subjectId: options.subject
          });
          result.session.saveSession({
            subjectId: result.subjectId,
            validated: true,
            authMethod: 'password'
          });
          printLoginSuccess(result.subjectId, result.curriculum.length);
        } finally {
          password = '';
        }
        return;
      }

      const raw = options.clipboard
        ? readSprixClipboard()
        : fs.readFileSync(options.cookieFile, 'utf8');
      const cookie = parseSprixCookieHeader(raw);
      const session = new SprixHttpClient({ cookie, origin: options.origin });
      const subjectId = await session.resolveSubjectId(options.subject);
      const curriculum = await session.getCurriculum(subjectId);
      session.saveSession({
        subjectId,
        validated: true,
        authMethod: 'browser-cookie-import'
      });
      printLoginSuccess(subjectId, curriculum.length);
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
    .option('--subject <id>', 'Subject ID to check (defaults to the saved course)')
    .action(async options => {
      if (!SprixHttpClient.hasSession()) return console.log('No saved SPRIX session. Run sprix login.');
      const session = client();
      const subjectId = await session.resolveSubjectId(options.subject);
      const curriculum = await session.getCurriculum(subjectId);
      console.log('SPRIX session: valid');
      console.log('Subject ' + subjectId + ': ' + curriculum.length + ' unit(s).');
    });
}

function registerSyncCommands(sprix) {
  sprix.command('sync [subjectId]')
    .description('Fetch live SPRIX curriculum and save a local progress snapshot')
    .option('--json', 'Print the synced curriculum JSON')
    .action(async (subjectId, options) => {
      const session = client();
      const resolvedSubjectId = await session.resolveSubjectId(subjectId);
      const units = await session.getCurriculum(resolvedSubjectId);
      fs.mkdirSync(SPRIX_DIR, { recursive: true });
      const snapshot = {
        format: 'sprix-curriculum-snapshot',
        schema_version: 1,
        subject_id: resolvedSubjectId,
        synced_at: new Date().toISOString(),
        units
      };
      const temporaryPath = CURRICULUM_CACHE + '.tmp';
      fs.writeFileSync(temporaryPath, JSON.stringify(snapshot, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600
      });
      fs.renameSync(temporaryPath, CURRICULUM_CACHE);
      const itemCount = units.reduce((count, unit) => count + sectionsOf(unit).reduce(
        (sectionCount, section) => sectionCount + (section.items || []).length, 0
      ), 0);
      console.log('Synced subject ' + resolvedSubjectId + ': ' + units.length + ' unit(s), ' + itemCount + ' learning item(s).');
      console.log('Saved locally: ' + CURRICULUM_CACHE);
      if (options.json) printJson(snapshot);
    });

  sprix.command('progress')
    .description('Show the most recently synced SPRIX completion summary')
    .action(() => {
      if (!fs.existsSync(CURRICULUM_CACHE)) throw new Error('No SPRIX curriculum snapshot. Run sprix sync first.');
      let snapshot;
      try { snapshot = JSON.parse(fs.readFileSync(CURRICULUM_CACHE, 'utf8')); }
      catch { throw new Error('The local SPRIX curriculum snapshot is invalid. Run sprix sync again.'); }
      if (snapshot?.format !== 'sprix-curriculum-snapshot' || !Array.isArray(snapshot.units)) {
        throw new Error('The local SPRIX curriculum snapshot has an unsupported format. Run sprix sync again.');
      }
      let completed = 0;
      let total = 0;
      for (const unit of snapshot.units) {
        const items = sectionsOf(unit).flatMap(section => section.items || []);
        const unitCompleted = items.filter(item => item.is_completed).length;
        completed += unitCompleted;
        total += items.length;
        const percent = items.length ? Math.round(unitCompleted * 100 / items.length) : 0;
        console.log((unit.title || unit.name || 'Unit') + ': ' + unitCompleted + '/' + items.length + ' (' + percent + '%)');
      }
      const percent = total ? Math.round(completed * 100 / total) : 0;
      console.log('\nOverall: ' + completed + '/' + total + ' (' + percent + '%)');
      console.log('Last synced: ' + snapshot.synced_at);
    });
}

function registerReadCommands(sprix) {
  sprix.command('curriculum [subjectId]')
    .description('Fetch the live SPRIX subject curriculum and completion state')
    .option('--json', 'Print the full JSON response')
    .action(async (subjectId, options) => {
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
  registerDiagnosticCommands(sprix);
  registerSessionCommands(sprix);
  registerSyncCommands(sprix);
  registerReadCommands(sprix);
  registerMutationCommands(sprix);
}
