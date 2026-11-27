import fs from 'node:fs';
import path from 'node:path';
import { API_BASE, COURSE_ORIGIN } from './http.js';
import { DATA_DIR } from './paths.js';
import { planChapterSelection } from './solveSelection.js';
import { matchPythonAssessmentAnswers } from './pythonAutoAnswers.js';
import { listRetrievedAssessmentAnswers, saveRetrievedAnswer } from './db.js';
import { QureoLectureBrowser } from './qureoBrowser.js';
import { loadCommunityAnswers, mergeCommunityAnswers } from './communityAnswers.js';

const ANSWER_ROOT = path.join(DATA_DIR, 'answers');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.chapters)) return value.data.chapters;
  if (Array.isArray(value?.chapters)) return value.chapters;
  if (Array.isArray(value?.section?.chapters)) return value.section.chapters;
  if (Array.isArray(value?.questions)) return value.questions;
  return [];
}

export function isCompleted(progress, chapter = null) {
  const explicitlyCompleted = Boolean(
    progress?.completed_at || progress?.is_completed === true || progress?.completed === true
  );
  const questionCount = Number(chapter?.question_count ?? progress?.question_count ?? 0);
  const bestCorrectCount = Number(progress?.best_correct_count ?? 0);
  return explicitlyCompleted ||
    (Number.isInteger(questionCount) && questionCount > 0 &&
      Number.isFinite(bestCorrectCount) && bestCorrectCount >= questionCount);
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
  const answers = mergeCommunityAnswers(parsed.answers, loadCommunityAnswers());
  const recovered = new Set();
  for (const row of listRetrievedAssessmentAnswers()) {
    const questionId = String(row.question_key || '');
    if (!questionId || recovered.has(questionId)) continue;
    if (row.answer_type === 'choice') {
      const choiceId = Number(row.answer_text);
      if (!Number.isFinite(choiceId)) continue;
      answers[questionId] = {
        type: 'choice',
        choice_id: choiceId,
        source: 'qureo-result'
      };
    } else if (row.answer_type === 'code' && String(row.answer_text || '').trim()) {
      answers[questionId] = {
        type: 'description',
        answer_code: row.answer_text,
        source: 'qureo-result'
      };
    } else {
      continue;
    }
    recovered.add(questionId);
  }
  return answers;
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
  fs.writeFileSync(temporaryPath, JSON.stringify(parsed, null, 2) + '\n', {
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

function questionChoiceOptions(item, question) {
  const candidates = [
    item?.choices,
    item?.options,
    item?.choice_options,
    question?.choices,
    question?.options,
    question?.choice_options,
    item?.question?.choices,
    item?.question?.options,
    item?.question?.choice_options
  ];
  return candidates.find(candidate => Array.isArray(candidate) && candidate.length > 0) || [];
}

function choiceOptionId(choice) {
  const value = choice?.id ?? choice?.choice_id ?? choice?.option_id ?? choice?.choice?.id;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizedQuestionType(question, item) {
  return String(question?.type ?? item?.type ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_');
}

export function getQuestionAnswer(item, answers) {
  const question = item?.question || item;
  const id = String(question?.id ?? '');
  const saved = answers[id];
  if (!saved || !id) return null;

  const type = normalizedQuestionType(question, item);
  const choices = questionChoiceOptions(item, question);

  if (saved.type === 'choice') {
    const choiceId = Number(saved.choice_id);
    if (!Number.isSafeInteger(choiceId) || choiceId <= 0) return null;

    const explicitlyDescription = /(?:description|code|text|input|fill|blank|short_answer|program|free_response)/u.test(type);
    if (explicitlyDescription) return null;

    const explicitlyChoice = /(?:choice|select|radio|option|mcq)/u.test(type);
    if (choices.length) {
      if (!choices.some(choice => choiceOptionId(choice) === choiceId)) return null;
    } else if (!explicitlyChoice) {
      return null;
    }

    return { type: 'choice', choice_id: choiceId };
  }

  if (saved.type === 'description') {
    const answerCode = String(saved.answer_code ?? '');
    if (!answerCode.trim()) return null;

    const explicitlyChoice = /(?:choice|select|radio|option|mcq)/u.test(type);
    const supportedDescription = /(?:description|code|text|input|fill|blank|short_answer|program|free_response)/u.test(type);
    if (explicitlyChoice || (type && !supportedDescription) || (!type && choices.length > 0)) return null;

    return { type: 'description', answer_code: answerCode };
  }

  return null;
}

export function prepareQuestionAnswer(item, answers = {}) {
  const question = item?.question || item;
  const questionId = String(question?.id ?? '');
  const savedAnswer = questionId ? answers[questionId] : null;
  const verified = getQuestionAnswer(item, answers);
  if (verified) return { answer: verified, bootstrap: false };

  const type = normalizedQuestionType(question, item);
  const explicitlyChoice = /(?:choice|select|radio|option|mcq|multiple_choice)/u.test(type);
  const explicitlyDescription = /(?:description|code|text|input|fill|blank|short_answer|program|free_response)/u.test(type);
  const choices = questionChoiceOptions(item, question);
  const firstChoiceId = choices.map(choiceOptionId).find(Boolean);

  if (explicitlyChoice || (!type && choices.length > 0)) {
    return firstChoiceId
      ? { answer: { type: 'choice', choice_id: firstChoiceId }, bootstrap: true }
      : null;
  }

  if (explicitlyDescription || !type) {
    if (savedAnswer?.type === 'description' && String(savedAnswer.answer_code ?? '').trim()) {
      return { answer: { type: 'description', answer_code: String(savedAnswer.answer_code) }, bootstrap: false };
    }
    return { answer: { type: 'description', answer_code: 'print(1)' }, bootstrap: true };
  }

  return null;
}

export function extractVerifiedAssessmentAnswers(payload) {
  const result = payload?.result || payload || {};
  const answers = {};

  for (const item of (Array.isArray(result.choice_results) ? result.choice_results : [])) {
    const questionId = String(item.question_id ?? '');
    const correctChoice = (Array.isArray(item.choices) ? item.choices : [])
      .find(choice => choice.correct === true);
    const choiceId = correctChoice?.choice?.id ??
      correctChoice?.id ??
      (item.correct === true ? item.choice_id : null);
    if (!questionId || choiceId === null || choiceId === undefined) continue;
    answers[questionId] = { type: 'choice', choice_id: Number(choiceId) };
  }

  for (const item of (Array.isArray(result.description_results) ? result.description_results : [])) {
    const questionId = String(item.question_id ?? '');
    const answerCode = item.model_answer ??
      (item.correct === true ? item.answer_code : null);
    if (!questionId || answerCode === null || answerCode === undefined || !String(answerCode).trim()) continue;
    answers[questionId] = { type: 'description', answer_code: String(answerCode) };
  }

  return answers;
}

export function getChapterAssessmentResultPath(chapterId, testType = 'review') {
  const resultType = testType === 'test' ? 'test' : 'review';
  return `/students/chapters/${encodeURIComponent(chapterId)}/${resultType}/result`;
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

async function waitForChapterCompletion(client, sectionId, chapterId, expectedQuestions, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const progress = await getProgress(client, sectionId);
    if (isCompleted(progress.get(String(chapterId)), { question_count: expectedQuestions })) return true;
    if (attempt + 1 < attempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
}

export async function initializeLecture(client, lessonId, referer) {
  const pathname = '/lectures/' + encodeURIComponent(lessonId);
  const payload = await requestJson(client, pathname, {
    method: 'GET',
    referer
  });

  if (String(payload?.lecture?.id ?? '') !== String(lessonId)) {
    const error = new Error(`QUREO did not return lesson content for lesson ${lessonId}.`);
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

export async function markLectureCompleted(client, chapterId, lesson, dryRun, onProgress, lectureBrowser) {
  const lessonId = lesson?.id ?? lesson?.lecture_id;
  if (lessonId === undefined || lessonId === null) return;

  const startEndpoint = '/students/lectures/' + encodeURIComponent(lessonId);
  const endpoint = startEndpoint + '/complete';
  const referer = COURSE_ORIGIN + '/chapter/' + chapterId + '/lecture/' + lessonId;
  const requestOptions = {
    method: 'PUT',
    headers: { Accept: 'application/json, */*', Referer: referer }
  };
  if (dryRun) {
    onProgress('  [dry-run] initialize and complete lesson ' + lessonId);
    return;
  }

  let startResponse = null;
  let startError = null;
  try {
    startResponse = await client.request(API_BASE + startEndpoint, requestOptions);
  } catch (error) {
    startError = error;
  }

  const startAccepted = startResponse?.ok ||
    startResponse?.status === 400 || startResponse?.status === 409;
  let response = null;
  let networkError = startError;

  if (startAccepted) {
    try {
      response = await client.request(API_BASE + endpoint, requestOptions);
      networkError = null;
    } catch (error) {
      networkError = error;
    }

    if (response?.ok) {
      onProgress('  lesson ' + lessonId + ': completed');
      return;
    }
    if (response?.status === 400 || response?.status === 409) {
      onProgress('  lesson ' + lessonId + ': already completed');
      return;
    }
    if (response && response.status !== 404) {
      const body = await response.text().catch(() => '');
      throw errorFromResponse(endpoint, response, body ? { message: body.slice(0, 200) } : null);
    }
    if (response?.status === 404) await response.body?.cancel().catch(() => {});
  } else if (startResponse?.status === 404) {
    await startResponse.body?.cancel().catch(() => {});
  } else if (startResponse) {
    const body = await startResponse.text().catch(() => '');
    startError = errorFromResponse(startEndpoint, startResponse, body ? { message: body.slice(0, 200) } : null);
  }

  const reason = !startAccepted
    ? 'lesson initialization was rejected'
    : networkError
      ? 'the direct completion request failed'
      : 'the completion API returned 404';
  onProgress('  lesson ' + lessonId + ': ' + reason + '; opening the actual QUREO lesson in a hidden browser');

  if (!lectureBrowser) {
    throw new Error(
      'Hidden browser initialization is unavailable. Install Chrome or Edge and rerun the solver.' +
      (startError?.message ? ' ' + startError.message : '')
    );
  }

  const browserResult = await lectureBrowser.completeLecture(lessonId, referer);
  if (browserResult.ok) {
    onProgress('  lesson ' + lessonId + ': completed');
    return;
  }
  if (browserResult.status === 400 || browserResult.status === 409) {
    onProgress('  lesson ' + lessonId + ': already completed');
    return;
  }

  const stage = browserResult.stage === 'start' ? 'initialization' : 'completion';
  const error = new Error(
    'QUREO still rejected lesson ' + stage + ' after the lesson page loaded in Chrome: ' +
    endpoint + ' (HTTP ' + browserResult.status + '). ' +
    String(browserResult.body || '').slice(0, 250)
  );
  error.code = 'LESSON_COMPLETION_FAILED';
  error.status = browserResult.status;
  error.lessonId = String(lessonId);
  throw error;
}
export async function solveChapter(client, chapter, chapterMeta, questions, answers, {
  dryRun,
  onProgress,
  onCheckpoint = () => {},
  questionDelayMs = 0,
  lessonsAlreadyCompleted = false,
  lectureBrowser,
  persistRetrievedAnswer = saveRetrievedAnswer
}) {
  const chapterId = String(chapter.id);
  const questionRows = asArray(questions);
  if (!questionRows.length) {
    throw new Error(`Chapter ${chapter.seq ?? chapter.sequence ?? chapterId} returned no assessment questions.`);
  }

  const prepareQuestions = () => questionRows.map(item => {
    const question = item?.question || item;
    const preparedAnswer = prepareQuestionAnswer(item, answers);
    return {
      item,
      question,
      answer: preparedAnswer?.answer || null,
      bootstrap: Boolean(preparedAnswer?.bootstrap)
    };
  });
  let prepared = prepareQuestions();
  const missing = prepared.filter(row => !row.answer);
  const bootstrapCount = prepared.filter(row => row.bootstrap).length;
  if (missing.length) {
    const details = missing.map(({ item, question }) => {
      const id = String(question?.id ?? 'unknown');
      const saved = answers[id];
      const type = normalizedQuestionType(question, item) || 'unspecified';
      const options = questionChoiceOptions(item, question);
      const optionIds = options.map(choiceOptionId).filter(Boolean);
      const stored = saved
        ? `stored=${saved.type}${saved.type === 'choice' ? `(${saved.choice_id})` : ''}`
        : 'no stored answer';
      const optionsText = optionIds.length ? ` live-option-ids=${optionIds.join('/')}` : '';
      return `${id} [${stored}, live-type=${type}${optionsText}]`;
    });
    throw new Error(
      `No verified local solution for question(s): ${details.join('; ')}. No answers were submitted and the chapter was left untouched.`
    );
  }

  const lectures = asArray(chapterMeta?.lectures || chapterMeta?.chapter?.lectures || chapterMeta?.data?.lectures);
  onProgress(`Chapter ${chapter.seq ?? chapter.sequence ?? chapterId}: ${chapter.name || chapter.title || 'Untitled'} | ${lectures.length} lesson(s), ${prepared.length} question(s)`);
  if (bootstrapCount) {
    onProgress(`  using ${bootstrapCount} temporary type-safe answer(s) to retrieve QUREO's official answers`);
  }
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
      const answerPreview = row.answer.type === 'choice'
        ? `choice ${row.answer.choice_id}`
        : JSON.stringify(row.answer.answer_code);
      onProgress(`  [dry-run] question ${row.question.id}: ${answerPreview}`);
    }
    return { submitted: 0, correct: 0, total: prepared.length, attempts: 0, dryRun: true };
  }

  if (!lessonsAlreadyCompleted) {
    for (const lesson of lectures) {
      const lessonId = String(lesson?.id ?? lesson?.lecture_id ?? '');
      onCheckpoint({ stage: 'lesson-start', lesson_id: lessonId, question_id: null, question_index: null });
      await markLectureCompleted(client, chapterId, lesson, false, onProgress, lectureBrowser);
      onCheckpoint({ stage: 'lesson-completed', lesson_id: lessonId });
    }
  }

  const testType = chapter.test_type || chapterMeta?.test_type || chapterMeta?.chapter?.test_type || 'review';
  const endpointKind = testType === 'review' ? 'review-questions' : 'test-questions';
  const testSlug = testType === 'review' ? 'review' : 'test';
  const testReferer = `${COURSE_ORIGIN}/chapter/${chapterId}/${testSlug}`;
  const initPath = `/students/chapters/${encodeURIComponent(chapterId)}/test`;
  const resultPath = getChapterAssessmentResultPath(chapterId, testType);
  const maxAttempts = 3;
  let totalSubmitted = 0;
  let lastCorrectCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    prepared = prepareQuestions();
    const unresolved = prepared.filter(row => !row.answer).map(row => row.question?.id);
    if (unresolved.length) {
      throw new Error(`No answer is available for question(s): ${unresolved.join(', ')}. Stopping before starting another attempt.`);
    }

    onProgress(`  initializing ${testType} attempt ${attempt}/${maxAttempts}`);
    onCheckpoint({
      stage: 'assessment-initializing',
      attempt_number: attempt,
      lesson_id: null,
      question_id: null,
      question_index: null
    });
    await requestJson(client, initPath, { method: 'PUT', referer: testReferer });
    onCheckpoint({ stage: 'assessment-initialized', attempt_number: attempt });

    let submitted = 0;
    let correct = 0;
    const rejected = [];

    for (const [index, row] of prepared.entries()) {
      const questionId = String(row.question.id);
      const answerPath = `/students/${endpointKind}/${encodeURIComponent(questionId)}/answer/${row.answer.type}`;
      const payload = row.answer.type === 'choice'
        ? { choice_id: row.answer.choice_id }
        : { answer_code: row.answer.answer_code };
      onCheckpoint({
        stage: 'question-submitting',
        attempt_number: attempt,
        question_id: questionId,
        question_index: index + 1
      });
      const response = await requestJson(client, answerPath, {
        method: 'PUT',
        body: payload,
        referer: testReferer
      });
      submitted++;
      totalSubmitted++;
      if (response?.result?.correct === true) {
        correct++;
      } else if (response?.result?.correct === false) {
        rejected.push(questionId);
      }

      onCheckpoint({
        stage: 'question-submitted',
        attempt_number: attempt,
        question_id: questionId,
        question_index: index + 1,
        questions_submitted_in_chapter: totalSubmitted
      });

      const status = response?.result?.correct === true
        ? ' | correct'
        : response?.result?.correct === false
          ? ' | incorrect, continuing to retrieve the review answer key'
          : '';
      onProgress(`  attempt ${attempt}: submitted ${submitted}/${prepared.length} | question ${questionId}${status}`);

      if (questionDelayMs > 0 && index < prepared.length - 1) {
        onProgress(`  waiting ${(questionDelayMs / 1000).toFixed(1)}s before the next question`);
        await wait(questionDelayMs);
      }
    }

    let resultPayload;
    try {
      resultPayload = await client.json(resultPath);
    } catch (error) {
      if (correct === prepared.length) {
        return {
          submitted: totalSubmitted,
          correct: prepared.length,
          total: prepared.length,
          attempts: attempt,
          dryRun: false
        };
      }
      throw new Error(
        `Completed all ${submitted}/${prepared.length} questions in attempt ${attempt}, but QUREO did not expose ${testType} result data (${error.message}). ` +
        `Incorrect or unverified question(s): ${rejected.join(', ') || 'unknown'}. No blind retry was started.`
      );
    }

    const result = resultPayload?.result || resultPayload;
    const rawCorrectCount = result?.correct_count;
    const resultCount = rawCorrectCount === undefined || rawCorrectCount === null || rawCorrectCount === ''
      ? null
      : Number(rawCorrectCount);
    lastCorrectCount = Number.isFinite(resultCount) ? resultCount : correct;

    const recovered = extractVerifiedAssessmentAnswers(resultPayload);
    let recoveredCount = 0;
    for (const [questionId, recoveredAnswer] of Object.entries(recovered)) {
      const questionItem = questionRows.find(item =>
        String((item?.question || item)?.id ?? '') === questionId
      );
      const question = questionItem?.question || questionItem || {};
      const questionText = String(
        question.content ?? question.text ?? question.prompt ?? question.description ?? ''
      );
      const answerType = recoveredAnswer.type === 'choice' ? 'choice' : 'code';
      const answerText = recoveredAnswer.type === 'choice'
        ? String(recoveredAnswer.choice_id)
        : recoveredAnswer.answer_code;
      const previous = answers[questionId];
      const changed = recoveredAnswer.type !== previous?.type ||
        (recoveredAnswer.type === 'choice'
          ? Number(previous.choice_id) !== recoveredAnswer.choice_id
          : String(previous.answer_code ?? '') !== recoveredAnswer.answer_code);

      await persistRetrievedAnswer({
        questionKey: questionId,
        questionText,
        answerType,
        answerText,
        explanation: 'Authoritative model answer recovered from a completed QUREO assessment result.',
        sourceUrl: `${API_BASE}${resultPath}`
      });

      answers[questionId] = {
        ...recoveredAnswer,
        source: 'qureo-result'
      };
      if (changed) recoveredCount++;
    }

    onProgress(
      `  QUREO result: ${Number.isFinite(resultCount) ? resultCount : correct}/${prepared.length} correct; ` +
      `recovered ${Object.keys(recovered).length} official answer(s)` +
      (rejected.length ? `; rejected: ${rejected.join(', ')}` : '')
    );

    if (correct === prepared.length || resultCount === prepared.length) {
      return {
        submitted: totalSubmitted,
        correct: prepared.length,
        total: prepared.length,
        attempts: attempt,
        dryRun: false
      };
    }

    if (attempt === maxAttempts || recoveredCount === 0) {
      throw new Error(
        `QUREO confirmed ${lastCorrectCount}/${prepared.length} correct after ${attempt} attempt(s). ` +
        `Recovered ${recoveredCount} new official answer(s). ` +
        `Incorrect or unverified question(s): ${rejected.join(', ') || 'see QUREO result'}.`
      );
    }

    onProgress(`  retrying the chapter with ${recoveredCount} newly recovered QUREO answer(s)`);
  }

  throw new Error(`QUREO did not confirm chapter ${chapterId} after ${maxAttempts} attempts (${lastCorrectCount}/${prepared.length}).`);
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
    completed: isCompleted(progressById.get(String(chapter.id)), chapter)
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
  const lectureBrowser = new QureoLectureBrowser(client, { onProgress });
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
          await markLectureCompleted(client, chapterId, lesson, false, onProgress, lectureBrowser);
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
          const questionsById = new Map(asArray(questions).map(item => {
            const question = item?.question || item;
            return [String(question?.id ?? ''), item];
          }));

          for (const unmatched of inferred.unmatched) {
            const item = questionsById.get(String(unmatched.question_id));
            const question = item?.question || item || {};
            const prompt = String(question.content || question.text || question.prompt || '')
              .replace(/\[\[(?:\/?bdi|\/?bold|\/?code|\/?italic|\/?underline|br)\]\]/giu, ' ')
              .replace(/<[^>]+>/gu, ' ')
              .replace(/\s+/gu, ' ')
              .trim();
            onProgress(`    ${unmatched.question_id}: ${prompt || '(prompt unavailable)'}`);

            const choices = asArray(item?.choices || question?.choices);
            for (const choice of choices) {
              const choiceText = String(choice?.content ?? choice?.text ?? choice?.label ?? choice?.name ?? '')
                .replace(/\[\[(?:\/?bdi|\/?bold|\/?code|\/?italic|\/?underline|br)\]\]/giu, ' ')
                .replace(/<[^>]+>/gu, ' ')
                .replace(/\s+/gu, ' ')
                .trim();
              onProgress(`      [${choice.id ?? '?'}] ${choiceText}`);
            }
          }
        }
      }

      const solved = await solveChapter(client, chapter, chapterMeta, questions, answers, {
        dryRun,
        onProgress,
        questionDelayMs,
        lessonsAlreadyCompleted,
        lectureBrowser,
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
      const completionConfirmed = await waitForChapterCompletion(client, sectionId, chapterId, solved.total);
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
  } finally {
    await lectureBrowser.close();
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
