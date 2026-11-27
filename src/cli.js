#!/usr/bin/env node
import { Command } from 'commander';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import {
  getStats, listExercises, listSolutions, saveApiCourse, saveApiChapter, syncApiChapters,
  saveApiQuestion, listApiCourses, listApiChapters, getApiChapter,
  saveCustomAnswer, saveRetrievedAnswer, findApiQuestion, getCustomAnswer, listCustomAnswers
} from './db.js';
import { QureoHttpClient, API_BASE, COURSE_ORIGIN } from './http.js';
import { askHidden } from './hiddenInput.js';
import { answerIndexUrl, searchAnswers, syncPublicGuides } from './publicAnswers.js';
import { COMMUNITY_ANSWER_ARCHIVE_PATH, syncCommunityAnswers } from './communityAnswers.js';
import { PYTHON_COURSE_ID, resolveSolveTarget } from './solveCommand.js';
import { searchSavedPythonAnswers, syncPythonAnswerGuide } from './pythonAnswerGuide.js';
import { DB_PATH, ROOT } from './paths.js';
import { getChapterAssessmentResultPath, solveCourse } from './solver.js';
import { fetchChapterQuestions, resolveChapterContext } from './chapterContext.js';
import { displayCourseName, listSolvableCourses, resolveCourseChoice } from './courseSelection.js';
import { registerSprixCommands } from './sprix.js';

const program = new Command();
program
  .name('qureo')
  .description('Private QUREO HTTP client, course index and local answer search')
  .version('0.5.0');

function outputJson(value) { console.log(JSON.stringify(value, null, 2)); }

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parsePauseDuration(value, label) {
  if (value === undefined) return 0;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    throw new Error(`${label} must be between 0 and 3600 seconds.`);
  }
  return Math.round(seconds * 1000);
}

async function confirmChapter({ chapter, position, total }) {
  if (!input.isTTY) throw new Error('--interactive requires an interactive terminal.');
  const sequence = chapter.seq ?? chapter.sequence ?? chapter.id;
  const title = chapter.name || chapter.title || 'Untitled';
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`Start chapter ${sequence} (${position}/${total}) - ${title}? [Y/n] `);
    return !/^(n|no)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function chooseSolveCourse(user) {
  const courses = listSolvableCourses(
    user?.available_courses || [],
    listApiCourses(),
    courseId => fs.existsSync(path.join(ROOT, 'answers', courseId + '.json'))
  );
  if (!courses.length) {
    throw new Error('No available course has a local answer bank. Run qureo sync and add answers/<course_id>.json before solving.');
  }
  if (!input.isTTY) {
    throw new Error('Course selection requires an interactive PowerShell terminal. Pass --course <id> to choose a course directly.');
  }

  console.log('\nChoose a QUREO course:');
  for (const [index, course] of courses.entries()) {
    console.log(`  ${index + 1}. ${displayCourseName(course)} (${course.id})`);
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`Select a course [1-${courses.length}]: `);
    const selected = resolveCourseChoice(answer, courses);
    if (!selected) throw new Error('Invalid course selection. Run qureo solve again and enter one of the listed numbers.');
    return selected.id;
  } finally {
    rl.close();
  }
}

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

function isChapterCompleted(progress) {
  return Boolean(progress?.completed_at || progress?.is_completed === true ||
    progress?.completed === true || progress?.completed === 1);
}

function getChapterGemReward(progress) {
  const raw = progress?.diamond ?? progress?.diamonds ?? progress?.gem ?? progress?.gems;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
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
  .description('Show your account, earned gems and completed chapters')
  .action(async () => withClient(async (client, user) => {
    const accountName = user?.name || user?.student?.name || '(name not provided)';
    const courses = [...new Map((user?.available_courses || [])
      .map(course => ({
        id: String(course.content_id || course.id || ''),
        name: course.name || course.title || ''
      }))
      .filter(course => course.id)
      .map(course => [course.id, course])).values()];

    console.log(`Account: ${accountName}`);
    console.log(`Available courses: ${courses.length}`);

    const totals = {
      courses: 0,
      chapters: 0,
      completed: 0,
      gems: 0,
      completedWithGemData: 0,
      skipped: 0,
      errors: 0
    };

    for (const accountCourse of courses) {
      try {
        await client.request(`${COURSE_ORIGIN}/?content_id=${encodeURIComponent(accountCourse.id)}`, { method: 'GET' });
        const courseRaw = await client.json(`/courses/${encodeURIComponent(accountCourse.id)}`);
        const sectionId = courseRaw?.basic_section?.id || courseRaw?.course?.basic_section?.id;
        if (!sectionId) throw new Error('Course response did not contain basic_section.id.');

        const [sectionRaw, progressRaw] = await Promise.all([
          client.json(`/sections/${encodeURIComponent(sectionId)}`),
          client.json(`/students/sections/${encodeURIComponent(sectionId)}/chapters`)
        ]);

        const chapters = asArray(sectionRaw).sort((a, b) =>
          Number(a.seq ?? a.sequence ?? 0) - Number(b.seq ?? b.sequence ?? 0)
        );
        const progressRows = asArray(progressRaw);
        const progressById = new Map(progressRows.map(row => [String(row.chapter_id), row]));
        const completed = chapters.filter(chapter =>
          isChapterCompleted(progressById.get(String(chapter.id)))
        );
        const inProgress = chapters.filter(chapter => {
          const row = progressById.get(String(chapter.id));
          return !isChapterCompleted(row) && Boolean(row?.started_at || row?.started === true);
        });
        const knownGemRewards = completed
          .map(chapter => getChapterGemReward(progressById.get(String(chapter.id))))
          .filter(value => value !== null);
        const courseGems = knownGemRewards.reduce((sum, value) => sum + value, 0);
        const courseName = courseRaw?.course?.name || courseRaw?.name || accountCourse.name || accountCourse.id;
        const percentage = chapters.length ? Math.round(completed.length / chapters.length * 100) : 0;

        console.log(`\n${courseName} (${accountCourse.id})`);
        console.log(`  Chapters completed: ${completed.length}/${chapters.length} (${percentage}%)`);
        if (knownGemRewards.length) {
          const rewardNote = knownGemRewards.length === completed.length
            ? ''
            : `; reward value available for ${knownGemRewards.length}/${completed.length} completed chapters`;
          console.log(`  Gems earned from chapter rewards: ${courseGems.toLocaleString('en-US')}${rewardNote}`);
        } else {
          console.log('  Gems earned from chapter rewards: unavailable');
        }
        console.log(`  In progress: ${inProgress.length} | Not started: ${Math.max(0, chapters.length - completed.length - inProgress.length)}`);
        console.log('  Finished chapters:');
        if (!completed.length) {
          console.log('    None');
        } else {
          for (const [index, chapter] of completed.entries()) {
            const row = progressById.get(String(chapter.id));
            const sequence = chapter.seq ?? chapter.sequence ?? index + 1;
            const title = chapter.name || chapter.title || `Chapter ${sequence}`;
            const reward = getChapterGemReward(row);
            console.log(`    ${String(sequence).padStart(2, '0')}. ${title}${reward === null ? '' : ` (+${reward} gems)`}`);
          }
        }

        totals.courses++;
        totals.chapters += chapters.length;
        totals.completed += completed.length;
        totals.gems += courseGems;
        totals.completedWithGemData += knownGemRewards.length;
      } catch (error) {
        if (error?.status === 404) {
          totals.skipped++;
          console.log(`\n${accountCourse.name || accountCourse.id}: course data unavailable (HTTP 404); skipped.`);
          continue;
        }
        totals.errors++;
        console.log(`\n${accountCourse.name || accountCourse.id}: progress unavailable (${error.message})`);
      }
    }

    if (!courses.length) {
      console.log('QUREO did not return any available courses.');
      return;
    }

    if (totals.courses) {
      const percentage = totals.chapters ? Math.round(totals.completed / totals.chapters * 100) : 0;
      console.log(`\nOverall: ${totals.completed}/${totals.chapters} chapters completed (${percentage}%) across ${totals.courses} course(s).`);
      if (totals.completedWithGemData) {
        console.log(`Total gems from completed-chapter rewards: ${totals.gems.toLocaleString('en-US')} (${totals.completedWithGemData} reward records).`);
      } else {
        console.log('Total gems: unavailable in the progress records returned by QUREO.');
      }
    }
    if (totals.skipped) {
      console.log(`Skipped ${totals.skipped} course(s) that QUREO listed but did not expose through the Learning API.`);
    }
    if (totals.errors) {
      console.log(`Progress could not be loaded for ${totals.errors} course(s).`);
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
        chapterCount += syncApiChapters(courseId, chapters, progressById);
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
    const isAuthError = error => error?.code === 'AUTH_EXPIRED' || error?.status === 401 || /authentication expired \(HTTP 401\)/i.test(error && error.message || '');
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const targetChapter = options.chapter ? String(options.chapter) : null;

    if (targetChapter) {
      const chapterContext = await resolveChapterContext(client, accountCourses, targetChapter);
      if (!chapterContext) {
        throw new Error(
          `Could not find chapter ${targetChapter} in the available account courses. ` +
          'Pass --course <id> to select its course explicitly, or run qureo sync to refresh the course list.'
        );
      }
      report.course_id = chapterContext.courseId;

      let chapterRaw;
      try {
        chapterRaw = await client.json(`/chapters/${encodeURIComponent(targetChapter)}`);
      } catch (error) {
        throw new Error(`Could not fetch chapter ${targetChapter} after initializing course ${chapterContext.courseId}: ${error.message}`);
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
              expected_question_count: null,
              questions_status: 'pending',
              questions_error: null
            };

            try {
              chapterOut.raw = await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
              const lessons = asArray(chapterOut.raw?.lectures || chapterOut.raw?.chapter?.lectures || chapterOut.raw?.data?.lectures);
              const expectedCount = chapterOut.raw?.chapter?.question_count ?? chapterOut.raw?.question_count ?? null;
              chapterOut.expected_question_count = expectedCount === null || expectedCount === undefined ? null : Number.isFinite(Number(expectedCount)) ? Number(expectedCount) : null;
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
              chapterOut.questions_status = chapterOut.questions.length ? 'available' : 'empty';
              chapterOut.questions_raw = chapterOut.questions.length ? undefined : questionsRaw;
              for (const item of chapterOut.questions) saveApiQuestion(chapterId, item);
            } catch (error) {
              chapterOut.questions_error = error.message;
              chapterOut.questions_status = error.code === 'PRECONDITION_NOT_FULFILLED' ? 'precondition_blocked' : error.code === 'AUTH_EXPIRED' ? 'authentication_expired' : 'error';
              report.errors.push({ course_id: course.id, chapter_id: chapterId, stage: 'chapter_questions', code: error.code || null, status: error.status || null, message: error.message });
              if (isAuthError(error)) {
                courseOut.chapters.push(chapterOut);
                report.courses = report.courses.filter(item => String(item.id) !== String(course.id));
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
    if (Array.isArray(report.courses)) {
      const uniqueCourses = new Map(report.courses.map(course => [String(course.id), course]));
      report.courses = [...uniqueCourses.values()];
    }
    const chapterCount = report.chapters?.length || report.courses.reduce((n, c) => n + c.chapters.length, 0);
    const lessonCount = (report.chapters || report.courses.flatMap(c => c.chapters)).reduce((n, ch) => n + ch.lessons.length, 0);
    const questionCount = (report.chapters || report.courses.flatMap(c => c.chapters)).reduce((n, ch) => n + ch.questions.length, 0);
    console.log(`\nExport complete: ${chapterCount} chapter(s), ${lessonCount} lesson record(s), ${questionCount} assessment question(s).`);
    console.log(`Saved: ${outputPath}`);
    console.log('Upload this JSON file here so the question sets can be solved in bulk.');
  }));

function configureSolveCommand(command, { includeCourse = true } = {}) {
  if (includeCourse) {
    command.option('--course <id>', 'Course ID to solve; prompts for a choice when omitted');
  }
  return command
    .option('--dry-run', 'Preview selected chapters without submitting answers')
    .option('--single', 'Solve only the current or explicitly selected chapter')
    .option('--max-chapters <count>', 'Stop after this many chapters')
    .option('--pause-between-chapters <seconds>', 'Wait between completed chapters')
    .option('--pause-between-questions <seconds>', 'Wait between submitted questions')
    .option('--interactive', 'Ask before starting each chapter')
    .option('--no-skip-completed', 'Revisit completed chapters inside an explicit chapter range')
    .option('--no-resume', 'Ignore the previous local checkpoint')
    .option('--auto-answers', 'Download/cache the public Python guide and infer missing assessment mappings');
}

async function runSolve(courseId, chapterRange, options) {
  await withClient(async (client, user) => {
    const selectedCourseId = courseId || options.course || await chooseSolveCourse(user);
    if (selectedCourseId === PYTHON_COURSE_ID) {
      const hasCachedArchive = fs.existsSync(COMMUNITY_ANSWER_ARCHIVE_PATH);
      console.log(
        hasCachedArchive
          ? 'Refreshing the community answer archive before solving...'
          : 'The community answer archive is missing. Downloading it before the Python solve...'
      );
      try {
        const downloaded = await syncCommunityAnswers();
        console.log(
          `${hasCachedArchive ? 'Refreshed' : 'Installed'} ${downloaded.answerCount} fallback answer(s) across ${downloaded.chapterCount} chapter groups.`
        );
      } catch (error) {
        if (!hasCachedArchive) throw error;
        console.warn(
          `Could not refresh the community answer archive (${error.message}). Continuing with the existing cached archive.`
        );
      }
    }

    const result = await solveCourse(client, {
      courseId: selectedCourseId,
      targetChapter: chapterRange || null,
      dryRun: Boolean(options.dryRun),
      single: Boolean(options.single),
      maxChapters: options.maxChapters === undefined
        ? null
        : parsePositiveInteger(options.maxChapters, 'Maximum chapter count'),
      chapterDelayMs: parsePauseDuration(options.pauseBetweenChapters, 'Chapter pause'),
      questionDelayMs: parsePauseDuration(options.pauseBetweenQuestions, 'Question pause'),
      interactive: Boolean(options.interactive),
      shouldContinue: confirmChapter,
      skipCompleted: options.skipCompleted !== false,
      resume: options.resume !== false,
      autoAnswers: Boolean(options.autoAnswers),
      onProgress: message => console.log(message)
    });
    console.log(result.summary);
  });
}

configureSolveCommand(
  program.command('solve [courseOrRange] [chapterRange]')
    .description('Solve a selected QUREO course or use the Python shortcut')
).action(async (courseOrRange, chapterRange, options) => {
  const target = resolveSolveTarget(courseOrRange, chapterRange, options.course);
  await runSolve(target.courseId, target.targetChapter, options);
});

const python = program.command('python').description('Shortcuts for the QUREO Python course');
configureSolveCommand(python.command('solve [chapterRange]')
  .description('Solve remaining Python chapters using the local and community answer banks'), {
  includeCourse: false
}).action(async (chapterRange, options) => {
  await runSolve(PYTHON_COURSE_ID, chapterRange, options);
});

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
  .action(async chapterId => withClient(async (client, user) => {
    const candidates = [
      ...(user?.available_courses || []).map(course => ({
        id: String(course?.content_id || course?.id || '')
      })),
      ...listApiCourses().map(course => ({ id: String(course.course_id || '') })),
      { id: PYTHON_COURSE_ID },
      { id: 'javascript_ar' }
    ].filter(course => course.id);
    const uniqueCourses = [...new Map(candidates.map(course => [course.id, course])).values()];
    const { context, questions: raw } = await fetchChapterQuestions(client, uniqueCourses, chapterId);
    console.log(`Course: ${context.courseId} | section ${context.sectionId}`);
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
      console.log(`\\n${i + 1}. [${q.type}] ID ${q.id ?? '?'}`);
      console.log(q.prompt || '(Prompt is stored in the raw question data but did not match known fields.)');
      if (q.choices.length) for (const [j, choice] of q.choices.entries()) console.log(`   ${String.fromCharCode(65 + j)}. ${choice}`);
      if (q.snippets.length && !q.prompt) console.log(q.snippets.join('\\n'));
    }
  }));

program.command('result <chapterId>')
  .description('Read an existing review or test result and save any model answers QUREO exposes')
  .action(async chapterId => withClient(async client => {
    const chapterMeta = await client.json(`/chapters/${encodeURIComponent(chapterId)}`).catch(() => null);
    const testType = chapterMeta?.chapter?.test_type ||
      chapterMeta?.test_type ||
      chapterMeta?.data?.chapter?.test_type ||
      'review';
    const resultTypes = testType === 'test' ? ['test', 'review'] : ['review', 'test'];
    const failures = [];
    let result = null;
    let resultPath = null;

    for (const resultType of resultTypes) {
      const pathname = getChapterAssessmentResultPath(chapterId, resultType);
      try {
        const candidate = await client.json(pathname);
        const candidatePayload = candidate?.result || candidate;
        if (!result) {
          result = candidate;
          resultPath = pathname;
        }
        const hasResultData = Array.isArray(candidatePayload?.choice_results) ||
          Array.isArray(candidatePayload?.description_results);
        const hasAnswerData = (candidatePayload?.choice_results || []).length > 0 ||
          (candidatePayload?.description_results || []).length > 0;
        if (hasResultData) {
          result = candidate;
          resultPath = pathname;
          if (hasAnswerData) break;
        }
      } catch (error) {
        failures.push(`${resultType}: ${error.message}`);
        if (error?.code === 'AUTH_EXPIRED') throw error;
      }
    }

    if (!result) {
      throw new Error(
        `QUREO did not expose an existing review or test result for chapter ${chapterId}. ` +
        `Checked both result endpoints. ${failures.join(' | ')}`
      );
    }

    const payload = result?.result || result;
    const sourceUrl = `${API_BASE}${resultPath}`;
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
    console.log(`Read existing ${resultPath.includes('/test/') ? 'test' : 'review'} result for chapter ${chapterId}. Stored ${harvested} new answer(s) from result data.`);
    if (failures.length) console.log(`Other endpoint response: ${failures.join(' | ')}`);
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


answers.command('sync-community')
  .description('Download the third-party QUREO answer archive into ignored local data for ID-validated fallback matching')
  .action(async () => {
    console.log('Source: https://github.com/kky84rgkjy-maker/mohammad/blob/main/qureo_answers.json');
    console.log('Downloading the pinned public archive. The source data stays in ignored local data and is not copied into the repository.');
    const result = await syncCommunityAnswers();
    console.log(`Saved ${result.answerCount} answer(s) across ${result.chapterCount} chapter groups.`);
    console.log(`Types: ${result.choiceCount} choice | ${result.descriptionCount} code`);
    console.log(`Local archive: ${result.outputPath}`);
    console.log('The solver will use these as fallback answers after your course-specific bank. Choice IDs are checked against live options.');
  });


answers.command('sync-python')
  .description('Download the public Python course answer guide into a local searchable reference bank')
  .option('--delay <milliseconds>', 'Pause between public page requests', '300')
  .action(async options => {
    const delayMs = Number(options.delay);
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) {
      throw new Error('--delay must be an integer between 0 and 5000 milliseconds.');
    }

    console.log('Source: https://answers.studentplatformeg.online/qureo-python/');
    console.log('Downloading public Python answer pages. No QUREO account or progress changes are involved.');
    const result = await syncPythonAnswerGuide({
      delayMs,
      onProgress: progress => {
        if (progress.message) process.stdout.write(`\r${progress.message}   `);
      }
    });
    console.log(`\nSaved ${result.answers_extracted} question/answer pair(s).`);
    console.log(`Levels: ${result.levels_fetched}/${result.levels_listed} | Lessons: ${result.lessons_fetched}/${result.lessons_found}`);
    console.log(`Failed pages: ${result.failed_pages} | Count mismatches: ${result.count_mismatches}`);
    console.log(`Local answer guide: ${result.outputPath}`);
    console.log('Search it offline with: qureo search "<question words>"');
  });


answers.command('search-python <query>')
  .description('Search the locally downloaded Python answer reference without network access')
  .option('--limit <number>', 'Maximum results', '8')
  .action((query, options) => {
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('--limit must be between 1 and 100.');
    }
    const results = searchSavedPythonAnswers(query, limit);
    if (!results.length) return console.log(`No Python guide matches for: ${query}`);
    for (const [index, result] of results.entries()) {
      console.log(`\n${index + 1}. ${result.level_title} | ${result.lesson_title}`);
      console.log(`Question: ${result.question}`);
      console.log(`Answer:\n${result.answer}`);
      console.log(`Source: ${result.source_url}`);
    }
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

registerSprixCommands(program);

program.showHelpAfterError();
program.parseAsync(process.argv).catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
