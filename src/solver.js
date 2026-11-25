import fs from 'node:fs';
import path from 'node:path';
import { API_BASE, COURSE_ORIGIN } from './http.js';
import { ROOT } from './paths.js';

const ANSWER_ROOT = path.join(ROOT, 'answers');

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

function resolveTargetIndex(chapters, target) {
  if (target === null || target === undefined || String(target).trim() === '') return chapters.length - 1;
  const value = String(target).trim();
  const byId = chapters.findIndex(ch => String(ch.id) === value);
  if (byId >= 0) return byId;
  const numeric = Number(value);
  if (Number.isInteger(numeric)) {
    return chapters.findIndex(ch => Number(ch.seq ?? ch.sequence) === numeric);
  }
  return -1;
}

function getQuestionAnswer(item, answers) {
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

async function getProgress(client, sectionId) {
  const raw = await client.json(`/students/sections/${encodeURIComponent(sectionId)}/chapters`).catch(() => []);
  return new Map(asArray(raw).map(row => [String(row.chapter_id), row]));
}

async function markLectureCompleted(client, chapterId, lesson, dryRun, onProgress) {
  const lessonId = lesson?.id ?? lesson?.lecture_id;
  if (lessonId === undefined || lessonId === null) return;
  const endpoint = `/students/lectures/${encodeURIComponent(lessonId)}/complete`;
  const referer = `${COURSE_ORIGIN}/chapter/${chapterId}/lecture/${lessonId}`;
  if (dryRun) {
    onProgress(`  [dry-run] complete lesson ${lessonId}`);
    return;
  }
  const response = await client.request(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers: { Accept: 'application/json, */*', Referer: referer }
  });
  if (response.ok) {
    onProgress(`  lesson ${lessonId}: completed`);
    return;
  }
  const body = await response.text().catch(() => '');
  if (response.status === 400 || response.status === 409) {
    onProgress(`  lesson ${lessonId}: already completed`);
    return;
  }
  const error = errorFromResponse(endpoint, response, body ? { message: body.slice(0, 200) } : null);
  throw error;
}

async function solveChapter(client, chapter, chapterMeta, questions, answers, { dryRun, onProgress }) {
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

  if (dryRun) {
    for (const row of prepared) {
      onProgress(`  [dry-run] question ${row.question.id}: ${row.answer.type === 'choice' ? `choice ${row.answer.choice_id}` : 'code answer ready'}`);
    }
    return { submitted: 0, correct: 0, total: prepared.length, dryRun: true };
  }

  for (const lesson of lectures) {
    await markLectureCompleted(client, chapterId, lesson, false, onProgress);
  }

  const testType = chapter.test_type || chapterMeta?.test_type || chapterMeta?.chapter?.test_type || 'review';
  const endpointKind = testType === 'review' ? 'review-questions' : 'test-questions';
  const testSlug = testType === 'review' ? 'review' : 'test';
  const testReferer = `${COURSE_ORIGIN}/chapter/${chapterId}/${testSlug}`;
  const initPath = `/students/chapters/${encodeURIComponent(chapterId)}/test`;
  onProgress(`  initializing ${testType} attempt`);
  await requestJson(client, initPath, { method: 'PUT', body: {}, referer: testReferer });

  let submitted = 0;
  let correct = 0;
  for (const row of prepared) {
    const questionId = String(row.question.id);
    const answerPath = `/students/${endpointKind}/${encodeURIComponent(questionId)}/answer/${row.answer.type}`;
    const payload = row.answer.type === 'choice'
      ? { choice_id: row.answer.choice_id }
      : { answer_code: row.answer.answer_code };
    const result = await requestJson(client, answerPath, { method: 'PUT', body: payload, referer: testReferer });
    submitted++;
    if (result?.result?.correct === true) correct++;
    if (result?.result?.correct === false) {
      throw new Error(`QUREO marked question ${questionId} incorrect. Submitted ${submitted}/${prepared.length}; stopping before the next chapter.`);
    }
    onProgress(`  submitted ${submitted}/${prepared.length} | question ${questionId}${result?.result?.correct === true ? ' | correct' : ''}`);
  }

  let resultPayload = null;
  try {
    resultPayload = await client.json(`/students/chapters/${encodeURIComponent(chapterId)}/test/result`);
  } catch {
    // The per-question submission responses remain the available verification source.
  }
  const result = resultPayload?.result || resultPayload;
  const correctCount = Number.isFinite(Number(result?.correct_count)) ? Number(result.correct_count) : correct;
  const verifiedAll = correctCount === prepared.length && (correct === prepared.length || Number.isFinite(Number(result?.correct_count)));
  if (!verifiedAll) {
    throw new Error(`Submitted ${submitted}/${prepared.length} answers, but QUREO did not confirm a complete correct result. Stopping here.`);
  }

  return { submitted, correct: correctCount, total: prepared.length, dryRun: false };
}

export async function solveCourse(client, {
  courseId = 'javascript_ar',
  targetChapter = null,
  dryRun = false,
  onProgress = message => console.log(message)
} = {}) {
  const answers = loadAnswers(courseId);
  const courseRaw = await client.json(`/courses/${encodeURIComponent(courseId)}`);
  const sectionId = courseRaw?.basic_section?.id || courseRaw?.course?.basic_section?.id;
  if (!sectionId) throw new Error(`Course ${courseId} did not return basic_section.id.`);

  const sectionRaw = await client.json(`/sections/${encodeURIComponent(sectionId)}`);
  const chapters = asArray(sectionRaw).sort((a, b) => Number(a.seq ?? a.sequence ?? 0) - Number(b.seq ?? b.sequence ?? 0));
  if (!chapters.length) throw new Error(`No chapters found for course ${courseId}.`);

  const targetIndex = resolveTargetIndex(chapters, targetChapter);
  if (targetIndex < 0) throw new Error(`Target chapter "${targetChapter}" was not found by chapter sequence or ID.`);

  const progressById = await getProgress(client, sectionId);
  const startIndex = chapters.findIndex(ch => !isCompleted(progressById.get(String(ch.id))));
  if (startIndex < 0) {
    const summary = `All ${chapters.length} chapters are already marked complete.`;
    onProgress(summary);
    return { summary, startChapter: null, endChapter: null, chaptersCompleted: 0 };
  }
  if (targetIndex < startIndex) {
    throw new Error(`Target chapter ${targetChapter} is before the first unfinished chapter ${chapters[startIndex].seq ?? startIndex + 1}.`);
  }

  const start = chapters[startIndex];
  const end = chapters[targetIndex];
  onProgress(`Account progress: starting at chapter ${start.seq ?? startIndex + 1} (${start.name || start.title || start.id}), through chapter ${end.seq ?? targetIndex + 1}.`);
  if (dryRun) onProgress('Dry run enabled: no completion or answer requests will be sent.');

  let chaptersCompleted = 0;
  let questionsSubmitted = 0;
  for (let index = startIndex; index <= targetIndex; index++) {
    const chapter = chapters[index];
    const chapterId = String(chapter.id);
    if (isCompleted(progressById.get(chapterId))) {
      onProgress(`Skipping chapter ${chapter.seq ?? index + 1}: already complete.`);
      continue;
    }

    const chapterMeta = await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
    const questions = await client.json(`/chapters/${encodeURIComponent(chapterId)}/test`);
    const solved = await solveChapter(client, chapter, chapterMeta, questions, answers, { dryRun, onProgress });
    questionsSubmitted += solved.submitted;
    if (dryRun) continue;

    const updatedProgress = await getProgress(client, sectionId);
    if (!isCompleted(updatedProgress.get(chapterId)) && solved.correct !== solved.total) {
      throw new Error(`Chapter ${chapter.seq ?? chapterId} submissions were accepted, but QUREO has not marked the chapter complete yet. Stopping before the next chapter.`);
    }
    chaptersCompleted++;
  }

  const summary = dryRun
    ? `Preview complete: chapters ${start.seq ?? start.id}–${end.seq ?? end.id}; no answers submitted.`
    : `Solve run complete: ${chaptersCompleted} chapter(s), ${questionsSubmitted} answer(s) submitted. QUREO responses confirmed the submitted answers as correct.`;
  return { summary, startChapter: start.seq ?? start.id, endChapter: end.seq ?? end.id, chaptersCompleted, questionsSubmitted };
}
