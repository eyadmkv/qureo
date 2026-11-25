import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { API_BASE, COURSE_ORIGIN } from './http.js';
import { ROOT } from './paths.js';

const ANSWER_ROOT = path.join(ROOT, 'answers');

function integerSetting(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

const LESSON_INIT_WAIT_MS = integerSetting('QUREO_LESSON_INIT_WAIT_MS', 10000, 0, 60000);
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

function openLecturePage(url) {
  if (process.platform !== 'win32') {
    throw new Error('Automatic lecture initialization currently requires Windows.');
  }
  const quotedUrl = url.replace(/'/g, "''");
  const result = spawnSync('pwsh', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Process -FilePath '${quotedUrl}'`
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || 'Could not open the QUREO lesson in your default browser.').trim());
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function markLectureCompleted(client, chapterId, lesson, dryRun, onProgress) {
  const lessonId = lesson?.id ?? lesson?.lecture_id;
  if (lessonId === undefined || lessonId === null) return;
  const endpoint = `/students/lectures/${encodeURIComponent(lessonId)}/complete`;
  const referer = `${COURSE_ORIGIN}/chapter/${chapterId}/lecture/${lessonId}`;
  const lectureUrl = referer;
  if (dryRun) {
    onProgress(`  [dry-run] complete lesson ${lessonId}`);
    return;
  }

  const deadline = Date.now() + LESSON_RETRY_TIMEOUT_MS;
  const submitCompletion = () => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('Lesson completion retry window expired.');
    return client.request(`${API_BASE}${endpoint}`, {
      method: 'PUT',
      headers: { Accept: 'application/json, *.,¨°IÉÈèÉÉÈô°(Ñ¥µ½ÕÑ5Ìè5Ñ ¹µ¥¸¡1MM=9}IEUMQ}Q%5=UQ}5L°Éµ¥¹¥¹5Ì¤(ô¤ì(ôì((±ÐÉÍÁ½¹Íô¹Õ±°ì(±Ð±ÍÑ9ÑÝ½É­ÉÉ½Èô¹Õ±°ì(ÑÉäì(ÉÍÁ½¹ÍôÝ¥ÐÍÕµ¥Ñ½µÁ±Ñ¥½¸ ¤ì(ôÑ ¡ÉÉ½È¤ì(¥ ¥ÍIÑÉå±9ÑÝ½É­ÉÉ½È¡ÉÉ½È¤¤Ñ¡É½ÜÉÉ½Èì(±ÍÑ9ÑÝ½É­ÉÉ½ÈôÉÉ½Èì(ô((½¹ÍÐ¹ÍA%¹¥Ñ¥±¥éÑ¥½¸ôÉÍÁ½¹ÍñðÉÍÁ½¹Í¹ÍÑÑÕÌôôôÐÀÐì(¥¡¹ÍA%¹¥Ñ¥±¥éÑ¥½¸¤ì(½¹AÉ½ÉÍÌ¡±ÍÍ½¸í±ÍÍ½¹%ôèí±ÍÑ9ÑÝ½É­ÉÉ½ÈüÑµÁ½ÉÉä¹ÑÝ½É¬¥±ÕÉèA$ÉÑÕÉ¹ÐÀÐ½ÉÑ¡±ÍÍ½¸Á¥¹¥Ñ¥±¥éôì½Á¹¥¹¥Ð¥¸å½ÕÈÕ±ÐÉ½ÝÍÉ¤ì(½Á¹1ÑÕÉA¡±ÑÕÉUÉ°¤ì(½¹AÉ½ÉÍÌ¡±ÍÍ½¸í±ÍÍ½¹%ôèÝ¥Ñ¥¹í5Ñ ¹¥°¡1MM=9}%9%Q}]%Q}5L¼ÄÀÀÀ¥õÌ½ÈEUI<Ñ¼¥¹¥Ñ¥±¥é¤ì(Ý¥ÐÝ¥Ð¡5Ñ ¹µ¥¸¡1MM=9}%9%Q}]%Q}5L°5Ñ ¹µà À°±¥¹´Ñ¹¹½Ü ¤¤¤¤ì(ô((½È¡±ÐÑÑµÁÐôÄìÑÑµÁÐðô1MM=9}IQIe}QQ5AQLÑ¹¹½Ü ¤ð±¥¹ìÑÑµÁÐ¬¬¤ì(ÑÉäì(ÉÍÁ½¹ÍôÝ¥ÐÍÕµ¥Ñ½µÁ±Ñ¥½¸ ¤ì(±ÍÑ9ÑÝ½É­ÉÉ½Èô¹Õ±°ì(ôÑ ¡ÉÉ½È¤ì(¥ ¥ÍIÑÉå±9ÑÝ½É­ÉÉ½È¡ÉÉ½È¤¤Ñ¡É½ÜÉÉ½Èì(ÉÍÁ½¹Íô¹Õ±°ì(±ÍÑ9ÑÝ½É­ÉÉ½ÈôÉÉ½Èì(ô((¥¡ÉÍÁ½¹Í¥ÍIÑÉå±IÍÁ½¹Í¡ÉÍÁ½¹Í¤¤É¬ì((½¹ÍÐÉµ¥¹¥¹5Ìô±¥¹´Ñ¹¹½Ü ¤ì(¥¡ÑÑµÁÐð1MM=9}IQIe}QQ5AQLÉµ¥¹¥¹5ÌøÀ¤ì(½¹ÍÐ±å5Ìô5Ñ ¹µ¥¸¡1MM=9}IQIe}%9QIY1}5L°Éµ¥¹¥¹5Ì¤ì(½¹ÍÐÉÍ½¸ô±ÍÑ9ÑÝ½É­ÉÉ½È(ü¹ÑÝ½É¬ÉÉ½È í±ÍÑ9ÑÝ½É­ÉÉ½È¹µÍÍô¥(è!QQ@íÉÍÁ½¹Í¹ÍÑÑÕÍõì(½¹AÉ½ÉÍÌ¡±ÍÍ½¸í±ÍÍ½¹%ôèíÉÍ½¹ôìÉÑÉäíÑÑµÁÑô¼í1MM=9}IQIe}QQ5AQMô¥¸í5Ñ ¹¥°¡±å5Ì¼ÄÀÀÀ¥õÍ¤ì(Ý¥ÐÝ¥Ð¡±å5Ì¤ì(ô(ô((¥¡ÉÍÁ½¹Íü¹½¬¤ì(½¹AÉ½ÉÍÌ¡±ÍÍ½¸í±ÍÍ½¹%ôè½µÁ±Ñ¤ì(ÉÑÕÉ¸ì(ô(¥¡ÉÍÁ½¹Íü¹ÍÑÑÕÌôôôÐÀÀñðÉÍÁ½¹Íü¹ÍÑÑÕÌôôôÐÀä¤ì(½¹AÉ½ÉÍÌ¡±ÍÍ½¸í±ÍÍ½¹%ôè±Éä½µÁ±Ñ¤ì(ÉÑÕÉ¸ì(ô((¥ ÉÍÁ½¹Í±ÍÑ9ÑÝ½É­ÉÉ½È¤ì(½¹ÍÐÉÉ½Èô¹ÜÉÉ½È (1ÍÍ½¸í±ÍÍ½¹%ô½Õ±¹½Ð½µÁ±ÑÕÍÑ¡¹ÑÝ½É¬­ÁÐ¥±¥¹ÕÉ¥¹Ñ¡í5Ñ ¹¥°¡1MM=9}IQIe}Q%5=UQ}5L¼ÄÀÀÀ¥õÌÉÑÉäÝ¥¹½Ü¸¡¬å½ÕÈ½¹¹Ñ¥½¸¹ÉÉÕ¸Ñ¡Í½±ÙÈ¸1ÑÈ±ÍÍ½¹Ì¹Ñ¡¡ÁÑÈÍÍÍÍµ¹ÐÝÉ¹½ÐÍÑÉÑ¹(¤ì(ÉÉ½È¹½ô1MM=9}9Q]=I-}Q%5=UPì(ÉÉ½È¹±ÍÍ½¹%ôMÑÉ¥¹¡±ÍÍ½¹%¤ì(ÉÉ½È¹ÕÍô±ÍÑ9ÑÝ½É­ÉÉ½Èì(Ñ¡É½ÜÉÉ½Èì(ô((¥¡ÉÍÁ½¹Íü¹ÍÑÑÕÌôôôÐÀÐ¤ì(½¹ÍÐÉÉ½Èô¹ÜÉÉ½È (1ÍÍ½¸í±ÍÍ½¹%ôÍÑ¥±°ÉÑÕÉ¹Ì!QQ@ÐÀÐÑÈí5Ñ ¹¥°¡1MM=9}IQIe}Q%5=UQ}5L¼ÄÀÀÀ¥õÌ½ÉÑÉ¥Ì¸¡¬Ñ¡Ðå½ÕÈÕ±ÐÉ½ÝÍÈ¥ÌÍ¥¹¥¸Ñ¼Ñ¡ÍµEUI<½Õ¹Ð°½µÁ±ÑÑ¡±ÍÍ½¸Ñ¡É°Ñ¡¸ÉÉÕ¸Ñ¡Í½±ÙÈ¸1ÑÈ±ÍÍ½¹Ì¹Ñ¡¡ÁÑÈÍÍÍÍµ¹ÐÝÉ¹½ÐÍÑÉÑ¹(¤ì(ÉÉ½È¹½ô1MM=9}9=Q}Y%1	1ì(ÉÉ½È¹ÍÑÑÕÌôÐÀÐì(ÉÉ½È¹±ÍÍ½¹%ôMÑÉ¥¹¡±ÍÍ½¹%¤ì(Ñ¡É½ÜÉÉ½Èì(ô((½¹ÍÐ½äôÝ¥ÐÉÍÁ½¹Íü¹ÑáÐ ¤¹Ñ   ¤ôø¤üüì(½¹ÍÐÉÉ½ÈôÉÉ½ÉÉ½µIÍÁ½¹Í¡¹Á½¥¹Ð°ÉÍÁ½¹Í°½äüìµÍÍè½ä¹Í±¥ À°ÈÀÀ¤ôè¹Õ±°¤ì(Ñ¡É½ÜÉÉ½Èì)ô
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
  await requestJson(client, initPath, { method: 'PUT', referer: testReferer });

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

    const completionConfirmed = await waitForChapterCompletion(client, sectionId, chapterId);
    if (!completionConfirmed) {
      throw new Error(`Chapter ${chapter.seq ?? chapterId} received ${solved.correct}/${solved.total} confirmed correct answers, but QUREO has not marked it complete. Stopping before the next chapter.`);
    }
    chaptersCompleted++;
  }

  const summary = dryRun
    ? `Preview complete: chapters ${start.seq ?? start.id}–${end.seq ?? end.id}; no answers submitted.`
    : `Solve run complete: ${chaptersCompleted} chapter(s), ${questionsSubmitted} answer(s) submitted. QUREO responses confirmed the submitted answers as correct.`;
  return { summary, startChapter: start.seq ?? start.id, endChapter: end.seq ?? end.id, chaptersCompleted, questionsSubmitted };
}
