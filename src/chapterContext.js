import { COURSE_ORIGIN } from './http.js';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.chapters)) return value.data.chapters;
  if (Array.isArray(value?.chapters)) return value.chapters;
  if (Array.isArray(value?.section?.chapters)) return value.section.chapters;
  return [];
}

async function requestCoursePage(client, courseId) {
  const url = `${COURSE_ORIGIN}/?content_id=${encodeURIComponent(courseId)}`;
  const response = await client.request(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  await response.text().catch(() => '');

  if (!response.ok) {
    const error = new Error(`QUREO course page initialization failed for ${courseId} (HTTP ${response.status}).`);
    error.status = response.status;
    error.code = response.status === 401 ? 'AUTH_EXPIRED' : 'COURSE_PAGE_INIT_FAILED';
    throw error;
  }
}

export async function resolveChapterContext(client, courses, chapterId) {
  let lastError = null;

  for (const course of courses || []) {
    const courseId = String(course?.id ?? course?.content_id ?? course ?? '').trim();
    if (!courseId) continue;

    try {
      await requestCoursePage(client, courseId);
      const courseData = await client.json(`/courses/${encodeURIComponent(courseId)}`);
      const sectionId = courseData?.basic_section?.id || courseData?.course?.basic_section?.id;
      if (sectionId === undefined || sectionId === null || sectionId === '') continue;

      const section = await client.json(`/sections/${encodeURIComponent(sectionId)}`);
      if (asArray(section).some(chapter => String(chapter?.id) === String(chapterId))) {
        return { courseId, sectionId };
      }
    } catch (error) {
      if (error?.code === 'AUTH_EXPIRED' || error?.status === 401) throw error;
      lastError = error;
    }
  }

  if (lastError && !(lastError?.status === 403 || lastError?.status === 404)) throw lastError;
  return null;
}


export async function fetchChapterQuestions(client, courses, chapterId) {
  const context = await resolveChapterContext(client, courses, chapterId);
  if (!context) {
    throw new Error(
      `Could not find chapter ${chapterId} in the available QUREO courses. ` +
      'Run qureo sync to refresh the course index, then retry.'
    );
  }

  await client.json(`/students/sections/${encodeURIComponent(context.sectionId)}/chapters`);
  await client.json(`/chapters/${encodeURIComponent(chapterId)}`);
  const questions = await client.json(`/chapters/${encodeURIComponent(chapterId)}/test`);
  return { context, questions };
}
