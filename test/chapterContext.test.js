import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveChapterContext } from '../src/chapterContext.js';

test('initializes each candidate course before resolving a chapter from its section', async () => {
  const calls = [];
  const client = {
    async request(url, options) {
      calls.push({ type: 'page', url, method: options.method });
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      calls.push({ type: 'api', path });
      if (path === '/courses/javascript_ar') return { basic_section: { id: 105 } };
      if (path === '/sections/105') return [{ id: 900001 }];
      if (path === '/courses/python_short_ar') return { basic_section: { id: 106 } };
      if (path === '/sections/106') return [{ id: 511001 }, { id: 511002 }];
      throw new Error(`Unexpected path: ${path}`);
    }
  };

  const result = await resolveChapterContext(client, [
    { id: 'javascript_ar' },
    { id: 'python_short_ar' }
  ], '511002');

  assert.deepEqual(result, { courseId: 'python_short_ar', sectionId: 106 });
  assert.deepEqual(calls, [
    {
      type: 'page',
      url: 'https://me-tp.qureo.education/?content_id=javascript_ar',
      method: 'GET'
    },
    { type: 'api', path: '/courses/javascript_ar' },
    { type: 'api', path: '/sections/105' },
    {
      type: 'page',
      url: 'https://me-tp.qureo.education/?content_id=python_short_ar',
      method: 'GET'
    },
    { type: 'api', path: '/courses/python_short_ar' },
    { type: 'api', path: '/sections/106' }
  ]);
});

test('returns null when no available course contains the requested chapter', async () => {
  const client = {
    async request() {
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      if (path === '/courses/javascript_ar') return { basic_section: { id: 105 } };
      if (path === '/sections/105') return [{ id: 900001 }];
      throw new Error(`Unexpected path: ${path}`);
    }
  };

  assert.equal(
    await resolveChapterContext(client, [{ id: 'javascript_ar' }], '511002'),
    null
  );
});

test('stops when the saved QUREO session has expired', async () => {
  const client = {
    async request() {
      const response = new Response('Unauthorized', { status: 401 });
      return response;
    }
  };

  await assert.rejects(
    resolveChapterContext(client, [{ id: 'python_short_ar' }], '511002'),
    error => error.code === 'AUTH_EXPIRED' && error.status === 401
  );
});
