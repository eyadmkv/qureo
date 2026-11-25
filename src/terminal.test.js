import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressBar, formatDuration } from './terminal.js';

test('progress bars clamp values and render the expected percentage', () => {
  assert.equal(createProgressBar(5, 10, 10), '[=====     ] 50%');
  assert.equal(createProgressBar(20, 10, 4), '[====] 100%');
  assert.equal(createProgressBar(-1, 10, 4), '[    ] 0%');
});

test('duration formatter handles seconds and minutes', () => {
  assert.equal(formatDuration(59000), '59s');
  assert.equal(formatDuration(125000), '2m 5s');
});
