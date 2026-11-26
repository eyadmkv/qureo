import test from 'node:test';
import assert from 'node:assert/strict';
import { displayCourseName, listSolvableCourses, resolveCourseChoice } from '../src/courseSelection.js';

test('lists supported cached and account courses without duplicates', () => {
  const courses = listSolvableCourses(
    [
      { content_id: 'javascript_ar', name: 'JavaScript course' },
      { content_id: 'python_short_ar', name: 'Python course' },
      { content_id: 'javascript_trial_ar', name: 'JavaScript trial' }
    ],
    [
      { course_id: 'javascript_ar', title: 'JavaScript course', section_id: 5 },
      { course_id: 'python_short_ar', title: 'Python コース', section_id: 106 }
    ],
    id => id !== 'javascript_trial_ar'
  );

  assert.deepEqual(courses, [
    { id: 'javascript_ar', title: 'JavaScript course' },
    { id: 'python_short_ar', title: 'Python コース' }
  ]);
});

test('resolves interactive course choices by number or exact ID', () => {
  const courses = [
    { id: 'javascript_ar', title: 'JavaScript course' },
    { id: 'python_short_ar', title: 'Python course' }
  ];

  assert.equal(resolveCourseChoice('1', courses).id, 'javascript_ar');
  assert.equal(resolveCourseChoice('2', courses).id, 'python_short_ar');
  assert.equal(resolveCourseChoice('python_short_ar', courses).id, 'python_short_ar');
  assert.equal(resolveCourseChoice('3', courses), null);
  assert.equal(resolveCourseChoice('unknown', courses), null);
  assert.equal(resolveCourseChoice('', courses), null);
});

test('uses concise labels for the supported JavaScript and Python courses', () => {
  assert.equal(displayCourseName({ id: 'javascript_ar', title: 'JavaScript course' }), 'JavaScript');
  assert.equal(displayCourseName({ id: 'python_short_ar', title: 'Python コース' }), 'Python');
  assert.equal(displayCourseName({ id: 'other', title: 'Other course' }), 'Other course');
});
