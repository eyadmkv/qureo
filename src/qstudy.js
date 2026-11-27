import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';
import { QureoHttpClient } from './http.js';
import { SprixHttpClient } from './sprixHttp.js';
import { askHidden } from './hiddenInput.js';
import { getStats, listApiCourses, listApiChapters } from './db.js';
import { DATA_DIR, SESSION_PATH } from './paths.js';

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SPRIX_DIR = path.join(DATA_DIR, 'sprix');
const SPRIX_SESSION_PATH = path.join(SPRIX_DIR, 'session.dpapi');
const SPRIX_CURRICULUM_PATH = path.join(SPRIX_DIR, 'curriculum.json');
const SPRIX_STUDY_PATH = path.join(SPRIX_DIR, 'study.json');
const VERSION = '0.6.0';
const COLORS = {
  accent: '\u001b[36m',
  success: '\u001b[32m',
  warning: '\u001b[33m',
  muted: '\u001b[90m',
  reset: '\u001b[0m'
};

function color(value, tone = 'accent') {
  if (!stdout.isTTY || process.env.NO_COLOR !== undefined) return String(value);
  return COLORS[tone] + String(value) + COLORS.reset;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sectionsOf(unit) {
  if (Array.isArray(unit?.sections) && unit.sections.length) return unit.sections;
  if (Array.isArray(unit?.items)) return [{ items: unit.items }];
  return [];
}

export function summarizeSprixCurriculum(snapshot) {
  if (!snapshot || snapshot.format !== 'sprix-curriculum-snapshot' || !Array.isArray(snapshot.units)) return null;
  const units = snapshot.units.map((unit, index) => {
    const items = sectionsOf(unit).flatMap(section => Array.isArray(section?.items) ? section.items : []);
    const completed = items.filter(item => item?.is_completed === true).length;
    return {
      id: unit.id ?? null,
      title: unit.title || unit.name || 'Unit ' + (index + 1),
      completed,
      total: items.length,
      percent: items.length ? Math.round(completed * 100 / items.length) : 0
    };
  });
  const completed = units.reduce((sum, unit) => sum + unit.completed, 0);
  const total = units.reduce((sum, unit) => sum + unit.total, 0);
  return {
    units,
    completed,
    total,
    percent: total ? Math.round(completed * 100 / total) : 0,
    syncedAt: snapshot.synced_at || null,
    subjectId: snapshot.subject_id ?? null
  };
}

export function formatProgressBar(completed, total, width = 20) {
  const safeWidth = Number.isInteger(width) && width > 0 ? Math.min(width, 80) : 20;
  const ratio = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
  const filled = Math.round(ratio * safeWidth);
  const percent = total > 0 ? Math.round(ratio * 100) : 0;
  return '[' + '█'.repeat(filled) + '░'.repeat(safeWidth - filled) + '] ' + percent + '%';
}

function section(title) {
  console.log('');
  console.log(color('  ' + title, 'accent'));
  console.log(color('  ' + '─'.repeat(Math.max(22, title.length + 2)), 'muted'));
}

function printDashboard({ compact = false } = {}) {
  const stats = getStats();
  const courses = listApiCourses();
  const chapters = listApiChapters();
  const sprix = summarizeSprixCurriculum(readJson(SPRIX_CURRICULUM_PATH));
  const study = readJson(SPRIX_STUDY_PATH);
  const captures = Array.isArray(study?.captures) ? study.captures.length : 0;
  const capturedQuestions = Array.isArray(study?.questions) ? study.questions.length : 0;

  console.log('');
  console.log(color('  QSTUDY', 'accent') + color('  /  UNIFIED LEARNING DASHBOARD', 'muted'));
  console.log(color('  ' + '═'.repeat(38), 'muted'));

  section('CONNECTED SERVICES');
  console.log('  QUREO    ' + (fs.existsSync(SESSION_PATH) ? color('SESSION SAVED', 'success') : color('NOT CONNECTED', 'warning')));
  console.log('  SPRIX    ' + (fs.existsSync(SPRIX_SESSION_PATH) ? color('SESSION SAVED', 'success') : color('NOT CONNECTED', 'warning')));

  section('QUREO');
  console.log('  Cached courses: ' + stats.apiCourses + '   Chapters: ' + stats.apiChapters);
  if (courses.length) {
    for (const course of courses) {
      const rows = chapters.filter(row => String(row.course_id) === String(course.course_id));
      const completed = rows.filter(row => row.completed).length;
      console.log('  ' + (course.title || course.course_id));
      console.log('    ' + formatProgressBar(completed, rows.length, compact ? 12 : 20) +
        '  ' + completed + '/' + rows.length + ' chapters');
    }
  } else {
    console.log('  No cached course data. Run qstudy sync.');
  }

  section('SPRIX');
  if (sprix) {
    console.log('  Subject ' + (sprix.subjectId ?? 'unknown') + '  |  ' + sprix.completed + '/' + sprix.total + ' items');
    for (const unit of sprix.units) {
      console.log('  ' + unit.title);
      console.log('    ' + formatProgressBar(unit.completed, unit.total, compact ? 12 : 20) +
        '  ' + unit.completed + '/' + unit.total);
    }
    if (sprix.syncedAt) console.log('  Last sync: ' + sprix.syncedAt);
  } else {
    console.log('  No curriculum snapshot. Run qstudy sync.');
  }

  section('LOCAL DATA');
  console.log('  QUREO   ' + stats.apiQuestions + ' cached questions  |  ' + stats.customAnswers + ' saved answers');
  console.log('  SPRIX   ' + captures + ' captured lessons  |  ' + capturedQuestions + ' captured questions');
  console.log('  DATA    ' + DATA_DIR);
  console.log('');
  console.log(color('  qstudy qureo --help   qstudy sprix --help   qstudy status', 'muted'));
}

async function promptStudentId() {
  if (!stdin.isTTY) throw new Error('Unified login requires an interactive terminal.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question('Student ID / Login ID: ')).trim();
  } finally {
    rl.close();
  }
}

async function login() {
  const studentId = await promptStudentId();
  if (!studentId) throw new Error('Student ID / Login ID cannot be empty.');
  let password = await askHidden('Shared password (hidden): ');
  if (!password) throw new Error('Password cannot be empty.');

  const qureoClient = new QureoHttpClient();
  let results;
  try {
    results = await Promise.allSettled([
      (async () => {
        const user = await qureoClient.login(studentId, password);
        qureoClient.saveSession({ studentId, displayName: user?.name || user?.student?.name || '' });
        return user;
      })(),
      (async () => {
        const result = await SprixHttpClient.login({ loginId: studentId, password });
        result.session.saveSession({
          subjectId: result.subjectId,
          validated: true,
          authMethod: 'password',
          loginId: studentId
        });
        return result;
      })()
    ]);
  } finally {
    password = '';
  }

  const [qureoResult, sprixResult] = results;
  console.log('');
  if (qureoResult.status === 'fulfilled') {
    const name = qureoResult.value?.name || qureoResult.value?.student?.name;
    console.log(color('  QUREO  connected' + (name ? ' as ' + name : ''), 'success'));
  } else {
    console.error(color('  QUREO  failed: ' + qureoResult.reason.message, 'warning'));
  }

  if (sprixResult.status === 'fulfilled') {
    console.log(color('  SPRIX  connected to subject ' + sprixResult.value.subjectId, 'success'));
  } else {
    console.error(color('  SPRIX  failed: ' + sprixResult.reason.message, 'warning'));
  }

  if (results.some(result => result.status === 'rejected')) {
    console.log('  Successful sessions were saved. Run qstudy login again to retry the failed service.');
    process.exitCode = 1;
  } else {
    console.log('  Both sessions were encrypted with Windows DPAPI. The password was not saved.');
    console.log('  Next: qstudy sync');
  }
}

async function status() {
  const checks = await Promise.all([
    (async () => {
      if (!fs.existsSync(SESSION_PATH)) throw new Error('No saved QUREO session. Run qstudy login.');
      const user = await QureoHttpClient.loadSession().getUserInfo();
      return user?.name || user?.student?.name || 'Authenticated';
    })().then(value => ({ name: 'QUREO', value }), error => ({ name: 'QUREO', error })),
    (async () => {
      if (!SprixHttpClient.hasSession()) throw new Error('No saved SPRIX session. Run qstudy login.');
      const client = SprixHttpClient.loadSession();
      const subjectId = await client.resolveSubjectId();
      const units = await client.getCurriculum(subjectId);
      return 'Subject ' + subjectId + ', ' + units.length + ' unit(s)';
    })().then(value => ({ name: 'SPRIX', value }), error => ({ name: 'SPRIX', error }))
  ]);

  console.log('');
  console.log(color('  QSTUDY SERVICE CHECK', 'accent'));
  let failures = 0;
  for (const check of checks) {
    if (check.error) {
      failures++;
      console.log('  ' + color('FAIL', 'warning') + '  ' + check.name + '  ' + check.error.message);
    } else {
      console.log('  ' + color('PASS', 'success') + '  ' + check.name + '  ' + check.value);
    }
  }
  if (failures) process.exitCode = 1;
}

function runService(service, args = []) {
  const entry = path.join(SOURCE_DIR, service === 'qureo' ? 'entry.js' : 'sprix-entry.js');
  const result = spawnSync(process.execPath, [entry, ...args], { stdio: 'inherit', windowsHide: false });
  if (result.error) throw result.error;
  return result.status === null ? 1 : result.status;
}

function forwardService(service, args) {
  const statusCode = runService(service, args);
  if (statusCode !== 0) process.exitCode = statusCode;
}

function syncServices() {
  let failed = false;
  for (const service of ['qureo', 'sprix']) {
    console.log('');
    console.log(color('  SYNC ' + service.toUpperCase(), 'accent'));
    const statusCode = runService(service, ['sync']);
    if (statusCode !== 0) {
      failed = true;
      console.error('  ' + service.toUpperCase() + ' sync exited with status ' + statusCode + '.');
    }
  }
  if (failed) process.exitCode = 1;
}

function printHelp() {
  console.log('QStudy ' + VERSION + ' | unified QUREO + SPRIX CLI');
  console.log('');
  console.log('Usage:');
  console.log('  qstudy login                 Sign in to QUREO and SPRIX with one prompt');
  console.log('  qstudy logout                Remove both saved sessions');
  console.log('  qstudy dashboard             Show combined local progress and data');
  console.log('  qstudy dashboard --refresh  Sync both platforms before showing progress');
  console.log('  qstudy sync                  Refresh QUREO and SPRIX progress');
  console.log('  qstudy status                Validate both saved sessions');
  console.log('  qstudy qureo <command>       Run an existing QUREO command');
  console.log('  qstudy sprix <command>       Run an existing SPRIX command');
  console.log('  qstudy --version             Print version');
  console.log('');
  console.log('The standalone qureo and sprix commands remain available.');
}

export function runQStudy(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === '--version' || command === '-V') {
    console.log(VERSION);
    return;
  }
  if (command === 'qureo' || command === 'sprix') {
    forwardService(command, rest);
    return;
  }
  if (command === 'login') return login();
  if (command === 'logout') {
    QureoHttpClient.clearSession();
    SprixHttpClient.clearSession();
    console.log('QUREO and SPRIX sessions removed. Local study data was kept.');
    return;
  }
  if (command === 'status') return status();
  if (command === 'sync') {
    syncServices();
    return;
  }
  if (command === 'dashboard') {
    if (rest.includes('--refresh')) syncServices();
    printDashboard({ compact: rest.includes('--compact') });
    return;
  }
  if (command === 'doctor') {
    const node = process.versions.node.split('.').map(Number);
    const nodeSupported = node[0] > 22 || (node[0] === 22 && node[1] >= 12);
    console.log('Node.js ' + process.version + ': ' + (nodeSupported ? 'supported' : 'requires 22.12 or newer'));
    console.log('Platform: ' + process.platform + ' ' + process.arch);
    console.log('Windows DPAPI: ' + (process.platform === 'win32' ? 'available' : 'Windows required'));
    console.log('QUREO session: ' + (fs.existsSync(SESSION_PATH) ? 'saved' : 'missing'));
    console.log('SPRIX session: ' + (fs.existsSync(SPRIX_SESSION_PATH) ? 'saved' : 'missing'));
    console.log('Data directory: ' + DATA_DIR);
    if (!nodeSupported || process.platform !== 'win32') process.exitCode = 1;
    return;
  }
  console.error('Unknown qstudy command: ' + command);
  printHelp();
  process.exitCode = 2;
}
