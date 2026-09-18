import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { createMetricsService } from '../src/host/service.js';

const installed = 'C:/Program Files/DSH Desktop/resources/app.asar.unpacked';
const available = existsSync(path.join(installed, 'package.json')) && existsSync('dist/client.js');

test('installed ToolRuntime and guarded filesystem persist a real 10000-line deletion and restore', { skip: !available }, async t => {
  const require = createRequire(path.join(installed, 'package.json'));
  const { Context } = require('@deepseek-ai/cordis');
  const { ToolRuntime } = require('@deepseek-ai/dsh-tools');
  const { LocalFileSystem } = require('@deepseek-ai/dsh-fs-local');
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-real-tools-'));
  const root = path.join(directory, 'project');
  await mkdir(root);
  const content = 'retained\n' + Array.from({ length: 10000 }, (_, i) => `line ${i}\n`).join('');
  const source = path.join(root, 'acceptance.txt');
  await writeFile(source, content);
  const file = path.join(directory, 'data/ledger.json');
  const service = await createMetricsService({ file });
  t.after(() => service.close());
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder: () => 0 });
  ctx.plugin(ToolRuntime);
  ctx.plugin(LocalFileSystem, { cwd: root });
  ctx.plugin(require('@deepseek-ai/dsh-fs-observation-policy'));
  ctx.plugin(require('@deepseek-ai/dsh-tool-fs'));
  ctx.on('tools/execute', (exec, next) => service.capture(exec, next));
  for (let i = 0; i < 100 && !ctx.tools?.get('write'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(ctx.tools?.get('write'), 'installed file tools are ready');
  const agent = { session: { id: 'real-filesystem-session', header: { id: 'real-filesystem-session', cwd: root } } };
  let call = 0;
  const execute = (name, args) => ctx.tools.execute({ name, arguments: args, callId: `real-${++call}`, agent, signal: new AbortController().signal });
  const denied = await execute('write', { file_path: source, content: 'retained\n' });
  assert.equal(denied.isError, true, 'unobserved overwrite must be refused');
  assert.equal(service.getProject(root).records.length, 0);
  const observed = await execute('read', { file_path: source, offset: 1, limit: 1 });
  assert.equal(observed.isError, false);
  const deleted = await execute('write', { file_path: source, content: 'retained\n' });
  assert.equal(deleted.isError, false, JSON.stringify(deleted.error));
  assert.equal(await readFile(source, 'utf8'), 'retained\n');
  const restored = await execute('edit', { file_path: source, old_string: 'retained\n', new_string: content });
  assert.equal(restored.isError, false, JSON.stringify(restored.error));
  assert.equal(await readFile(source, 'utf8'), content);
  await service.close();
  const reopened = await createMetricsService({ file });
  try {
    const project = reopened.getProject(root);
    assert.equal(project.records.length, 2);
    assert.deepEqual(project.records.map(({ open, close, added, deleted, kind }) => ({ open, close, added, deleted, kind })), [
      { open: 10001, close: 1, added: 0, deleted: 10000, kind: 'edit' },
      { open: 1, close: 10001, added: 10000, deleted: 0, kind: 'restore' },
    ]);
  } finally { await reopened.close(); }
});

/** 本机构建产物，以及真正部署到 Profile、由 web 客户端加载的那一份。 */
function clientBundles() {
  const home = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh');
  const deployed = path.join(home, 'profiles/desktop/node_modules/dsh-tonghuashun/dist/client.js');
  return [...new Set([path.resolve('dist/client.js'), deployed])].filter(existsSync);
}

async function mountClient(bundlePath) {
  const installedRequire = createRequire(path.join(installed, 'package.json'));
  const localRequire = createRequire(import.meta.url);
  const cordis = installedRequire('@deepseek-ai/cordis');
  const ctx = new cordis.Context();
  const cache = new Map();
  const styles = [];
  const document = {
    body: { style: { getPropertyValue: () => '' } },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '', remove() { const at = styles.indexOf(this); if (at >= 0) styles.splice(at, 1); } }),
    head: { appendChild(style) { styles.push(style); } },
  };
  const sandbox = vm.createContext({ window: {}, document, navigator: { language: 'zh-CN', platform: 'Win32', userAgent: 'DSH integration test' }, console, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout, queueMicrotask, TextEncoder, TextDecoder, URL,
    localStorage: { getItem: () => null, setItem() {} } });
  const requireModule = id => {
    if (cache.has(id)) return cache.get(id);
    if (id === '@deepseek-ai/cordis') return cordis;
    if (id.startsWith('react')) return localRequire(id);
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {};
    if (id === '@deepseek-ai/dsh-client-store') return installedRequire(id);
    return installedRequire(id);
  };
  sandbox.window.__ModuleLoader__ = { load({ id, factory }) { cache.set(id, factory(requireModule)); } };
  for (const name of ['dsh-client-ui-renderer', 'dsh-client-ui-theme']) {
    vm.runInContext(readFileSync(path.join(installed, 'node_modules/@deepseek-ai', name, 'lib/client.js'), 'utf8'), sandbox, { filename: name });
  }
  const { SlotRegistry } = cache.get('@deepseek-ai/dsh-client-ui-renderer');
  const { ThemeRuntime } = cache.get('@deepseek-ai/dsh-client-ui-theme');
  const slots = new SlotRegistry(ctx);
  const theme = new ThemeRuntime(ctx, { getSnapshot: () => ({ value: undefined }), subscribe: () => () => {} });
  ctx.provide('theme', theme);
  let openDetails = 0;
  ctx.provide('layout', { openDetails() { openDetails++; }, closeDetails() {} });
  const slotNames = ['conversation.session.header.utilities', 'settings.general.item'];
  slots.register({ name: 'root', children: { ...Object.fromEntries(slotNames.map(name => [name, { kind: 'list', scope: name.startsWith('conversation.') ? 'session' : 'root' }])), details: { kind: 'single', scope: 'session' } } }, () => null);
  const originalDetails = () => null;
  slots.register({ name: 'details' }, originalDetails);
  vm.runInContext(readFileSync(bundlePath, 'utf8'), sandbox, { filename: bundlePath });
  const plugin = cache.get('dsh-tonghuashun');
  assert.equal(typeof plugin.apply, 'function');
  const before = theme.getTheme();
  const fork = ctx.plugin(plugin);
  await new Promise(resolve => setTimeout(resolve, 30));
  for (const name of slotNames) assert.equal(slots.entries(name).length, 1, name);
  assert.notDeepEqual(theme.getTheme(), before);
  assert.equal(styles.filter(style => style.dataset.ths === 'skin').length, 1);
  const header = slots.entries('conversation.session.header.utilities')[0];
  const disposeSidebar = header.inject().mountSidebar({ onClose() {}, onShowTools() {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(openDetails, 1);
  assert.equal(slots.entriesOfSlot('details')[0].options.priority, -100);
  disposeSidebar();
  assert.equal(slots.entriesOfSlot('details')[0].component, originalDetails);
  await fork.dispose();
  for (const name of slotNames) assert.equal(slots.entries(name).length, 0, `dispose ${name}`);
  assert.equal(styles.filter(style => style.dataset.ths === 'skin').length, 0);
  assert.equal(theme.overrides.size, 0);
  await ctx.fiber.dispose();
}

// 部署到 Profile 的那一份会被 web 客户端直接加载：它必须和本机构建一样能挂载、注册插槽并干净卸载。
test('built client mounts and disposes against installed Cordis, ThemeRuntime and SlotRegistry', { skip: !available }, async t => {
  for (const bundle of clientBundles()) {
    const label = bundle.startsWith(path.resolve('dist')) ? 'local build' : 'deployed profile copy';
    await t.test(label, async () => { await mountClient(bundle); });
  }
});

test('built host attaches real Cordis hooks and releases its route after durable capture', { skip: !available }, async () => {
  const installedRequire = createRequire(path.join(installed, 'package.json'));
  const { Context } = installedRequire('@deepseek-ai/cordis');
  const plugin = await import(pathToFileURL(path.resolve('dist/index.js')).href);
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-installed-host-'));
  const root = path.join(directory, 'project');
  await mkdir(root);
  await writeFile(path.join(root, 'code.js'), 'one\n');
  const routes = new Map();
  const ctx = new Context();
  ctx.provide('sessions', {});
  ctx.provide('tools', {});
  const header = { id: 'real-cordis-session', cwd: root };
  let historyReads = 0;
  ctx.provide('sessionQuery', {
    listSessions: async () => [{ header }],
    readSession: async () => {
      historyReads++;
      return { session: header, inheritedEventCount: 0, events: [
        { type: 'assistant/message', seq: 0, time: Date.now(), data: { turn: 0, step: 1, usage: { inputTokens: 7, outputTokens: 4 } } },
      ] };
    },
  });
  ctx.provide('webServer', { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } });
  const fork = ctx.plugin(plugin, { dataDir: path.join(directory, 'data') });
  for (let attempt = 0; attempt < 30 && !routes.size; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(routes.size, 1);
  const session = { id: 'real-cordis-session', header: { id: 'real-cordis-session', cwd: root } };
  const exec = { name: 'write', callId: 'write-1', arguments: { file_path: 'code.js' }, agent: { session } };
  const actual = await ctx.waterfall('tools/execute', exec, async () => {
    await writeFile(path.join(root, 'code.js'), 'one\ntwo\n');
    return { isError: false, value: { path: 'code.js', operation: 'update', before: 'one\n', after: 'one\ntwo\n' } };
  });
  assert.equal(actual.isError, false);
  await ctx.parallel('session/event', session, { type: 'assistant/message', seq: 1, time: Date.now(), data: { turn: 1, step: 1, usage: { inputTokens: 3, outputTokens: 2 } } });
  const request = { method: 'GET', url: `/tonghuashun/ledger?root=${encodeURIComponent(root)}`, headers: { host: '127.0.0.1:4317' }, socket: { remoteAddress: '127.0.0.1' } };
  let responseStatus, responseBody;
  const response = { writeHead(status) { responseStatus = status; }, end(body) { responseBody = JSON.parse(body); } };
  for (let attempt = 0; attempt < 2; attempt++) {
    await routes.get('/tonghuashun/ledger').handler(request, response);
    assert.equal(responseStatus, 200);
    assert.equal(responseBody.project.usageRecords.length, 2);
  }
  assert.equal(historyReads, 1);
  await fork.dispose();
  assert.equal(routes.size, 0);
  const ledger = JSON.parse(await readFile(path.join(directory, 'data/ledger.json'), 'utf8'));
  const [entry] = Object.values(ledger.projects);
  assert.equal(entry.project.currentLines, 2);
  assert.equal(entry.project.records.length, 1);
  assert.equal(entry.project.usageRecords.length, 2);
  let called = false;
  await ctx.waterfall('tools/execute', exec, async () => { called = true; return { isError: true }; });
  assert.equal(called, true);
  await ctx.fiber.dispose();
});
