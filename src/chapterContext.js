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

export async function resolveAccountChapterContext(client, user, cachedCourses, chapterId) {
  const courses = new Map();
  for (const course of user?.available_courses || []) {
    const rawId = typeof course === 'string'
      ? course
      : course?.content_id ?? course?.course_id ?? course?.id;
    const id = String(rawId ?? '').trim();
    if (id) courses.set(id, { id });
  }
  for (const course of cachedCourses || []) {
    const id = String(course?.course_id ?? course?.content_id ?? course?.id ?? '').trim();
    if (id && !courses.has(id)) courses.set(id, { id });
  }

  const chapterKey = String(chapterId ?? '');
  const hintedCourseId = chapterKey.startsWith('511')
    ? 'python_short_ar'
    : chapterKey.startsWith('900')
      ? 'javascript_ar'
      : null;
  if (hintedCourseId && !courses.has(hintedCourseId)) {
    courses.set(hintedCourseId, { id: hintedCourseId });
  }

  if (!courses.size) {
    throw new Error('QUREO did not return any available, cached or recognizable course for this chapter. Run qureo sync, then retry.');
  }
  return resolveChapterContext(client, [...courses.values()], chapterId);
}
