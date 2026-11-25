import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressBar, formatDuration, formatDashboardMetrics } from './terminal.js';

test('progress bars clamp values and render the expected percentage', () => {
  assert.equal(createProgressBar(5, 10, 10), '[=====     ] 50%');
  assert.equal(createProgressBar(20, 10, 4), '[====] 100%');
  assert.equal(createProgressBar(-1, 10, 4), '[    ] 0%');
});

test('duration formatter handles seconds and minutes', () => {
  assert.equal(formatDuration(59000), '59s');
  assert.equal(formatDuration(125000), '2m 5s');
});

test('compact dashboard metrics collapse into one line', () => {
  const stats = { apiCourses: 1, apiChapters: 42, apiQuestions: 271, customAnswers: 3 };
  assert.equal(formatDashboardMetrics(stats, true), '1 courses · 42 chapters · 271 questions · 3 saved answers');
  assert.equal(formatDashboardMetrics(stats, false).split('\n').length, 4);
});
