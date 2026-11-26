import fs from 'node:fs';
import path from 'node:path';
import { API_BASE, COURSE_ORIGIN } from './http.js';
import { DATA_DIR, ROOT } from './paths.js';
import { planChapterSelection } from './solveSelection.js';
import { matchPythonAssessmentAnswers } from './pythonAutoAnswers.js';

const ANSWER_ROOT = path.join(ROOT, 'answers');

function integerSetting(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

const LESSON_INIT_POLL_INTERVAL_MS = integerSetting('QUREO_LESSON_INIT_POLL_INTERVAL_MS', 1000, 250, 10000);
const LESSON_RETRY_INTERVAL_MS = integerSetting('QUREO_LESSON_RETRY_INTERVAL_MS', 3000, 250, 30000);
const LESSON_RETRY_ATTEMPTS = integerSetting('QUREO_LESSON_RETRY_ATTEMPTS', 40, 1, 100);
const LESSON_RETRY_TIMEOUT_MS = integerSetting('QUREO_LESSON_RETRY_TIMEOUT_MS', 180000, 10000, 600000);
const LESSON_REQUEST_TIMEOUT_MS = integerSetting('QUREO_LESSON_REQUEST_TIMEOUT_MS', 15000, 1000, 120000);

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED',
  'EHOSTUNREACH', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT'
]);
const RETRYABLE_HTTP_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);

function isRetryableNetworkError(error) {
  if (['TimeoutError', 'AbortError', 'ConnectTimeoutError'].includes(error?.name)) return true;
  const codes = [error?.code, error?.cause?.code, error?.cause?.cause?.code];
  if (codes.some(code => RETRYABLE_NETWORK_CODES.has(code))) return true;
  return error instanceof TypeError && /fetch failed|network|socket|connect/i.test(error.message);
}

function isRetryableResponse(response) {
  return RETRYABLE_HTTP_STATUSES.has(response?.status);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.chapters)) return value.data.chapters;
  if (Array.isArray(value?.chapters)) return value.chapters;
  if (Array.isArray(value?.section?.chapters)) return value.section.chapters;
  if (Array.isArray(value?.questions)) return value.questions;
  return [];
}

function isCompleted(progress) {
  return Boolean(progress?.completed_at || progress?.is_completed === true || progress?.completed === true);
}

function loadAnswers(courseId) {
  const file = path.join(ANSWER_ROOT, `${courseId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`No answer bank found at ${file}. Add a course answer file before solving.`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (parsed.course_id !== courseId || !parsed.answers || typeof parsed.answers !== 'object') {
    throw new Error(`Invalid answer bank format: ${file}`);
  }
  return parsed.answers;
}

function saveAnswers(courseId, answers, sources = {}) {
  const file = path.join(ANSWER_ROOT, `${courseId}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  parsed.answers = answers;
  parsed.answer_sources = {
    ...(parsed.answer_sources || {}),
    ...sources
  };
  const temporaryPath = file + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(parsed, null, 2) + '\\n', {
    encoding: 'utf8',
    mode: 0o600
  });
  fs.renameSync(temporaryPath, file);
}

export async function fetchCourseData(client, courseId) {
  await client.request(`${COURSE_ORIGIN}/?content_id=${encodeURIComponent(courseId)}`, {
    method: 'GET'
  });
  return client.json(`/courses/${encodeURIComponent(courseId)}`);
}

function errorFromResponse(pathname, response, payload) {
  const code = payload?.not_fulfill_preconditions
    ? 'PRECONDITION_NOT_FULFILLED'
    : response.status === 401
      ? 'AUTH_EXPIRED'
      : response.status === 403
        ? 'FORBIDDEN'
        : 'HTTP_ERROR';
  const message = code === 'PRECONDITION_NOT_FULFILLED'
    ? `QUREO has not unlocked this action yet: ${pathname} (HTTP 403).`
    : code === 'AUTH_EXPIRED'
      ? 'QUREO session expired. Run qureo login again.'
      : code === 'FORBIDDEN'
        ? `QUREO denied this action: ${pathname} (HTTP 403).`
        : `QUREO request failed: ${pathname} (HTTP ${response.status}).`;
  const error = new Error(message);
  error.code = code;
  error.status = response.status;
  error.payload = payload;
  return error;
}

async function requestJson(client, pathname, { method = 'GET', body, referer } = {}) {
  const headers = { Accept: 'application/json, text/plain, */*' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (referer) headers.Referer = referer;
  const response = await client.request(`${API_BASE}${pathname}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text().catch(() => '');
  let payload = null;
  if (raw) {
    try { payload = JSON.parse(raw); } catch { payload = { message: raw.slice(0, 300) }; }
  }
  if (!response.ok) throw errorFromResponse(pathname, response, payload);
  return payload;
}

export function getQuestionAnswer(item, answers) {
  const question = item?.question || item;
  const id = String(question?.id ?? '');
  const saved = answers[id];
  if (!saved) return null;
  if (saved.type !== question.type) return null;
  if (question.type === 'choice') {
    const choiceId = Number(saved.choice_id);
    if (!Number.isFinite(choiceId) || !asArray(item?.choices).some(choice => Number(choice.id) === choiceId)) return null;
    return { type: 'choice', choice_id: choiceId };
  }
  if (question.type === 'description') {
    const answerCode = String(saved.answer_code ?? '');
    if (!answerCode.trim()) return null;
    return { type: 'description', answer_code: answerCode };
  }
  return null;
}

export function getChapterAnswerCoverage(chapterMeta, chapterId, answers) {
  const rawExpected = chapterMeta?.chapter?.question_count ??
    chapterMeta?.question_count ??
    chapterMeta?.data?.chapter?.question_count;
  const expectedQuestions = Number(rawExpected);
  const answerQuestions = Object.keys(answers || {})
    .filter(id => id.startsWith(String(chapterId))).length;
  return {
    expectedQuestions: Number.isInteger(expectedQuestions) && expectedQuestions > 0
      ? expectedQuestions
      : null,
    answerQuestions,
    complete: Number.isInteger(expectedQuestions) && expectedQuestions > 0 &&
      answerQuestions >= expectedQuestions
  };
}

async function getProgress(client, sectionId) {
  const raw = await client.json(`/students/sections/${encodeURIComponent(sectionId)}/chapters`);
  return new Map(asArray(raw).map(row => [String(row.chapter_id), row]));
}

async function waitForChapterCompletion(client, sectionId, chapterId, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const progress = await getProgress(client, sectionId);
    if (isCompleted(progress.get(String(chapterId)))) return true;
    if (attempt + 1 < attempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
}

export async function initializeLecture(client, lessonId, referer) {
  const pathname = '/students/lectures/' + encodeURIComponent(lessonId);
  const payload = await requestJson(client, pathname, {
    method: 'GET',
    referer
  });

  if (String(payload?.lecture?.lecture_id ?? '') !== String(lessonId)) {
    const error = new Error(`QUREO did not confirm initialization for lesson ${lessonId}.`);
    error.code = 'LESSON_INIT_UNCONFIRMED';
    throw error;
  }

  return payload;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const CHECKPOINT_PATH = path.join(DATA_DIR, 'solve-checkpoint.json');

function readSolveCheckpoint() {
  try {
    const value = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    return value && value.schema_version === 1 ? value : null;
  } catch {
    return null;
  }
}

function writeSolveCheckpoint(value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryPath = CHECKPOINT_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, CHECKPOINT_PATH);
}

async function markLectureCompleted(client, chapterId, lesson, dryRun, onProgress) {
  const lessonId = lesson?.id ?? lesson?.lecture_id;
  if (lessonId === undefined || lessonId === null) return;

  const endpoint = '/students/lectures/' + encodeURIComponent(lessonId) + '/complete';
  const referer = COURSE_ORIGIN + '/chapter/' + chapterId + '/lecture/' + lessonId;
  if (dryRun) {
    onProgress('  [dry-run] complete lesson ' + lessonId);
    return;
  }

  const deadline = Date.now() + LESSON_RETRY_TIMEOUT_MS;
  const submitCompletion = () => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('Lesson completion retry window expired.');
    return client.request(API_BASE + endpoint, {
      method: 'PUT',
      headers: { Accept: 'application/json, */*', Referer: referer },
      timeoutMs: Math.min(LESSON_REQUEST_TIMEOUT_MS, remainingMs)
    });
  };

  let response = null;
  let lastNetworkError = null;
  try {
    response = await submitCompletion();
  } catch (error) {
    if (!isRetryableNetworkError(error)) throw error;
    lastNetworkError = error;
  }

  if (response?.ok) {
    onProgress('  lesson ' + lessonId + ': completed');
    return;
  }
  if (response?.status === 400 || response?.status === 409) {
    onProgress('  lesson ' + lessonId + ': already completed');
    return;
  }
  if (response && !isRetryableResponse(response) && !lastNetworkError) {
    const body = await response.text().catch(() => '');
    throw errorFromResponse(endpoint, response, body ? { message: body.slice(0, 200) } : null);
  }

  const needsPageInitialization = !response || response.status === 404;
  if (needsPageInitialization) {
    const reason = lastNetworkError ? 'temporary network failure' : 'API returned 404 before the lesson was initialized';
    onProgress('  lesson ' + lessonId + ': ' + reason + '; initializing the lesson through the saved QUREO session');
    try {
      await initializeLecture(client, lessonId, referer);
      onProgress('  lesson ' + lessonId + ': initialized through the QUREO lecture API; retrying completion');
    } catch (error) {
      if (!isRetryableNetworkError(error)) throw error;
      lastNetworkError = error;
      onProgress('  lesson ' + lessonId + ': background page request failed temporarily; retrying the completion API');
    }
  }

  for (let attempt = 1; attempt <= LESSON_RETRY_ATTEMPTS && Date.now() < deadline; attempt++) {
    try {
      response = await submitCompletion();
      lastNetworkError = null;
    } catch (error) {
      if (!isRetryableNetworkError(error)) throw error;
      response = null;
      lastNetworkError = error;
    }

    if (response && !isRetryableResponse(response)) break;

    const remainingMs = deadline - Date.now();
    if (attempt < LESSON_RETRY_ATTEMPTS && remainingMs > 0) {
      const delayMs = Math.min(
        response?.status === 404 ? LESSON_INIT_POLL_INTERVAL_MS : LESSON_RETRY_INTERVAL_MS,
        remainingMs
      );
      const reason = lastNetworkError
        ? 'network error (' + lastNetworkError.message + ')'
        : response?.status === 404
          ? 'lesson page is still initializing'
          : 'HTTP ' + response.status;
      onProgress('  lesson ' + lessonId + ': ' + reason + '; retry ' + attempt + '/' + LESSON_RETRY_ATTEMPTS + ' in ' + Math.ceil(delayMs / 1000) + 's');
      await wait(delayMs);
    }
  }

  if (response?.ok) {
    onProgress('  lesson ' + lessonId + ': completed');
    return;
  }
  if (response?.status === 400 || response?.status === 409) {
    onProgress('  lesson ' + lessonId + ': already completed');
    return;
  }

  if (!response && lastNetworkError) {
    const error = new Error(
      'Lesson ' + lessonId + ' could not be completed because the network kept failing during the ' +
      Math.ceil(LESSON_RETRY_TIMEOUT_MS / 1000) +
      's retry window. Check your connection and rerun the solver. Later lessons and the chapter assessment were not started.'
    );
    error.code = 'LESSON_NETWORK_TIMEOUT';
    error.lessonId = String(lessonId);
    error.cause = lastNetworkError;
    throw error;
  }

  if (response?.status === 404) {
    const error = new Error(
      'Lesson ' + lessonId + ' still returns HTTP 404 after ' +
      Math.ceil(LESSON_RETRY_TIMEOUT_MS / 1000) +
      's of retries. The authenticated background page request did not initialize this lesson. Run qureo login to refresh the saved session, then rerun the solver. Later lessons and the chapter assessment were not started.'
    );
    error.code = 'LESSON_NOT_AVAILABLE';
    error.status = 404;
    error.lessonId = String(lessonId);
    throw error;
  }

  const body = response ? await response.text().catch(() => '') : '';
  const error = errorFromResponse(endpoint, response, body ? { message: body.slice(0, 200) } : null);
  throw error;
}
async function solveChapter(client, chapter, chapterMeta, questions, answers, {
  dryRun,
  onProgress,
  onCheckpoint = () => {},
  questionDelayMs = 0,
  lessonsAlreadyCompleted = false
}) {
  const chapterId = String(chapter.id);
  const questionRows = asArray(questions);
  if (!questionRows.length) {
    throw new Error(`Chapter ${chapter.seq ?? chapter.sequence ?? chapterId} returned no assessment questions.`);
  }

  const prepared = questionRows.map(item => {
    const question = item?.question || item;
    return { question, answer: getQuestionAnswer(item, answers) };
  });
  const missing = prepared.filter(row => !row.answer).map(row => row.question?.id);
  if (missing.length) {
    throw new Error(`No verified local solution for question(s): ${missing.join(', ')}. No answers were submitted and the chapter was left untouched.`);
  }

  const lectures = asArray(chapterMeta?.lectures || chapterMeta?.chapter?.lectures || chapterMeta?.data?.lectures);
  onProgress(`Chapter ${chapter.seq ?? chapter.sequence ?? chapterId}: ${chapter.name || chapter.title || 'Untitled'} | ${lectures.length} lesson(s), ${prepared.length} question(s)`);
  onCheckpoint({
    state: 'running',
    stage: 'chapter-start',
    chapter_id: chapterId,
    chapter_sequence: chapter.seq ?? chapter.sequence ?? null,
    chapter_title: chapter.name || chapter.title || '',
    lesson_id: null,
    question_id: null,
    question_index: null
  });

  if (dryRun) {
    for (const row of prepared) {
      onProgress(`  [dry-run] question ${row.question.id}: ${row.answer.type === 'choice' ? `choice ${row.answer.choice_id}` : 'code answer ready'}`);
    }
    return { submitted: 0, correct: 0, total: prepared.length, dryRun: true };
  }

  if (!lessonsAlreadyCompleted) {
    for (const lesson of lectures) {
      const lessonId = String(lesson?.id ?? lesson?.lecture_id ?? '');
      onCheckpoint({ stage: 'lesson-start', lesson_id: lessonId, question_id: null, question_index: null });
      await markLectureCompleted(client, chapterId, lesson, false, onProgress);
      onCheckpoint({ stage: 'lesson-completed', lesson_id: lessonId });
    }
  }

  const testType = chapter.test_type || chapterMeta?.test_type || chapterMeta?.chapter?.test_type || 'review';
  const endpointKind = testType === 'review' ? 'review-questions' : 'test-questions';
  const testSlug = testType === 'review' ? 'review' : 'test';
  const testReferer = `${COURSE_ORIGIN}/chapter/${chapterId}/${testSlug}`;
  const initPath = `/students/chapters/${encodeURIComponent(chapterId)}/test`;
  onProgress(`  initializing ${testType} attempt`);
  onCheckpoint({ stage: 'assessment-initializing', lesson_id: null, question_id: null, question_index: null });
  await requestJson(client, initPath, { method: 'PUT', referer: testReferer });
  onCheckpoint({ stage: 'assessment-initialized' });

  let submitted = 0;
  let correct = 0;
  for (const [index, row] of prepared.entries()) {
    const questionId = String(row.question.id);
    const answerPath = `/students/${endpointKind}/${encodeURIComponent(questionId)}/answer/${row.answer.type}`;
    const payload = row.answer.type === 'choice'
      ? { choice_id: row.answer.choice_id }
      : { answer_code: row.answer.answer_code };
    onCheckpoint({
      stage: 'question-submitting',
      question_id: questionId,
      question_index: index + 1
    });
    const result = await requestJson(client, answerPath, { method: 'PUT', body: payload, referer: testReferer });
    submitted++;
    if (result?.result?.correct === true) correct++;
    if (result?.result?.correct === false) {
      throw new Error(`QUREO marked question ${questionId} incorrect. Submitted ${submitted}/${prepared.length}; stopping before the next chapter.`);
    }
    onCheckpoint({
      stage: 'question-submitted',
      question_id: questionId,
      question_index: index + 1,
      questions_submitted_in_chapter: submitted
    });
    onProgress(`  submitted ${submitted}/${prepared.length} | question ${questionId}${result?.result?.correct === true ? ' | correct' : ''}`);
    if (questionDelayMs > 0 && index < prepared.length - 1) {
      onProgress(`  waiting ${(questionDelayMs / 1000).toFixed(1)}s before the next question`);
      await wait(questionDelayMs);
    }
  }

  let resultPayload = null;
  try {
    resultPayload = await client.json(`/students/chapters/${encodeURIComponent(chapterId)}/test/result`);
  } catch {
    // The per-question submission responses remain the available verification source.
  }
  const result = resultPayload?.result || resultPayload;
  const resultCount = result?.correct_count === undefined || result?.correct_count === null || result?.correct_count === ''
    ? null
    : Number(result.correct_count);
  const verifiedAll = correct === prepared.length || resultCount === prepared.length;
  const correctCount = verifiedAll ? prepared.length : Number.isFinite(resultCount) ? resultCount : correct;
  if (!verifiedAll) {
    throw new Error(`Submitted ${submitted}/${prepared.length} answers, but QUREO did not confirm a complete correct result. Stopping here.`);
  }

  return { submitted, correct: correctCount, total: prepared.length, dryRun: false };
}

export async function solveCourse(client, {
  courseId = 'javascript_ar',
  targetChapter = null,
  dryRun = false,
  maxChapters = null,
  single = false,
  skipCompleted = true,
  chapterDelayMs = 0,
  questionDelayMs = 0,
  interactive = false,
  shouldContinue = async () => true,
  resume = true,
  autoAnswers = false,
  onProgress = message => console.log(message)
} = {}) {
  if (!Number.isInteger(chapterDelayMs) || chapterDelayMs < 0 || chapterDelayMs > 3600000) {
    throw new Error('Chapter pause must be between 0 and 3600 seconds.');
  }
  if (!Number.isInteger(questionDelayMs) || questionDelayMs < 0 || questionDelayMs > 3600000) {
    throw new Error('Question pause must be between 0 and 3600 seconds.');
  }

  if (autoAnswers && courseId !== 'python_short_ar') {
    throw new Error('--auto-answers is currently supported only for the Python course.');
  }

  let pythonGuide = null;
  if (autoAnswers) {
    const { loadSavedPythonAnswerGuide, syncPythonAnswerGuide } = await import('./pythonAnswerGuide.js');
    pythonGuide = loadSavedPythonAnswerGuide();
    if (!pythonGuide) {
      onProgress('No cached Python guide found. Downloading all public Python answers first...');
      const synced = await syncPythonAnswerGuide({
        onProgress: progress => {
          if (progress.message) onProgress(progress.message);
        }
      });
      onProgress(`Downloaded ${synced.answers_extracted} answers across ${synced.levels_fetched} levels and ${synced.lessons_fetched} lessons.`);
      pythonGuide = loadSavedPythonAnswerGuide();
    } else {
      onProgress(`Using cached Python guide: ${pythonGuide.answers.length} answers across ${pythonGuide.coverage?.levels_fetched ?? '?'} levels.`);
    }
    if (!pythonGuide?.answers?.length) {
      throw new Error('The public Python guide is empty. Run qureo answers sync-python and check its output.');
    }
  }

  const answers = loadAnswers(courseId);
  const courseRaw = await fetchCourseData(client, courseId);
  const sectionId = courseRaw?.basic_section?.id || courseRaw?.course?.basic_section?.id;
  if (!sectionId) throw new Error(`Course ${courseId} did not return basic_section.id.`);

  const sectionRaw = await client.json(`/sections/${encodeURIComponent(sectionId)}`);
  const rawChapters = asArray(sectionRaw).sort((a, b) =>
    Number(a.seq ?? a.sequence ?? 0) - Number(b.seq ?? b.sequence ?? 0)
  );
  if (!rawChapters.length) throw new Error(`No chapters found for course ${courseId}.`);

  const progressById = await getProgress(client, sectionId);
  const chapters = rawChapters.map(chapter => ({
    ...chapter,
    completed: isCompleted(progressById.get(String(chapter.id)))
  }));

  const plan = planChapterSelection(chapters, {
    targetChapter,
    single,
    maxChapters,
    skipCompleted
  });

  const previousCheckpoint = resume ? readSolveCheckpoint() : null;
  if (previousCheckpoint?.course_id === courseId && previousCheckpoint.state !== 'completed') {
    const location = previousCheckpoint.chapter_sequence ?? previousCheckpoint.chapter_id ?? 'unknown';
    onProgress(`Resume checkpoint found at chapter ${location}, stage ${previousCheckpoint.stage || 'unknown'}. Rechecking QUREO progress before continuing.`);
  }

  if (!plan.chapters.length) {
    const summary = plan.summary || 'No chapters selected.';
    writeSolveCheckpoint({
      schema_version: 1,
      course_id: courseId,
      state: 'completed',
      stage: 'nothing-to-do',
      summary,
      updated_at: new Date().toISOString()
    });
    return {
      summary,
      startChapter: null,
      endChapter: null,
      chaptersCompleted: 0,
      questionsSubmitted: 0,
      skippedCompleted: plan.skippedCompleted
    };
  }

  const start = plan.chapters[0];
  const end = plan.chapters[plan.chapters.length - 1];
  const startLabel = start.chapter.seq ?? start.chapter.sequence ?? start.chapter.id;
  const endLabel = end.chapter.seq ?? end.chapter.sequence ?? end.chapter.id;

  onProgress(`Account progress: selected ${plan.selectionLabel}, chapters ${startLabel} through ${endLabel}.`);
  if (plan.skippedCompleted) onProgress(`Skipping ${plan.skippedCompleted} completed chapter(s).`);
  if (maxChapters !== null) onProgress(`Maximum chapter limit: ${maxChapters}.`);
  if (dryRun) onProgress('Dry run enabled: no completion or answer requests will be sent.');

  let chaptersCompleted = 0;
  let questionsSubmitted = 0;
  let lastCheckpoint = {
    schema_version: 1,
    course_id: courseId,
    state: 'running',
    stage: 'starting',
    updated_at: new Date().toISOString()
  };

  const checkpoint = patch => {
    lastCheckpoint = {
      ...lastCheckpoint,
      ...patch,
      schema_version: 1,
      course_id: courseId,
      updated_at: new Date().toISOString()
    };
    writeSolveCheckpoint(lastCheckpoint);
  };

  try {
    for (let position = 0; position < plan.chapters.length; position++) {
      const { chapter } = plan.chapters[position];
      const chapterId = String(chapter.id);
      const chapterSequence = chapter.seq ?? chapter.sequence ?? chapterId;
      const chapterTitle = chapter.name || chapter.title || 'Untitled';

      if (interactive && !await shouldContinue({
        chapter,
        position: position + 1,
        total: plan.chapters.length
      })) {
        checkpoint({
          state: 'paused',
          stage: 'paused-before-chapter',
          chapter_id: chapterId,
          chapter_sequence: chapterSequence,
          chapter_title: chapterTitle,
          completed_chapters: chaptersCompleted,
          questions_submitted: questionsSubmitted
        });
        const summary = `Paused before chapter ${chapterSequence}. Completed ${chaptersCompleted} chapter(s) and submitted ${questionsSubmitted} answer(s) in this run.`;
        return {
          summary,
          startChapter: startLabel,
          endChapter: chapterSequence,
          chaptersCompleted,
          questionsSubmitted,
          paused: true
        };
      }

      checkpoint({
        state: 'running',
        stage: 'chapter-start',
        chapter_id: chapterId,
        chapter_sequence: chapterSequence,
        chapter_title: chapterTitle,
        lesson_id: null,
        question_id: null,
        question_index: null,
        completed_chapters: chaptersCompleted,
        questions_submitted: questionsSubmitted
      });

      const chapterMeta = await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
      let questions;
      let lessonsAlreadyCompleted = false;
      try {
        questions = await client.json(`/chapters/${encodeURIComponent(chapterId)}/test`);
      } catch (error) {
        if (error.code !== 'PRECONDITION_NOT_FULFILLED') throw error;

        const coverage = getChapterAnswerCoverage(chapterMeta, chapterId, answers);
        if ((!coverage.complete && !autoAnswers) || dryRun) {
          const expected = coverage.expectedQuestions ?? 'unknown';
          throw new Error(
            `Chapter ${chapterSequence} assessment is locked until its lessons are completed. ` +
            `The local ${courseId} answer bank covers ${coverage.answerQuestions}/${expected} question IDs. ` +
            (dryRun
              ? 'Dry-run mode will not complete lessons or change assessment progress.'
              : 'The solver left all lessons and assessment progress unchanged. Add verified answers or rerun with --auto-answers.')
          );
        }

        const lectures = asArray(chapterMeta?.lectures || chapterMeta?.chapter?.lectures || chapterMeta?.data?.lectures);
        if (!lectures.length) {
          throw new Error(
            `Chapter ${chapterSequence} assessment is locked, and QUREO did not return its lesson list. ` +
            'No lesson or assessment changes were made.'
          );
        }

        onProgress(autoAnswers && !coverage.complete
          ? `Automatic answer matching is enabled. Completing ${lectures.length} lesson(s) to unlock the live assessment questions before matching the public guide.`
          : `Assessment is locked until lessons are completed. The local answer bank covers ${coverage.answerQuestions}/${coverage.expectedQuestions} expected question IDs; completing lessons first.`
        );
        for (const lesson of lectures) {
          const lessonId = String(lesson?.id ?? lesson?.lecture_id ?? '');
          checkpoint({
            stage: 'lesson-start',
            chapter_id: chapterId,
            chapter_sequence: chapterSequence,
            chapter_title: chapterTitle,
            lesson_id: lessonId,
            question_id: null,
            question_index: null
          });
          await markLectureCompleted(client, chapterId, lesson, false, onProgress);
          checkpoint({ stage: 'lesson-completed', lesson_id: lessonId });
        }
        lessonsAlreadyCompleted = true;
        questions = await client.json(`/chapters/${encodeURIComponent(chapterId)}/test`);
      }

      if (autoAnswers) {
        const levelId = String(chapterSequence).padStart(2, '0');
        const inferred = matchPythonAssessmentAnswers(questions, pythonGuide.answers, levelId);
        const sourceEntries = {};

        for (const match of inferred.matches) {
          answers[match.question_id] = inferred.answers[match.question_id];
          sourceEntries[match.question_id] = {
            guide_id: match.guide_id,
            guide_question: match.guide_question,
            guide_answer: match.guide_answer,
            source_url: match.source_url,
            match_score: match.score,
            match_strategy: match.strategy,
            inferred_at: new Date().toISOString()
          };
        }

        if (inferred.matches.length) {
          saveAnswers(courseId, answers, sourceEntries);
          onProgress(
            `  auto-matched ${inferred.matches.length}/${questions.length} assessment answers from guide level ${levelId}; saved to answers/${courseId}.json`
          );
        }

        if (inferred.unmatched.length) {
          onProgress(`  could not map ${inferred.unmatched.length} question(s): ${inferred.unmatched.map(item => item.question_id).join(', ')}`);
        }
      }

      const solved = await solveChapter(client, chapter, chapterMeta, questions, answers, {
        dryRun,
        onProgress,
        questionDelayMs,
        lessonsAlreadyCompleted,
        onCheckpoint: patch => checkpoint({
          ...patch,
          chapter_id: chapterId,
          chapter_sequence: chapterSequence,
          chapter_title: chapterTitle,
          completed_chapters: chaptersCompleted,
          questions_submitted: questionsSubmitted + Number(patch.questions_submitted_in_chapter || 0)
        })
      });

      questionsSubmitted += solved.submitted;
      if (dryRun) {
        checkpoint({
          state: 'previewed',
          stage: 'chapter-previewed',
          chapter_id: chapterId,
          chapter_sequence: chapterSequence,
          chapter_title: chapterTitle
        });
        continue;
      }

      checkpoint({ stage: 'verifying-chapter-completion' });
      const completionConfirmed = await waitForChapterCompletion(client, sectionId, chapterId);
      if (!completionConfirmed) {
        throw new Error(`Chapter ${chapterSequence} received ${solved.correct}/${solved.total} confirmed correct answers, but QUREO has not marked it complete. Stopping before the next chapter.`);
      }

      chaptersCompleted++;
      checkpoint({
        state: 'running',
        stage: 'chapter-completed',
        chapter_id: chapterId,
        chapter_sequence: chapterSequence,
        chapter_title: chapterTitle,
        completed_chapters: chaptersCompleted,
        questions_submitted: questionsSubmitted,
        lesson_id: null,
        question_id: null,
        question_index: null
      });
      onProgress(`  QUREO confirmed chapter ${chapterSequence} as complete.`);

      if (chapterDelayMs > 0 && position < plan.chapters.length - 1) {
        onProgress(`Waiting ${(chapterDelayMs / 1000).toFixed(1)}s before the next chapter`);
        await wait(chapterDelayMs);
      }
    }
  } catch (error) {
    checkpoint({
      state: 'failed',
      stage: lastCheckpoint.stage || 'unknown',
      last_error: error.message,
      completed_chapters: chaptersCompleted,
      questions_submitted: Math.max(questionsSubmitted, Number(lastCheckpoint.questions_submitted || 0))
    });
    throw error;
  }

  const summary = dryRun
    ? `Preview complete: ${plan.chapters.length} chapter(s) selected; no answers submitted.`
    : `Solve run complete: ${chaptersCompleted} chapter(s), ${questionsSubmitted} answer(s) submitted. QUREO responses confirmed the submitted answers as correct.`;

  checkpoint({
    state: dryRun ? 'previewed' : 'completed',
    stage: 'run-completed',
    completed_chapters: chaptersCompleted,
    questions_submitted: questionsSubmitted,
    summary
  });

  return {
    summary,
    startChapter: startLabel,
    endChapter: endLabel,
    chaptersCompleted,
    questionsSubmitted,
    skippedCompleted: plan.skippedCompleted
  };
}
