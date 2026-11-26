import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLectureCompletionScript, toCdpCookie } from '../src/qureoBrowser.js';

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

  assert.match(script, /fetch\('\/api\/study\/students\/lectures\/511002030\/complete'/);
  assert.match(script, /method: 'PUT'/);
  assert.match(script, /credentials: 'include'/);
});
