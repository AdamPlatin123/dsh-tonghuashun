import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMetricsService } from '../src/host/service.js';
import { createLedgerHandler } from '../src/http.js';

const root = path.resolve('output/acceptance-project');
const source = path.join(root, 'src/ledger.js');
const data = path.resolve('work/preview-data/acceptance-ledger.json');
await mkdir(path.dirname(source), { recursive: true });
try { await readFile(source); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(source, Array.from({ length: 114832 }, (_, i) => `export const entry${i} = ${i};`).join('\n') + '\n');
}
const service = await createMetricsService({ file: data, onError: error => console.error(error.message) });
await service.ensureProject(root);
const session = { id: 'acceptance-session', header: { id: 'acceptance-session', cwd: root } };
async function edit(kind) {
  const before = await readFile(source, 'utf8');
  const lines = before.trimEnd().split('\n');
  if (kind === 'delete' && lines.length < 10000) throw new Error('验收文件剩余行数不足');
  const after = kind === 'delete' ? lines.slice(0, -10000).join('\n') + '\n'
    : [...lines, ...Array.from({ length: 10000 }, (_, i) => `export const entry${lines.length + i} = ${lines.length + i};`)].join('\n') + '\n';
  await service.capture({ callId: randomUUID(), name: 'edit', arguments: { file_path: source }, agent: { session } }, async () => {
    await writeFile(source, after);
    return { isError: false, value: { path: source, before, after } };
  });
}
// 首次验收种子来自真实落盘修改；不伪造 Token 或历史时间。
if (!service.getProject(root).records.length) {
  for (const delta of [110, -40, 260, -120, 180, 95, -70, 310, -130, 160, 230, -90]) {
    const before = await readFile(source, 'utf8');
    const lines = before.trimEnd().split('\n');
    const after = delta > 0 ? [...lines, ...Array.from({ length: delta }, (_, i) => `export const entry${lines.length + i} = ${lines.length + i};`)].join('\n') + '\n' : lines.slice(0, delta).join('\n') + '\n';
    await service.capture({ callId: randomUUID(), name: 'edit', arguments: { file_path: source }, agent: { session } }, async () => {
      await writeFile(source, after);
      return { value: { path: source, before, after }, isError: false };
    });
  }
}
// 外部改动：直接落盘、不经 capture，因此没有 Agent 归属，只会形成一次外部校准和一根灰色未归属柱。
const EXTERNAL_LINES = 250;
let externalAdded = false;
async function external() {
  const before = await readFile(source, 'utf8');
  const lines = before.trimEnd().split('\n');
  if (!externalAdded && lines.length < EXTERNAL_LINES) throw new Error('验收文件剩余行数不足');
  const after = externalAdded
    ? lines.slice(0, -EXTERNAL_LINES).join('\n') + '\n'
    : [...lines, ...Array.from({ length: EXTERNAL_LINES }, (_, i) => `export const external${lines.length + i} = ${lines.length + i};`)].join('\n') + '\n';
  await writeFile(source, after);
  externalAdded = !externalAdded;
  return service.ensureProject(root);
}
const ledger = createLedgerHandler(service, { preview: true });
let operation = Promise.resolve();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/tonghuashun/ledger') return ledger(req, res);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (url.pathname === '/preview/config') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ root })); return; }
    if (url.pathname === '/preview/action' && req.method === 'POST') {
      if (req.headers.origin !== url.origin) { res.writeHead(403); res.end(); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 200) throw new Error('请求过长'); }
      const { kind } = JSON.parse(body);
      if (!['delete', 'restore', 'external'].includes(kind)) throw new Error('未知操作');
      const pending = operation.then(() => kind === 'external' ? external() : edit(kind)); operation = pending.catch(() => {}); await pending;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true })); return;
    }
    const files = { '/preview.js': ['dist/preview.js', 'text/javascript'], '/styles.css': ['dist/styles.css', 'text/css'] };
    if (files[url.pathname]) { const [file, type] = files[url.pathname]; res.setHeader('Content-Type', `${type}; charset=utf-8`); res.end(await readFile(file)); return; }
    if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeepSeek Harness · 同花顺皮肤验收</title><link rel="stylesheet" href="/styles.css"></head><body class="ths-preview-body"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
  } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
});
let port = 4317;
while (true) {
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); break; }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; port++; }
}
console.log(`Preview: http://127.0.0.1:${port}`);
console.log(`Acceptance project: ${root}`);
