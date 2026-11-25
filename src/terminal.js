export function createProgressBar(value, total, width = 24) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const filled = Math.round(ratio * width);
  return '[' + '='.repeat(filled) + ' '.repeat(width - filled) + '] ' + Math.round(ratio * 100) + '%';
}

export function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}

export function formatDashboardMetrics(stats, compact = false) {
  if (compact) {
    return `${stats.apiCourses} courses · ${stats.apiChapters} chapters · ${stats.apiQuestions} questions · ${stats.customAnswers} saved answers`;
  }
  return [
    `Cached courses   ${stats.apiCourses}`,
    `Cached chapters  ${stats.apiChapters}`,
    `Cached questions ${stats.apiQuestions}`,
    `Saved answers    ${stats.customAnswers}`
  ].join('\n');
}
