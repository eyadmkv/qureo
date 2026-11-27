import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLectureCompletionScript, toCdpCookie, waitForApiIdle } from '../src/qureoBrowser.js';

test('maps host-only session cookies to an exact HTTPS URL', () => {
  const result = toCdpCookie({
    name: 'student_token',
    value: 'secret',
    domain: 'me-tp.qureo.education',
    hostOnly: true,
    path: '/',
    secure: true,
    expires: null
  });

  assert.deepEqual(result, {
    name: 'student_token',
    value: 'secret',
    path: '/',
    secure: true,
    httpOnly: false,
    url: 'https://me-tp.qureo.education/'
  });
});

test('maps domain cookies and converts expiry to CDP seconds', () => {
  const expires = Date.now() + 60000;
  const result = toCdpCookie({
    name: 'shared',
    value: 'value',
    domain: 'qureo.education',
    hostOnly: false,
    path: '/api',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    expires
  });

  assert.equal(result.domain, '.qureo.education');
  assert.equal(result.path, '/api');
  assert.equal(result.httpOnly, true);
  assert.equal(result.sameSite, 'Lax');
  assert.equal(result.expires, expires / 1000);
  assert.equal('url' in result, false);
});

test('builds a same-origin lesson completion request for the browser page', () => {
  const script = buildLectureCompletionScript('511002030');

  const startRequest = script.indexOf("fetch('/api/study/students/lectures/511002030'");
  const completionRequest = script.indexOf("fetch('/api/study/students/lectures/511002030/complete'");
  assert.notEqual(startRequest, -1);
  assert.notEqual(completionRequest, -1);
  assert.ok(startRequest < completionRequest);
  assert.match(script, /stage: 'start'/);
  assert.match(script, /stage: 'complete'/);
  assert.match(script, /method: 'PUT'/);
  assert.match(script, /credentials: 'include'/);
});


test('returns immediately when API requests have already been quiet long enough', async () => {
  let sleepCalls = 0;
  const result = await waitForApiIdle({
    inFlightApi: new Set(),
    getLastApiActivity: () => 9000,
    quietWindowMs: 650,
    timeoutMs: 1500,
    now: () => 10000,
    sleepImpl: async () => { sleepCalls++; }
  });

  assert.equal(result, true);
  assert.equal(sleepCalls, 0);
});

test('waits for active API requests and then the quiet window', async () => {
  let currentTime = 0;
  let lastActivity = 0;
  const inFlightApi = new Set(['request-1']);

  const result = await waitForApiIdle({
    inFlightApi,
    getLastApiActivity: () => lastActivity,
    quietWindowMs: 200,
    timeoutMs: 1000,
    pollIntervalMs: 50,
    now: () => currentTime,
    sleepImpl: async ms => {
      currentTime += ms;
      if (currentTime >= 150 && inFlightApi.size) {
        inFlightApi.clear();
        lastActivity = currentTime;
      }
    }
  });

  assert.equal(result, true);
  assert.equal(currentTime, 350);
});

test('returns false when API activity never becomes idle before timeout', async () => {
  let currentTime = 0;
  const result = await waitForApiIdle({
    inFlightApi: new Set(['request-1']),
    getLastApiActivity: () => 0,
    quietWindowMs: 200,
    timeoutMs: 250,
    pollIntervalMs: 50,
    now: () => currentTime,
    sleepImpl: async ms => { currentTime += ms; }
  });

  assert.equal(result, false);
  assert.equal(currentTime, 250);
});
