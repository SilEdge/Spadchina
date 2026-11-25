import test from 'node:test';
import assert from 'node:assert/strict';
import { requestJSON } from '../request-json.js';

test('transient read failure is retried and succeeds', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? { error: 'temporary' } : { status: 'ok' }), { status: calls === 1 ? 503 : 200 });
  });
  assert.deepEqual(await requestJSON('/api/atlas'), { status: 'ok' });
  assert.equal(calls, 2);
});

test('writes and authorization failures are not retried', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response('{}', { status: 503 }); });
  await assert.rejects(requestJSON('/api/duels', { method: 'POST', body: '{}' }), { status: 503 });
  assert.equal(calls, 1);
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response('{}', { status: 401 }); });
  await assert.rejects(requestJSON('/api/me'), { status: 401 });
  assert.equal(calls, 2);
});

test('answer check can retry a temporary failure without retrying scored writes', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/atlas/check');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    return new Response(calls === 1 ? '{}' : '{"correct":true}', { status: calls === 1 ? 503 : 200 });
  });
  assert.deepEqual(await requestJSON('/api/atlas/check', { method: 'POST', body: '{}', retryRead: true }), { correct: true });
  assert.equal(calls, 2);
});
