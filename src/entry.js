#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { QureoHttpClient } from './http.js';
import { getStats, listApiCourses, listApiChapters } from './db.js';
import { DB_PATH } from './paths.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(ROOT, 'qureo.config.json');
const HISTORY_PATH = path.join(DATA, 'command-history.json');
const DEFAULT = { theme: 'auto', progressBars: true, commandSuggestions: true, historyLimit: 100, dashboard: { compact: false } };
const THEMES = {
  auto: ['36','32','33','90'], cyan: ['36','32','33','90'],
  green: ['32','92','91','90'], amber: ['33','32','91','90'],
  monochrome: ['37','37','37','90'], none: null
};
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT, null, 2) + '\n');
  const value = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return { ...DEFAULT, ...value, dashboard: { ...DEFAULT.dashboard, ...(value.dashboard || {}) } };
}
function writeConfig(value) {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_PATH);
}
function paint(value, tone, config) {
  const colors = THEMES[config.theme] ?? THEMES.auto;
  if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined || !colors) return String(value);
  const code = colors[{ primary: 0, success: 1, warning: 2, muted: 3 }[tone] ?? 0];
  return '\x1b[' + code + 'm' + value + '\x1b[0m';
}
function progressBar(value, total, width, config) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const filled = Math.round(ratio * width);
  return paint('█'.repeat(filled), 'success', config) + paint('░'.repeat(width - filled), 'muted', config) + ' ' + Math.round(ratio * 100) + '%';
}
function heading(title, config) {
  console.log(paint('─'.repeat(34), 'primary', config));
  console.log(paint('  ' + title, 'primary', config));
  console.log(paint('─'.repeat(34), 'primary', config));
}
function historyRows() {
  try { return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch { return []; }
}
function recordHistory(args, config) {
  if (!args.length || ['history','completion'].includes(args[0])) return;
  const command = args[0] === 'answer' || args[0] === 'answers' ? args.slice(0, 2).join(' ') : args[0];
  const rows = historyRows();
  rows.push({ command, at: new Date().toISOString() });
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(rows.slice(-Math.max(10, config.historyLimit)), null, 2));
}
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
function showHistory(config) {
  heading('RECENT COMMANDS', config);
  const rows = historyRows().slice(-30).reverse();
  if (!rows.length) return console.log('  No command history yet.');
  for (const row of rows) console.log('  ' + row.at + '  ' + row.command);
}
function dashboard(config) {
  const stats = getStats();
  const courses = listApiCourses();
  const chapters = listApiChapters();
  heading('QUREO DASHBOARD', config);
  console.log('  Cached courses   ' + stats.apiCourses);
  console.log('  Cached chapters  ' + stats.apiChapters);
  console.log('  Cached questions ' + stats.apiQuestions);
  console.log('  Saved answers    ' + stats.customAnswers);
  console.log('');
  if (!courses.length || !chapters.length) return console.log('  No progress cached. Run qureo sync.');
  for (const course of courses) {
    const rows = chapters.filter(item => item.course_id === course.course_id);
    const completed = rows.filter(item => item.completed).length;
    console.log('  ' + (course.title || course.course_id));
    console.log('  ' + progressBar(completed, rows.length, 26, config) + '  ' + completed + '/' + rows.length);
  }
}
function status(config) {
  const session = fs.existsSync(path.join(DATA, 'session.dpapi'));
  const chapters = listApiChapters();
  heading('QUREO STATUS', config);
  console.log('  Session file  ' + paint(session ? 'present' : 'missing', session ? 'success' : 'warning', config));
  console.log('  Courses       ' + listApiCourses().length);
  console.log('  Chapters      ' + chapters.length);
  console.log('  Completed     ' + chapters.filter(item => item.completed).length + '/' + chapters.length);
  console.log('  Node          ' + process.version);
  console.log('  Platform      ' + os.platform() + ' ' + os.arch());
}
async function doctor(config) {
  heading('QUREO DOCTOR', config);
  const checks = [
    ['Node.js >= 22', Number(process.versions.node.split('.')[0]) >= 22],
    ['Windows DPAPI platform', process.platform === 'win32'],
    ['SQLite database', fs.existsSync(DB_PATH)],
    ['Encrypted session', fs.existsSync(path.join(DATA, 'session.dpapi'))],
    ['Configuration file', fs.existsSync(CONFIG_PATH)]
  ];
  let failures = 0;
  for (const item of checks) {
    console.log('  ' + paint(item[1] ? 'PASS' : 'FAIL', item[1] ? 'success' : 'warning', config) + '  ' + item[0]);
    if (!item[1]) failures++;
  }
  if (fs.existsSync(path.join(DATA, 'session.dpapi'))) {
    try {
      await QureoHttpClient.loadSession().getUserInfo();
      console.log('  ' + paint('PASS', 'success', config) + '  QUREO portal authentication');
    } catch (error) {
      failures++;
      console.log('  ' + paint('FAIL', 'warning', config) + '  QUREO authentication: ' + error.message);
    }
  }
  console.log(failures ? '\n  ' + failures + ' check(s) need attention.' : '\n  All checks passed.');
  if (failures) process.exitCode = 1;
}
function completion() {
  const script = [
    "Register-ArgumentCompleter -CommandName qureo -Native -ScriptBlock {",
    "  param($wordToComplete, $commandAst, $cursorPosition)",
    "  $commands = @('login','logout','me','check','courses','sync','export','solve','lessons','progress','chapter','questions','result','answers','answer','search','exercises','stats','database','dashboard','doctor','status','config','history','completion')",
    '  $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, "Command", $_) }',
    "}"
  ].join('\n') + '\n';
  const profile = path.join(os.homedir(), 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
  if (process.argv.includes('--install')) {
    fs.mkdirSync(path.dirname(profile), { recursive: true });
    const current = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
    if (!current.includes('Register-ArgumentCompleter -CommandName qureo')) fs.appendFileSync(profile, '\n' + script);
    console.log('PowerShell completion installed: ' + profile);
  } else {
    console.log(script);
    console.log('Install with: qureo completion powershell --install');
  }
}
async function main() {
  const args = process.argv.slice(2);
  const config = readConfig();
  recordHistory(args, config);
  const originalLog = console.log.bind(console);
  if (config.progressBars && process.stdout.isTTY) {
    console.log = (...values) => {
      const line = values.map(value => String(value)).join(' ');
      const match = line.match(/submitted (\\d+)\\/(\\d+)/);
      if (match) {
        originalLog('  Questions ' + progressBar(Number(match[1]), Number(match[2]), 22, config) + '  ' + line.trim());
      } else originalLog(...values);
    };
  }
  const command = args[0];
  if (!command || command === '--help' || command === '-h' || command === '--version' || command === '-V') return import('./cli.js');
  if (command === 'dashboard') return dashboard(config);
  if (command === 'status') return status(config);
  if (command === 'doctor') return doctor(config);
  if (command === 'history') return showHistory(config);
  if (command === 'completion' && args[1] === 'powershell') return completion();
  if (command === 'config') {
    if (!args[1] || args[1] === 'show') return console.log(JSON.stringify(config, null, 2));
    if (args[1] !== 'set' || !args[2] || args[3] === undefined) throw new Error('Usage: qureo config set <key> <value>');
    const key = args[2], raw = args[3];
    const allowed = ['theme','progressBars','commandSuggestions','historyLimit','dashboard.compact'];
    if (!allowed.includes(key)) throw new Error('Unsupported configuration key: ' + key);
    const value = raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
    if (key === 'theme' && !['auto','cyan','green','amber','monochrome','none'].includes(value)) throw new Error('Invalid theme.');
    if (key === 'dashboard.compact') config.dashboard.compact = Boolean(value);
    else config[key] = value;
    writeConfig(config);
    console.log('Updated ' + key + ' in qureo.config.json');
    return;
  }
  const known = ['login','logout','me','check','courses','sync','export','solve','lessons','progress','chapter','questions','result','answers','answer','search','exercises','stats','database'];
  if (!known.includes(command)) {
    if (config.commandSuggestions) {
      const all = known.concat(['dashboard','doctor','status','config','history','completion']);
      const best = all.map(value => ({ value, score: distance(command, value) })).sort((a,b) => a.score-b.score)[0];
      console.error(best.score <= Math.max(2, Math.floor(command.length / 3))
        ? 'Unknown command "' + command + '". Did you mean "qureo ' + best.value + '"?'
        : 'Unknown command "' + command + '". Run qureo --help.');
    } else console.error('Unknown command. Run qureo --help.');
    process.exitCode = 2;
    return;
  }
  return import('./cli.js');
}
main().catch(error => { console.error('Error: ' + error.message); process.exitCode = 1; });
