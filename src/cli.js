#!/usr/bin/env node
import { Command } from 'commander';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getStats, listExercises, listSolutions, saveApiCourse, saveApiChapter,
  saveApiQuestion, listApiCourses, listApiChapters, getApiChapter,
  saveCustomAnswer, saveRetrievedAnswer, findApiQuestion, getCustomAnswer, listCustomAnswers
} from './db.js';
import { QureoHttpClient, API_BASE, COURSE_ORIGIN } from './http.js';
import { askHidden } from './hiddenInput.js';
import { answerIndexUrl, searchAnswers, syncPublicGuides } from './publicAnswers.js';
import { DB_PATH, ROOT } from './paths.js';

const program = new Command();
program
  .name('qureo')
  .description('Private QUREO HTTP client, course index and local answer search')
  .version('0.2.2');

function outputJson(value) { console.log(JSON.stringify(value, null, 2)); }

function textOf(value) {
  if (typeof value === 'string') return value.replace(/\[\[(?:\/?(?:bdi|bold|code|italic|underline)|br)\]\]/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return '';
}

function extractQuestion(item) {
  const q = item?.question || item || {};
  const prompt = [q.text, q.title, q.content, q.description, q.body, q.question, q.prompt, q.instruction, q.question_text, item?.text, item?.description]
    .map(textOf).find(Boolean) || '';
  const choices = (item?.choices || q?.choices || []).map(c => textOf(c?.text || c?.content || c?.label || c?.name || c?.value || c?.choice?.text || c?.choice?.content)).filter(Boolean);
  const snippets = (item?.descriptions || q?.descriptions || []).map(d => textOf(d?.text || d?.description || d?.code)).filter(Boolean);
  return { id: q.id, type: q.type || 'unknown', prompt: prompt || snippets.join('\n'), choices, snippets };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.chapters)) return value.data.chapters;
  if (Array.isArray(value?.data?.questions)) return value.data.questions;
  if (Array.isArray(value?.section?.chapters)) return value.section.chapters;
  if (Array.isArray(value?.chapters)) return value.chapters;
  if (Array.isArray(value?.questions)) return value.questions;
  return [];
}

async function withClient(action) {
  const client = QureoHttpClient.loadSession();
  const user = await client.getUserInfo();
  return action(client, user);
}

async function login() {
  const rl = readline.createInterface({ input, output });
  let studentId;
  try { studentId = (await rl.question('QUREO student ID: ')).trim(); }
  finally { rl.close(); }
  if (!studentId) throw new Error('Student ID cannot be empty.');
  let password = await askHidden('QUREO password (hidden): ');
  if (!password) throw new Error('Password cannot be empty.');
  const client = new QureoHttpClient();
  try {
    console.log('\nSending login request to QUREO...');
    const user = await client.login(studentId, password);
    client.saveSession({ studentId, displayName: user?.name || user?.student?.name || '' });
    console.log(`Logged in successfully${user?.name ? ` as ${user.name}` : ''}.`);
    console.log('Session encrypted with Windows DPAPI for this Windows account.');
    console.log('Next: qureo sync');
  } finally {
    password = '';
  }
}

program.command('login')
  .description('Log in with your student ID and hidden password, without opening a browser')
  .action(login);

program.command('logout')
  .description('Delete the locally encrypted QUREO session')
  .action(() => {
    QureoHttpClient.clearSession();
    console.log('Local QUREO session deleted.');
  });

program.command('me')
  .description('Check the saved session and display your account information')
  .action(async () => withClient(async (_client, user) => {
    console.log(`Account: ${user?.name || user?.student?.name || '(name not provided)'}`);
    console.log(`Available courses: ${(user?.available_courses || []).length}`);
    for (const course of (user?.available_courses || [])) {
      console.log(`  ${course.content_id || course.id || 'unknown'} | ${course.name || course.title || ''}`);
    }
  }));

program.command('check')
  .description('Verify that both QUREO portal authentication and the learning API are responding')
  .action(async () => withClient(async client => {
    console.log('Portal authentication: OK');
    const student = await client.json('/students/me');
    console.log('Learning API authentication: OK');
    const identity = student?.student || student?.data || student;
    const displayName = identity?.name || identity?.student_name;
    if (displayName) console.log(`Learning profile: ${displayName}`);
  }));

program.command('courses')
  .description('List courses discovered from your QUREO account and local cache')
  .action(async () => {
    const rows = listApiCourses();
    if (rows.length) {
      for (const row of rows) console.log(`${row.course_id} | ${row.title} | section ${row.section_id || 'unknown'}`);
      return;
    }
    await withClient(async (_client, user) => {
      const courses = user?.available_courses || [];
      if (!courses.length) return console.log('QUREO did not return available_courses. Run qureo sync to probe the known course IDs.');
      for (const c of courses) console.log(`${c.content_id || c.id} | ${c.name || c.title || ''}`);
    });
  });

program.command('sync')
  .description('Download your course, chapter and progress metadata through GET requests')
  .action(async () => withClient(async (client, user) => {
    const fromAccount = (user?.available_courses || []).map(c => c.content_id || c.id).filter(Boolean);
    const candidates = [...new Set([...fromAccount, 'javascript_ar', 'python_short_ar', 'javascript_trial_ar', 'javascript', 'javascript_trial'])];
    let courseCount = 0;
    let chapterCount = 0;
    let failures = 0;
    for (const courseId of candidates) {
      try {
        await client.request(`${COURSE_ORIGIN}/?content_id=${encodeURIComponent(courseId)}`, { method: 'GET' });
        const courseData = await client.json(`/courses/${encodeURIComponent(courseId)}`);
        const sectionId = courseData?.basic_section?.id || courseData?.course?.basic_section?.id;
        if (!sectionId) continue;
        const sectionData = await client.json(`/sections/${encodeURIComponent(sectionId)}`);
        const progressRaw = await client.json(`/students/sections/${encodeURIComponent(sectionId)}/chapters`).catch(() => []);
        const progress = asArray(progressRaw);
        const progressById = new Map(progress.map(p => [String(p.chapter_id), p]));
        const chapters = asArray(sectionData);
        saveApiCourse(courseId, courseData?.course?.name || courseData?.name || courseId, sectionId, courseData);
        courseCount++;
        for (const chapter of chapters) {
          saveApiChapter(courseId, chapter, progressById.get(String(chapter.id)) || null);
          chapterCount++;
        }
        console.log(`${courseId}: ${chapters.length} chapters | ${chapters.filter(ch => progressById.get(String(ch.id))?.completed_at).length} completed`);
      } catch (error) {
        failures++;
        if (fromAccount.includes(courseId)) console.log(`${courseId}: ${error.message}`);
      }
    }
    console.log(`\nSync complete: ${courseCount} course(s), ${chapterCount} chapter records, ${failures} unavailable/failed course probes.`);
    console.log('Question content is fetched separately with: qureo questions <chapterId>');
  }));


program.command('export')
  .description('Export every available course, chapter, lesson list and chapter test question set to JSON')
  .option('--course <id>', 'Export one course only')
  .option('--chapter <id>', 'Export one chapter only')
  .option('--out <path>', 'Output JSON path (default: exports/qureo-export.json)')
  .action(async options => withClient(async (client, user) => {
    const available = (user?.available_courses || [])
      .map(c => ({ id: String(c.content_id || c.id || ''), name: c.name || c.title || '' }))
      .filter(c => c.id);
    const accountCourses = options.course
      ? [{ id: String(options.course), name: '' }]
      : available;

    if (!options.chapter && accountCourses.length === 0) {
      throw new Error('QUREO returned no available courses. Run qureo me and check the account response.');
    }

    const report = {
      format: 'qureo-course-export',
      schema_version: 1,
      exported_at: new Date().toISOString(),
      extraction_method: 'QUREO authenticated GET API requests',
      account_courses: available,
      coverage_notes: [
        'Includes course metadata, chapters, lesson IDs/titles, chapter test/review question payloads and visible choices/code descriptions returned by the Learning API.',
        'QUREO lesson pages are client-rendered. This API export does not claim to include every interactive step inside a lesson unless QUREO returns that content in chapter metadata or test question responses.',
        'No answers are submitted, no attempt is reset, and no answer-reveal endpoint is probed.'
      ],
      courses: [],
      errors: []
    };

    const outputPath = options.out ? path.resolve(options.out) : path.join(ROOT, 'exports', 'qureo-export.json');
    const saveCheckpoint = () => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const temporaryPath = outputPath + '.tmp';
      fs.writeFileSync(temporaryPath, JSON.stringify(report, null, 2), 'utf8');
      fs.renameSync(temporaryPath, outputPath);
    };
    const isAuthError = error => /authentication expired \(HTTP (401|403)\)/i.test(error && error.message || '');
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const targetChapter = options.chapter ? String(options.chapter) : null;

    if (targetChapter) {
      let chapterRaw;
      try {
        chapterRaw = await client.json(`/chapters/${encodeURIComponent(targetChapter)}`);
      } catch (error) {
        throw new Error(`Could not fetch chapter ${targetChapter}: ${error.message}`);
      }
      const questionsRaw = await client.json(`/chapters/${encodeURIComponent(targetChapter)}/test`).catch(error => ({ __error: error.message }));
      const qList = asArray(questionsRaw);
      const qSaved = qList.length;
      for (const item of qList) saveApiQuestion(targetChapter, item);
      const lectures = asArray(chapterRaw?.lectures || chapterRaw?.chapter?.lectures || chapterRaw?.data?.lectures);
      report.chapters = [{
        id: targetChapter,
        title: chapterRaw?.name || chapterRaw?.chapter?.name || '',
        raw: chapterRaw,
        lessons: lectures.map((lesson, index) => ({
          id: String(lesson.id ?? lesson.lecture_id ?? ''),
          title: lesson.title || lesson.name || '',
          sequence: lesson.seq ?? lesson.sequence ?? index + 1,
          url: `${COURSE_ORIGIN}/chapter/${targetChapter}/lecture/${lesson.id ?? lesson.lecture_id ?? ''}`,
          raw: lesson
        })),
        question_count: qSaved,
        questions: qList.length ? qList : [],
        questions_error: questionsRaw?.__error || null
      }];
      console.log(`Chapter ${targetChapter}: ${lectures.length} lesson(s), ${qSaved} test question(s).`);
    } else {
      for (const course of accountCourses) {
        try {
          await client.request(`${COURSE_ORIGIN}/?content_id=${encodeURIComponent(course.id)}`, { method: 'GET' });
          const courseRaw = await client.json(`/courses/${encodeURIComponent(course.id)}`);
          const sectionId = courseRaw?.basic_section?.id || courseRaw?.course?.basic_section?.id;
          if (!sectionId) throw new Error('Course response did not contain basic_section.id.');
          const sectionRaw = await client.json(`/sections/${encodeURIComponent(sectionId)}`);
          const progressRaw = await client.json(`/students/sections/${encodeURIComponent(sectionId)}/chapters`).catch(() => []);
          const progress = asArray(progressRaw);
          const progressById = new Map(progress.map(row => [String(row.chapter_id), row]));
          const chapterRows = asArray(sectionRaw);
          saveApiCourse(course.id, courseRaw?.course?.name || courseRaw?.name || course.name || course.id, sectionId, courseRaw);
          const courseOut = {
            id: course.id,
            title: courseRaw?.course?.name || courseRaw?.name || course.name || course.id,
            section_id: sectionId,
            raw: courseRaw,
            section_raw: sectionRaw,
            chapters: []
          };

          for (const chapter of chapterRows) {
            const chapterId = String(chapter.id);
            const chapterProgress = progressById.get(chapterId) || null;
            saveApiChapter(course.id, chapter, chapterProgress);
            const chapterOut = {
              id: chapterId,
              sequence: chapter.seq ?? null,
              title: chapter.name || chapter.title || '',
              test_type: chapter.test_type || '',
              progress: chapterProgress,
              raw: null,
              lessons: [],
              questions: [],
              questions_error: null
            };

            try {
              chapterOut.raw = await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
              const lessons = asArray(chapterOut.raw?.lectures || chapterOut.raw?.chapter?.lectures || chapterOut.raw?.data?.lectures);
              chapterOut.lessons = lessons.map((lesson, index) => ({
                id: String(lesson.id ?? lesson.lecture_id ?? ''),
                title: lesson.title || lesson.name || '',
                sequence: lesson.seq ?? lesson.sequence ?? index + 1,
                url: `${COURSE_ORIGIN}/chapter/${chapterId}/lecture/${lesson.id ?? lesson.lecture_id ?? ''}`,
                raw: lesson
              }));
            } catch (error) {
              report.errors.push({ course_id: course.id, chapter_id: chapterId, stage: 'chapter_metadata', message: error.message });
              if (isAuthError(error)) {
                courseOut.chapters.push(chapterOut);
                report.courses = report.courses.filter(item => String(item.id) !== String(course.id));
                report.courses.push(courseOut);
                saveCheckpoint();
                throw error;
              }
            }

            try {
              const questionsRaw = await client.json(`/chapters/${encodeURIComponent(chapterId)}/test`);
              chapterOut.questions = asArray(questionsRaw);
              chapterOut.questions_raw = chapterOut.questions.length ? undefined : questionsRaw;
              for (const item of chapterOut.questions) saveApiQuestion(chapterId, item);
            } catch (error) {
              chapterOut.questions_error = error.message;
              report.errors.push({ course_id: course.id, chapter_id: chapterId, stage: 'chapter_questions', message: error.message });
              if (isAuthError(error)) {
                courseOut.chapters.push(chapterOut);
                report.courses.push(courseOut);
                saveCheckpoint();
                throw error;
              }
            }

            console.log(`${course.id} | ${chapterOut.sequence ?? '?'} | ${chapterOut.title} | ${chapterOut.lessons.length} lesson(s) | ${chapterOut.questions.length} question(s)`);
            courseOut.chapters.push(chapterOut);
            report.courses = report.courses.filter(item => String(item.id) !== String(course.id));
            report.courses.push(courseOut);
            saveCheckpoint();
            await delay(140);
          }
          report.courses = report.courses.filter(item => String(item.id) !== String(course.id));
          report.courses.push(courseOut);
          saveCheckpoint();
          console.log(`Finished ${course.id}: ${courseOut.chapters.length} chapters.`);
        } catch (error) {
          if (isAuthError(error)) throw error;
          report.errors.push({ course_id: course.id, stage: 'course', message: error.message });
          console.log(`${course.id}: ${error.message}`);
        }
      }
    }

    saveCheckpoint();
    const chapterCount = report.chapters?.length || report.courses.reduce((n, c) => n + c.chapters.length, 0);
    const lessonCount = (report.chapters || report.courses.flatMap(c => c.chapters)).reduce((n, ch) => n + ch.lessons.length, 0);
    const questionCount = (report.chapters || report.courses.flatMap(c => c.chapters)).reduce((n, ch) => n + ch.questions.length, 0);
    console.log(`\nExport complete: ${chapterCount} chapter(s), ${lessonCount} lesson record(s), ${questionCount} assessment question(s).`);
    console.log(`Saved: ${outputPath}`);
    console.log('Upload this JSON file here so the question sets can be solved in bulk.');
  }));

program.command('lessons <chapterId>')
  .description('List every lesson ID and title in a chapter')
  .action(async chapterId => withClient(async client => {
    const raw = await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
    const lessons = asArray(raw?.lectures || raw?.chapter?.lectures || raw?.data?.lectures);
    console.log(`Chapter ${chapterId}: ${lessons.length} lesson(s)`);
    for (const [index, lesson] of lessons.entries()) {
      console.log(`${String(index + 1).padStart(2, '0')}. ${lesson.title || lesson.name || '(untitled)'} | ${lesson.id ?? lesson.lecture_id ?? '?'}`);
    }
    if (!lessons.length) outputJson(raw);
  }));

program.command('progress')
  .description('Show cached QUREO course and chapter progress')
  .option('--course <id>', 'Filter by course ID')
  .action(options => {
    const chapters = listApiChapters(options.course);
    if (!chapters.length) return console.log('No course progress cached. Run `qureo sync` first.');
    const total = chapters.length;
    const completed = chapters.filter(ch => ch.completed).length;
    console.log(`Progress: ${completed}/${total} chapters completed (${Math.round(completed / total * 100)}%)`);
    for (const ch of chapters) {
      console.log(`${ch.completed ? '[x]' : '[ ]'} ${String(ch.sequence_number ?? '?').padStart(2, '0')} | ${ch.chapter_id} | ${ch.title} | ${ch.diamonds ?? '-'} diamonds`);
    }
  });

program.command('chapter <chapterId>')
  .description('Fetch chapter metadata, including its lesson list, using GET')
  .action(async chapterId => withClient(async client => {
    const chapter = await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
    const lectures = asArray(chapter?.lectures || chapter?.chapter?.lectures || chapter?.data?.lectures);
    const cached = getApiChapter(chapterId);
    console.log(`Chapter: ${cached?.title || chapter?.name || chapter?.chapter?.name || chapterId}`);
    console.log(`ID: ${chapterId}`);
    console.log(`Lessons: ${lectures.length}`);
    for (const [i, lesson] of lectures.entries()) {
      console.log(`  ${i + 1}. ${lesson.title || lesson.name || lesson.id} | ${lesson.id || ''}`);
    }
    if (!lectures.length) outputJson(chapter);
  }));

program.command('questions <chapterId>')
  .description('Fetch and cache exercise questions and visible choices for a chapter')
  .action(async chapterId => withClient(async client => {
    const raw = await client.json(`/chapters/${encodeURIComponent(chapterId)}/test`);
    const questions = asArray(raw);
    if (!questions.length) {
      console.log('QUREO returned no question array for this chapter.');
      outputJson(raw);
      return;
    }
    for (const item of questions) saveApiQuestion(chapterId, item);
    console.log(`Cached ${questions.length} question(s) for chapter ${chapterId}.`);
    for (const [i, item] of questions.entries()) {
      const q = extractQuestion(item);
      console.log(`\n${i + 1}. [${q.type}] ID ${q.id ?? '?'}`);
      console.log(q.prompt || '(Prompt is stored in the raw question data but did not match known fields.)');
      if (q.choices.length) for (const [j, choice] of q.choices.entries()) console.log(`   ${String.fromCharCode(65 + j)}. ${choice}`);
      if (q.snippets.length && !q.prompt) console.log(q.snippets.join('\n'));
    }
  }));

program.command('result <chapterId>')
  .description('Read the result data from an existing chapter attempt, if QUREO exposes it')
  .action(async chapterId => withClient(async client => {
    const result = await client.json(`/students/chapters/${encodeURIComponent(chapterId)}/test/result`);
    const payload = result?.result || result;
    const sourceUrl = `${API_BASE}/students/chapters/${encodeURIComponent(chapterId)}/test/result`;
    let harvested = 0;
    for (const item of (Array.isArray(payload?.choice_results) ? payload.choice_results : [])) {
      const correct = (item.choices || []).find(choice => choice.correct === true);
      const choiceId = correct?.choice?.id ?? correct?.id ?? (item.correct === true ? item.choice_id : null);
      if (item.question_id === undefined || item.question_id === null || choiceId === null || choiceId === undefined) continue;
      const saved = saveRetrievedAnswer({ questionKey: item.question_id, questionText: findApiQuestion(item.question_id)?.prompt || '',
        answerType: 'choice', answerText: String(choiceId), explanation: 'Read from an existing QUREO result response.', sourceUrl });
      if (saved) harvested++;
    }
    for (const item of (Array.isArray(payload?.description_results) ? payload.description_results : [])) {
      const answerText = item.model_answer ?? (item.correct === true ? item.answer_code : null);
      if (item.question_id === undefined || item.question_id === null || answerText === null || answerText === undefined || String(answerText).trim() === '') continue;
      const saved = saveRetrievedAnswer({ questionKey: item.question_id, questionText: findApiQuestion(item.question_id)?.prompt || '',
        answerType: 'code', answerText: String(answerText), explanation: 'Model answer read from an existing QUREO result response.', sourceUrl });
      if (saved) harvested++;
    }
    console.log(`Read existing result for chapter ${chapterId}. Stored ${harvested} new answer(s) from result data.`);
    outputJson(result);
  }));

const answers = program.command('answers').description('Download and search publicly available QUREO guides');
answers.command('sync')
  .description('Cache publicly accessible MI Academy QUREO guide pages locally')
  .action(async () => {
    console.log(`Source: ${answerIndexUrl()}`);
    console.log('Downloading only pages that are publicly accessible. Paid/member-only material is not bypassed.');
    const result = await syncPublicGuides({ onProgress: p => {
      if (p.total) process.stdout.write(`\r${p.message}   `);
    } });
    console.log(`\nSaved ${result.saved} page(s). Discovered ${result.discovered} chapter pages; ${result.failed} failed.`);
  });


answers.command('import <file>')
  .description('Import a JSON answer file created from a QUREO course export')
  .action(file => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) throw new Error(`Answer file not found: ${filePath}`);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : parsed.answers;
    if (!Array.isArray(rows)) throw new Error('Expected a JSON array or an object with an answers array.');
    let saved = 0;
    let skipped = 0;
    for (const item of rows) {
      const key = item.question_id ?? item.questionId ?? item.question_key ?? item.id;
      const answerText = item.answer_text ?? item.answerText ?? item.answer ?? item.code;
      if (key === undefined || key === null || answerText === undefined || answerText === null || String(answerText).trim() === '') {
        skipped++;
        continue;
      }
      const known = findApiQuestion(key);
      const row = saveCustomAnswer({
        questionKey: String(key),
        questionText: item.question_text || item.prompt || known?.prompt || '',
        answerType: item.answer_type || item.answerType || (item.choice_id ? 'choice' : 'code'),
        answerText: String(answerText),
        explanation: item.explanation || '',
        sourceUrl: item.source_url || item.sourceUrl || 'Imported answer set'
      });
      if (row) saved++;
    }
    console.log(`Imported ${saved} answer(s); skipped ${skipped} incomplete record(s).`);
  });

answers.command('list')
  .description('List answers manually stored in your local database')
  .action(() => {
    const rows = listCustomAnswers(100);
    if (!rows.length) return console.log('No custom answers saved yet.');
    for (const row of rows) {
      console.log(`#${row.answer_id} ${row.verified ? '[QUREO result]' : '[local]'} ${row.question_key ? `[${row.question_key}] ` : ''}${row.question_text || '(no question text)'}`);
      console.log(`  ${row.answer_preview.replace(/\n/g, ' ').slice(0, 150)}${row.answer_preview.length >= 150 ? '…' : ''}`);
      if (row.source_url) console.log(`  Source: ${row.source_url}`);
    }
  });

const answer = program.command('answer').description('Save your own answer or solution note locally');
answer.command('save')
  .description('Save an answer associated with a QUREO question number or question text')
  .requiredOption('--answer <text>', 'Answer text or code')
  .option('--question-key <key>', 'Question number or QUREO question ID', '')
  .option('--question <text>', 'Question text', '')
  .option('--type <type>', 'Answer type: code, text, or choice', 'text')
  .option('--explanation <text>', 'Explanation', '')
  .option('--source <url>', 'Source URL', '')
  .action(options => {
    if (!['code', 'text', 'choice'].includes(options.type)) throw new Error('Answer type must be code, text, or choice.');
    const row = saveCustomAnswer({ questionKey: options.questionKey, questionText: options.question,
      answerType: options.type, answerText: options.answer, explanation: options.explanation, sourceUrl: options.source });
    console.log(`Saved local answer #${row.answer_id}.`);
  });

program.command('search <query>')
  .description('Search public guide pages, fetched QUREO questions and your local answers')
  .option('--limit <number>', 'Maximum results per category', '8')
  .action(async (query, options) => {
    let result = searchAnswers(query, Number.parseInt(options.limit, 10));
    if (!result.pages.length && !result.questions.length && !result.answers.length) {
      const stats = getStats();
      if (!stats.publicPages) {
        console.log('No answer guide cache yet. Syncing public pages first...');
        const synced = await syncPublicGuides();
        console.log(`Cached ${synced.saved} public page(s).`);
        result = searchAnswers(query, Number.parseInt(options.limit, 10));
      }
    }
    let found = 0;
    for (const page of result.pages) {
      found++;
      console.log(`\n[PUBLIC GUIDE] ${page.title}`);
      console.log(`Source: ${page.url}`);
      for (const excerpt of page.excerpts) console.log(`  ${excerpt.slice(0, 850)}\n`);
    }
    for (const q of result.questions) {
      found++;
      console.log(`\n[QUREO QUESTION] ${q.question_id} | chapter ${q.chapter_id} | ${q.question_type}`);
      console.log(q.prompt || '(No plain-text prompt extracted)');
      console.log(`Get full data with: qureo questions ${q.chapter_id}`);
    }
    for (const a of result.answers) {
      found++;
      console.log(`\n[YOUR LOCAL ANSWER] #${a.answer_id} ${a.question_key}`);
      console.log(`Question: ${a.question_text}`);
      console.log(`Answer (${a.answer_type}):\n${a.answer_text}`);
      if (a.explanation) console.log(`Explanation: ${a.explanation}`);
      if (a.source_url) console.log(`Source: ${a.source_url}`);
    }
    if (!found) console.log(`No matches for: ${query}\nTry syncing public guides with: qureo answers sync`);
  });

program.command('exercises')
  .description('List exercises captured by the previous browser version')
  .option('--limit <number>', 'Maximum number of exercises', '30')
  .action(options => {
    const rows = listExercises(Number.parseInt(options.limit, 10));
    if (!rows.length) return console.log('No browser-captured exercises in this database.');
    for (const row of rows) {
      console.log(`${row.exercise_id} | ${row.exercise_type} | ${row.solutions_count} stored answer(s) | ${row.lesson_title || row.title}`);
      console.log(`  ${row.prompt.slice(0, 180).replace(/\n/g, ' ')}`);
    }
  });

answer.command('show <answerId>')
  .description('Display the full text of one locally stored answer')
  .action(answerId => {
    const row = getCustomAnswer(answerId);
    if (!row) return console.log(`Answer #${answerId} was not found.`);
    console.log(`#${row.answer_id} ${row.question_key ? `[${row.question_key}] ` : ''}${row.question_text || ''}`);
    console.log(`Type: ${row.answer_type}${row.verified ? ' | Retrieved from an existing QUREO result' : ''}`);
    console.log(`\n${row.answer_text}`);
    if (row.explanation) console.log(`\nExplanation:\n${row.explanation}`);
    if (row.source_url) console.log(`\nSource: ${row.source_url}`);
  });

answer.command('list-old')
  .description('List answers stored by the previous browser version')
  .action(() => {
    const rows = listSolutions(100);
    if (!rows.length) return console.log('No answers from the previous browser version.');
    for (const row of rows) console.log(`#${row.solution_id} ${row.verified ? '[verified]' : '[unverified]'} ${row.answer_type} | ${row.title || row.exercise_id}\n  ${row.answer_preview}`);
  });

program.command('stats')
  .description('Show local database statistics')
  .action(() => {
    const s = getStats();
    console.log(`API courses: ${s.apiCourses}\nAPI chapters: ${s.apiChapters}\nAPI questions: ${s.apiQuestions}`);
    console.log(`Public guide pages: ${s.publicPages}\nYour saved answers: ${s.customAnswers}`);
    console.log(`Legacy captured exercises: ${s.exercises}\nLegacy saved answers: ${s.solutions} (${s.verified} verified)`);
  });

program.command('database')
  .description('Show the SQLite database path')
  .action(() => console.log(DB_PATH));

program.showHelpAfterError();
program.parseAsync(process.argv).catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
