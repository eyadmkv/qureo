import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountChapterContext, resolveChapterContext } from '../src/chapterContext.js';

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

test('resolves chapter commands from the signed-in account and cached CLI courses', async () => {
  const pageSelections = [];
  const client = {
    async request(url, options) {
      pageSelections.push({ url, method: options.method });
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      if (path === '/courses/javascript_ar') return { basic_section: { id: 105 } };
      if (path === '/sections/105') return [{ id: 900001 }];
      if (path === '/courses/python_short_ar') return { basic_section: { id: 106 } };
      if (path === '/sections/106') return [{ id: 511021 }];
      throw new Error('Unexpected path: ' + path);
    }
  };

  const result = await resolveAccountChapterContext(
    client,
    { available_courses: [{ content_id: 'javascript_ar' }, { content_id: 'python_short_ar' }] },
    [{ course_id: 'javascript_ar' }],
    '511021'
  );

  assert.deepEqual(result, { courseId: 'python_short_ar', sectionId: 106 });
  assert.deepEqual(pageSelections.map(row => new URL(row.url).searchParams.get('content_id')), [
    'javascript_ar',
    'python_short_ar'
  ]);
});

test('infers the supported Python course from a chapter ID when no course metadata is cached', async () => {
  const selected = [];
  const client = {
    async request(url, options) {
      selected.push(new URL(url).searchParams.get('content_id'));
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      if (path === '/courses/python_short_ar') return { basic_section: { id: 106 } };
      if (path === '/sections/106') return [{ id: 511021 }];
      throw new Error('Unexpected path: ' + path);
    }
  };

  assert.deepEqual(
    await resolveAccountChapterContext(client, {}, [], '511021'),
    { courseId: 'python_short_ar', sectionId: 106 }
  );
  assert.deepEqual(selected, ['python_short_ar']);
});

test('infers the supported JavaScript course from a chapter ID when no course metadata is cached', async () => {
  const selected = [];
  const client = {
    async request(url) {
      selected.push(new URL(url).searchParams.get('content_id'));
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      if (path === '/courses/javascript_ar') return { basic_section: { id: 105 } };
      if (path === '/sections/105') return [{ id: 900021 }];
      throw new Error('Unexpected path: ' + path);
    }
  };

  assert.deepEqual(
    await resolveAccountChapterContext(client, {}, [], '900021'),
    { courseId: 'javascript_ar', sectionId: 105 }
  );
  assert.deepEqual(selected, ['javascript_ar']);
});

test('accepts course IDs returned as strings in the account profile', async () => {
  const client = {
    async request() {
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      if (path === '/courses/python_short_ar') return { basic_section: { id: 106 } };
      if (path === '/sections/106') return [{ id: 511021 }];
      throw new Error('Unexpected path: ' + path);
    }
  };

  assert.deepEqual(
    await resolveAccountChapterContext(client, { available_courses: ['python_short_ar'] }, [], '511021'),
    { courseId: 'python_short_ar', sectionId: 106 }
  );
});

test('uses cached courses when the account profile omits its course list', async () => {
  const client = {
    async request() {
      return new Response('<html>QUREO</html>', { status: 200 });
    },
    async json(path) {
      if (path === '/courses/python_short_ar') return { basic_section: { id: 106 } };
      if (path === '/sections/106') return [{ id: 511021 }];
      throw new Error('Unexpected path: ' + path);
    }
  };

  assert.deepEqual(
    await resolveAccountChapterContext(client, {}, [{ course_id: 'python_short_ar' }], '511021'),
    { courseId: 'python_short_ar', sectionId: 106 }
  );
});
