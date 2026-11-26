export function listSolvableCourses(accountCourses = [], cachedCourses = [], supportsCourse = () => true) {
  const merged = new Map();
  for (const source of [...cachedCourses, ...accountCourses]) {
    const id = String(source?.course_id ?? source?.content_id ?? source?.id ?? '').trim();
    if (!id) continue;

    const title = String(source?.title ?? source?.name ?? '').trim();
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { id, title });
    } else if (!existing.title && title) {
      existing.title = title;
    }
  }

  return [...merged.values()].filter(course => supportsCourse(course.id));
}

export function resolveCourseChoice(value, courses) {
  const choice = String(value ?? '').trim();
  if (!choice || !Array.isArray(courses)) return null;

  if (/^\d+$/u.test(choice)) {
    const index = Number(choice) - 1;
    return Number.isSafeInteger(index) && index >= 0 && index < courses.length
      ? courses[index]
      : null;
  }

  return courses.find(course => course.id === choice) || null;
}

export function displayCourseName(course) {
  if (course.id === 'javascript_ar') return 'JavaScript';
  if (course.id === 'python_short_ar') return 'Python';
  return course.title || course.id;
}
