import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLedgerHandler } from '../src/http.js';

async function run(t) {
  let cleared = false;
  const service = {
    listProjects: async () => [{ root: '/project', currentLines: 12000 }],
    getProject: async root => root === '/project' ? { root, currentLines: 12000, records: [], usage: {} } : undefined,
    clearProject: async () => { cleared = true; },
  };
  const server = http.createServer(createLedgerHandler(service));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, cleared: () => cleared };
}
test('serves known project statistics without allowing arbitrary directory reads', async t => {
  const { url } = await run(t);
  const response = await fetch(`${url}/tonghuashun/ledger?root=/project`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).project.currentLines, 12000);
  assert.equal((await fetch(`${url}/tonghuashun/ledger?root=/etc`)).status, 404);
});
test('blocks foreign origin and requires explicit same-origin clear request', async t => {
  const { url, cleared } = await run(t);
  assert.equal((await fetch(`${url}/tonghuashun/ledger`, { headers: { Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await fetch(`${url}/tonghuashun/ledger?root=/project`, { method: 'DELETE' })).status, 403);
  assert.equal(cleared(), false);
  const response = await fetch(`${url}/tonghuashun/ledger?root=/project`, { method: 'DELETE', headers: { Origin: url, 'X-THS-Confirm': 'clear-project-statistics' } });
  assert.equal(response.status, 200);
  assert.equal(cleared(), true);
});
