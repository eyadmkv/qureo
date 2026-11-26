export const PYTHON_COURSE_ID = 'python_short_ar';

export function resolveSolveTarget(courseOrRange, chapterRange, selectedCourse = null) {
  if (String(courseOrRange ?? '').toLowerCase() === 'python') {
    if (selectedCourse && selectedCourse !== PYTHON_COURSE_ID) {
      throw new Error('The Python shortcut cannot be combined with a different --course value.');
    }
    return {
      courseId: PYTHON_COURSE_ID,
      targetChapter: chapterRange || null
    };
  }

  if (chapterRange !== undefined) {
    throw new Error('Use "qureo solve python <chapterRange>" when selecting the Python course.');
  }

  return {
    courseId: selectedCourse || null,
    targetChapter: courseOrRange || null
  };
}
