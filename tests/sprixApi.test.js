import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSprixCookieHeader, SprixHttpClient } from '../src/sprixHttp.js';

test('parses a Cookie request header', () => {
  assert.equal(
    parseSprixCookieHeader('Cookie: session=abc123; XSRF-TOKEN=xyz'),
    'session=abc123; XSRF-TOKEN=xyz'
  );
});

test('extracts cookies from a copied cURL command', () => {
  const curl = "curl 'https://egy.app.spx-learning-square.com/api/v1/subjects/7/curriculum' -H 'accept: application/json' -H 'cookie: session=abc123; XSRF-TOKEN=xyz'";
  assert.equal(parseSprixCookieHeader(curl), 'session=abc123; XSRF-TOKEN=xyz');
});

test('accepts a raw single-line cookie string', () => {
  assert.equal(parseSprixCookieHeader('session=abc123; token=xyz'), 'session=abc123; token=xyz');
});

test('rejects missing or multiline cookie values', () => {
  assert.throws(() => parseSprixCookieHeader(''), /Clipboard is empty/u);
  assert.throws(() => parseSprixCookieHeader('Authorization: Bearer token'), /No Cookie header/u);
  assert.throws(() => parseSprixCookieHeader('session=abc\nSet-Cookie: leaked=value'), /No Cookie header/u);
});

test('restricts the client to HTTPS SPRIX origins', () => {
  assert.throws(() => new SprixHttpClient({ cookie: 'session=x', origin: 'https://example.com' }), /Only HTTPS/u);
  assert.throws(() => new SprixHttpClient({ cookie: 'session=x', origin: 'http://egy.app.spx-learning-square.com' }), /Only HTTPS/u);
});

test('fetches curriculum with the saved cookie and expected origin', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ success: true, data: [{ id: 1, title: 'Unit' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const http = new SprixHttpClient({ cookie: 'session=abc123', fetchImpl });
  const result = await http.getCurriculum(7);
  assert.equal(result.length, 1);
  assert.equal(captured.url, 'https://egy.app.spx-learning-square.com/api/v1/subjects/7/curriculum');
  assert.equal(captured.options.method, 'GET');
  assert.equal(new Headers(captured.options.headers).get('cookie'), 'session=abc123');
  assert.equal(new Headers(captured.options.headers).get('origin'), 'https://egy.app.spx-learning-square.com');
  assert.equal(captured.options.redirect, 'manual');
});

test('blocks requests outside the same-origin SPRIX API path', async () => {
  const http = new SprixHttpClient({ cookie: 'session=x', fetchImpl: async () => {
    throw new Error('fetch should not run');
  } });
  await assert.rejects(() => http.request('https://example.com/api/v1/subjects/7/curriculum'), /Blocked SPRIX request/u);
  await assert.rejects(() => http.request('/account/profile'), /Blocked SPRIX request/u);
});

test('submits a chapter answer with the observed POST payload', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ success: true, data: { is_correct: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const http = new SprixHttpClient({ cookie: 'session=x', fetchImpl });
  const result = await http.answerChapterQuestion(120, 8, 4001, 1);
  assert.equal(result.data.is_correct, true);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.url, 'https://egy.app.spx-learning-square.com/api/v1/chapters/120/answer');
  assert.deepEqual(JSON.parse(captured.options.body), {
    block_id: 8,
    selected_option_id: 4001,
    hint_used: 1
  });
});

test('submits a test answer with the observed PUT payload', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const http = new SprixHttpClient({ cookie: 'session=x', fetchImpl });
  await http.answerTestQuestion(77, 9001, 8002);
  assert.equal(captured.options.method, 'PUT');
  assert.equal(captured.url, 'https://egy.app.spx-learning-square.com/api/v1/tests/77/questions/9001/answer');
  assert.deepEqual(JSON.parse(captured.options.body), { selected_option_id: 8002 });
});

test('does not retry a failed state-changing request', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error('connection lost');
  };
  const http = new SprixHttpClient({ cookie: 'session=x', fetchImpl });
  await assert.rejects(() => http.completeChapter(120), /network request failed/u);
  assert.equal(calls, 1);
});
