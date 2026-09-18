import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMetricsService } from '../src/host/service.js';
import { includedByGit, scanProject } from '../src/host/scan.js';
import { deriveBars } from '../src/core/metrics.js';

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-metrics-'));
  const root = path.join(dir, 'project');
  await mkdir(root);
  await writeFile(path.join(root, 'main.js'), 'first\n');
  return { root, file: path.join(dir, 'ledger.json') };
}
const execFor = (root, callId, name = 'write') => ({ name, callId,
  arguments: { file_path: 'main.js' }, agent: { session: { id: 's1', header: { id: 's1', cwd: root } } } });
async function writeResult(root, before, after) {
  await writeFile(path.join(root, 'main.js'), after);
  return { isError: false, value: { path: 'main.js', before, after, operation: before === null ? 'create' : 'update' } };
}

test('capture includes untracked source inside a project nested in a parent git repository', async () => {
  const { root, file } = await fixture();
  await promisify(execFile)('git', ['init', path.dirname(root)], { windowsHide: true });
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/ledger.js'), 'entry\n');
  assert.equal(await includedByGit(root, 'main.js'), true);
  assert.equal(await includedByGit(root, 'src/ledger.js'), true);
  const service = await createMetricsService({ file });
  await service.capture(execFor(root, 'nested'), () => writeResult(root, 'first\n', 'first\nsecond\n'));
  assert.equal(service.getProject(root).records.length, 1);
  assert.equal(service.getProject(root).currentLines, 3);
});

test('scanner counts source only and excludes generated or binary files', async () => {
  const { root } = await fixture();
  for (const directory of ['node_modules', 'dist', 'generated', 'work', 'AppData', '.dsh', '.codex', '.agents', '.cache']) {
    await mkdir(path.join(root, directory));
    await writeFile(path.join(root, directory, 'hidden.js'), 'a\nb\n');
  }
  await writeFile(path.join(root, 'image.js'), Buffer.from([0, 1, 2]));
  await writeFile(path.join(root, 'notes.dat'), 'a\nb\n');
  const snapshot = await scanProject(root);
  assert.equal(snapshot.total, 1);
  assert.equal(Object.keys(snapshot.files).length, 1);
  // git 不可用时的整项目扫描退回文件系统口径并明确标记。
  assert.equal(snapshot.mode, 'filesystem');
  assert.ok(snapshot.warnings.includes('gitignore-rules-not-applied'));
  // 局部扫描必须失败即止，否则被忽略文件的行数会被并进总量。
  await assert.rejects(scanProject(root, { paths: ['main.js'], mode: 'git' }));
});

test('text-file edits produce a candle and do not scan unrelated files on every write', async () => {
  const { root, file } = await fixture();
  await writeFile(path.join(root, 'notes.txt'), 'first\nsecond\n');
  const service = await createMetricsService({ file });
  await service.ensureProject(root);
  const exec = execFor(root, 'text-edit', 'edit');
  await writeFile(path.join(root, 'main.js'), 'first\nexternal\n');
  exec.arguments.file_path = 'notes.txt';
  await service.capture(exec, async () => {
    await writeFile(path.join(root, 'notes.txt'), 'first\n');
    return { value: { path: 'notes.txt', before: 'first\nsecond\n', after: 'first\n' } };
  });
  const project = service.getProject(root);
  assert.equal(project.records.length, 1);
  assert.equal(project.records[0].deleted, 1);
  assert.equal(project.currentLines, 2);
  await service.ensureProject(root);
  assert.equal(service.getProject(root).currentLines, 3);
  await service.close();
});

test('string editor verified contents produce candles without trusting success text', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  const exec = execFor(root, 'string-edit', 'str_replace_editor');
  exec.arguments = { command: 'str_replace', path: path.join(root, 'main.js'), old_str: 'first', new_str: 'first\nsecond' };
  await service.capture(exec, async () => {
    await writeFile(path.join(root, 'main.js'), 'first\nsecond\n');
    return { isError: false, value: 'The file has been edited successfully.' };
  });
  assert.equal(service.getProject(root).records.length, 1);
  assert.equal(service.getProject(root).records[0].added, 1);
  exec.callId = 'false-success';
  exec.arguments.new_str = 'third';
  await service.capture(exec, async () => ({ isError: false, value: 'Success' }));
  assert.equal(service.getProject(root).records.length, 1);
  await service.close();
});

test('capture records actual edits once and persists across restart', async () => {
  const { root, file } = await fixture();
  let service = await createMetricsService({ file });
  await service.capture(execFor(root, 'c1'), () => writeResult(root, 'first\n', 'first\nsecond\n'));
  await service.flush();
  const project = service.getProject(root);
  assert.equal(project.records.length, 1);
  assert.equal(project.currentLines, 2);
  await service.close();
  service = await createMetricsService({ file });
  await service.capture(execFor(root, 'c1'), async () => ({ isError: false, value: { path: 'main.js', before: 'first\n', after: 'first\nsecond\n' } }));
  assert.equal(service.getProject(root).records.length, 1);
});

test('no-op, failed tools and shell output do not fabricate agent records', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.capture(execFor(root, 'same'), () => writeResult(root, 'first\n', 'first\n'));
  await assert.rejects(service.capture(execFor(root, 'bad'), async () => { throw new Error('tool failed'); }), /tool failed/);
  await service.capture(execFor(root, 'shell', 'pwsh'), async () => ({ isError: false, value: { exitCode: 0 } }));
  assert.equal(service.getProject(root).records.length, 0);
  assert.ok(service.getProject(root).warnings.some(value => value.includes('shell')));
});

test('external changes reconcile separately before actual agent changes', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.ensureProject(root);
  await writeFile(path.join(root, 'main.js'), 'external\nsecond\n');
  await service.capture(execFor(root, 'c1'), () => writeResult(root, 'external\nsecond\n', 'external\nsecond\nthird\n'));
  const project = service.getProject(root);
  assert.equal(project.currentLines, 3);
  assert.equal(project.records.filter(record => record.kind !== 'external').length, 1);
  assert.ok(project.reconciliations.length > 0);
});

test('corrupt ledger refuses to reset or overwrite existing bytes', async () => {
  const { file } = await fixture();
  await writeFile(file, '{broken');
  await assert.rejects(createMetricsService({ file }), /ledger/i);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});

test('history excludes inherited usage, replaces samples, accounts for retry and survives vanished sessions', async () => {
  const { root, file } = await fixture();
  const usage = outputTokens => ({ inputTokens: 10, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const events = [
    { type: 'assistant/message', seq: 0, time: 1, data: { turn: 0, step: 0, usage: usage(100) } },
    { type: 'assistant/chunk', seq: 1, time: 2, data: { turn: 1, step: 0, chunk: { type: 'usage', usage: usage(2) } } },
    { type: 'assistant/message', seq: 2, time: 3, data: { turn: 1, step: 0, usage: usage(3) } },
    { type: 'llm/retry-started', seq: 3, time: 4, data: { turn: 1, step: 0 } },
    { type: 'assistant/message', seq: 4, time: 5, data: { turn: 1, step: 0, usage: usage(4) } },
  ];
  const query = { listSessions: async () => [{ header: { id: 's1', cwd: root } }],
    readSession: async () => ({ session: { id: 's1', cwd: root }, events, inheritedEventCount: 1 }) };
  let service = await createMetricsService({ file, query });
  await service.ensureProject(root);
  await service.backfill(root);
  await service.backfill(root);
  assert.equal(service.getProject(root).usageRecords.length, 2);
  await service.flush();
  await service.close();
  service = await createMetricsService({ file, query: { listSessions: async () => [] } });
  await service.backfill();
  assert.equal(service.getProject(root).usageRecords.length, 2);
});

test('live usage arriving before older history retains final attempt values', async () => {
  const { root, file } = await fixture();
  const header = { id: 's1', cwd: root };
  const early = { type: 'assistant/message', seq: 1, time: 1, data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 2 } } };
  const retry = { type: 'llm/retry-started', seq: 2, time: 2, data: { turn: 1, step: 0 } };
  const final = { type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, step: 0, usage: { inputTokens: 12, outputTokens: 5 } } };
  const service = await createMetricsService({ file, query: {
    listSessions: async () => [{ header }],
    readSession: async () => ({ session: header, inheritedEventCount: 0, events: [early, retry, final] }),
  } });
  await service.ingest({ id: 's1', header }, final);
  await service.backfill(root);
  const project = service.getProject(root);
  assert.equal(project.usageRecords.length, 2);
  assert.equal(project.usage.known.outputTokens, 7);
});

test('backfill reads only the explicitly selected project', async () => {
  const { root, file } = await fixture();
  const { root: unrelated } = await fixture();
  const read = [];
  const service = await createMetricsService({ file, query: {
    listSessions: async () => [{ header: { id: 's1', cwd: root } }, { header: { id: 's2', cwd: unrelated } }],
    readSession: async id => { read.push(id); return { session: { id, cwd: root }, inheritedEventCount: 0, events: [] }; },
  } });
  await service.backfill(root);
  assert.deepEqual(read, ['s1']);
});

test('independent tool executions overlap while ledger updates remain consistent', async () => {
  const { root, file } = await fixture();
  await writeFile(path.join(root, 'other.js'), 'old\n');
  const service = await createMetricsService({ file });
  let started = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const tool = async (name, before, after) => {
    started++;
    if (started === 2) release();
    await barrier;
    await writeFile(path.join(root, name), after);
    return { isError: false, value: { path: name, before, after, operation: 'update' } };
  };
  await Promise.all([
    service.capture(execFor(root, 'a'), () => tool('main.js', 'first\n', 'first\nsecond\n')),
    service.capture(execFor(root, 'b'), () => tool('other.js', 'old\n', 'old\nnew\n')),
  ]);
  assert.equal(service.getProject(root).currentLines, 4);
  assert.equal(service.getProject(root).records.length, 2);
});

test('scanner and capture honor gitignore and never traverse directory links', async () => {
  const { root, file } = await fixture();
  const { root: outside } = await fixture();
  await promisify(execFile)('git', ['init', root], { windowsHide: true });
  await writeFile(path.join(root, '.gitignore'), 'private.js\n');
  await writeFile(path.join(root, 'private.js'), 'secret\n');
  await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await scanProject(root)).total, 1);
  const service = await createMetricsService({ file });
  await service.capture(execFor(root, 'ignored'), async () => {
    await writeFile(path.join(root, 'private.js'), 'secret\nother\n');
    return { isError: false, value: { path: 'private.js', before: 'secret\n', after: 'secret\nother\n', operation: 'update' } };
  });
  assert.equal(service.getProject(root).records.length, 0);
  assert.equal(service.getProject(root).currentLines, 1);
});

test('a second call starting after a first write does not mislabel the first write as external', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  let written;
  const beforeReturn = new Promise(resolve => { written = resolve; });
  let finish;
  const canReturn = new Promise(resolve => { finish = resolve; });
  const first = service.capture(execFor(root, 'one'), async () => {
    const result = await writeResult(root, 'first\n', 'first\nsecond\n');
    written();
    await canReturn;
    return result;
  });
  await beforeReturn;
  await service.capture(execFor(root, 'two'), async () => ({ isError: false, value: { path: 'main.js', before: 'first\nsecond\n', after: 'first\nsecond\n' } }));
  finish();
  await first;
  assert.equal(service.getProject(root).reconciliations.length, 0);
  assert.equal(service.getProject(root).currentLines, 2);
});

test('restoring previous content creates a new restore record and persists its identity', async () => {
  const { root, file } = await fixture();
  let service = await createMetricsService({ file });
  await service.capture(execFor(root, 'change'), () => writeResult(root, 'first\n', 'first\nsecond\n'));
  await service.close();
  service = await createMetricsService({ file });
  await service.capture(execFor(root, 'restore'), () => writeResult(root, 'first\nsecond\n', 'first\n'));
  const project = service.getProject(root);
  assert.equal(project.records.length, 2);
  assert.equal(project.records[1].kind, 'restore');
  assert.equal(project.currentLines, 1);
});

test('clearing keeps an actual baseline and prevents historical usage resurrection after restart', async () => {
  const { root, file } = await fixture();
  const header = { id: 's1', cwd: root };
  const events = [{ type: 'assistant/message', seq: 1, time: 1, data: { turn: 1, step: 0, usage: { inputTokens: 10, outputTokens: 2 } } }];
  const query = { listSessions: async () => [{ header }], readSession: async () => ({ session: header, inheritedEventCount: 0, events }) };
  let service = await createMetricsService({ file, query });
  await service.backfill(root);
  await service.capture(execFor(root, 'change'), () => writeResult(root, 'first\n', 'first\nsecond\n'));
  await service.clearProject(root);
  assert.equal(service.getProject(root).currentLines, 2);
  assert.equal(service.getProject(root).records.length, 0);
  assert.equal(service.getProject(root).usageRecords.length, 0);
  await service.close();
  service = await createMetricsService({ file, query });
  await service.backfill(root);
  assert.equal(service.getProject(root).usageRecords.length, 0);
  await service.ingest({ id: 's1', header }, { type: 'assistant/message', seq: 2, time: Date.now(), data: { turn: 2, step: 0, usage: { inputTokens: 3, outputTokens: 1 } } });
  assert.equal(service.getProject(root).usageRecords.length, 1);
});

test('Windows file names with different case refer to one tracked source', { skip: process.platform !== 'win32' }, async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.capture(execFor(root, 'mixed-case'), async () => {
    await writeFile(path.join(root, 'MAIN.JS'), 'first\nsecond\n');
    return { isError: false, value: { path: 'MAIN.JS', before: 'first\n', after: 'first\nsecond\n', operation: 'update' } };
  });
  const project = service.getProject(root);
  assert.equal(project.currentLines, 2);
  assert.equal(project.records.length, 1);
  assert.equal(project.reconciliations.length, 0);
});

test('rescan after creating an alphabetically earlier file does not invent external changes', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.capture(execFor(root, 'new-file'), async () => {
    await writeFile(path.join(root, 'a.js'), 'new\n');
    return { isError: false, value: { path: 'a.js', before: null, after: 'new\n', operation: 'create' } };
  });
  await service.ensureProject(root);
  assert.equal(service.getProject(root).reconciliations.length, 0);
});

test('a live ledger owner rejects a second writer and close permits restart', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.ensureProject(root);
  await assert.rejects(createMetricsService({ file }), /lock|writer|owner/i);
  await service.close();
  const reopened = await createMetricsService({ file });
  assert.equal(reopened.getProject(root).currentLines, 1);
  await reopened.close();
  await assert.rejects(reopened.ensureProject(root), /closed/i);
});

test('valid JSON with malformed records files or usage is rejected without overwrite', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.ensureProject(root);
  await service.close();
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const damage of [entry => { entry.project.records = [{}]; }, entry => { entry.files = []; }, entry => { entry.project.usage.totalTokens = -1; }]) {
    const broken = structuredClone(valid);
    damage(Object.values(broken.projects)[0]);
    const bytes = JSON.stringify(broken);
    await writeFile(file, bytes);
    await assert.rejects(createMetricsService({ file }), /ledger/i);
    assert.equal(await readFile(file, 'utf8'), bytes);
  }
});

test('same-file writes returning in reverse order retain the actual chain and final total', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  let wrote;
  const written = new Promise(resolve => { wrote = resolve; });
  let finish;
  const barrier = new Promise(resolve => { finish = resolve; });
  const first = service.capture(execFor(root, 'first'), async () => {
    const result = await writeResult(root, 'first\n', 'first\nsecond\n');
    wrote();
    await barrier;
    return result;
  });
  await written;
  await service.capture(execFor(root, 'second'), () => writeResult(root, 'first\nsecond\n', 'first\nsecond\nthird\n'));
  finish();
  await first;
  const project = service.getProject(root);
  assert.equal(project.currentLines, 3);
  assert.deepEqual(project.records.map(record => record.id), ['s1:first', 's1:second']);
  assert.equal(project.reconciliations.length, 0);
  await service.close();
});

test('a claimed result that does not match disk cannot fabricate an agent candle', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  await service.capture(execFor(root, 'invented'), async () => ({ value: { path: 'main.js', before: 'first\n', after: 'fake\nsecond\n' } }));
  assert.equal(service.getProject(root).records.length, 0);
  assert.equal(service.getProject(root).currentLines, 1);
  await service.close();
});

test('ledger lock excludes another process and recovers after its owner exits', async () => {
  const { root, file } = await fixture();
  const moduleUrl = new URL('../src/host/service.js', import.meta.url).href;
  const script = `import { createMetricsService } from ${JSON.stringify(moduleUrl)}; const service = await createMetricsService({ file: process.argv[1] }); await service.ensureProject(process.argv[2]);`;
  const service = await createMetricsService({ file });
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, file, root], { windowsHide: true }), /active writer/i);
  await service.close();
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, file, root], { windowsHide: true });
  const recovered = await createMetricsService({ file });
  assert.equal(recovered.getProject(root).currentLines, 1);
  await recovered.close();
});

test('unknown lock ownership is preserved rather than forcefully recovered', async () => {
  const { file } = await fixture();
  const bytes = '{unknown-owner';
  await writeFile(`${file}.lock`, bytes);
  await assert.rejects(createMetricsService({ file }));
  assert.equal(await readFile(`${file}.lock`, 'utf8'), bytes);
});

test('closing during a tool start cannot release ownership while that tool runs', async () => {
  const { root, file } = await fixture();
  const service = await createMetricsService({ file });
  let finish;
  const barrier = new Promise(resolve => { finish = resolve; });
  const capture = service.capture(execFor(root, 'pending'), async () => {
    await barrier;
    return writeResult(root, 'first\n', 'first\nsecond\n');
  });
  const closing = service.close();
  await assert.rejects(closing, /executing/i);
  await assert.rejects(createMetricsService({ file }), /writer/i);
  finish();
  await capture;
  assert.equal(service.getProject(root).records.length, 1);
  await service.close();
});

test('clear keeps current scan warnings for excluded binary sources', async () => {
  const { root, file } = await fixture();
  await writeFile(path.join(root, 'broken.js'), Buffer.from([0, 1, 2]));
  const service = await createMetricsService({ file });
  await service.ensureProject(root);
  const cleared = await service.clearProject(root);
  assert.ok(cleared.warnings.includes('binary:broken.js'));
  assert.equal(cleared.status, 'partial');
  await service.close();
});

test('a file hidden by .gitignore drops out of the total as an external reconciliation', async () => {
  const { root, file } = await fixture();
  await promisify(execFile)('git', ['init', root], { windowsHide: true });
  await writeFile(path.join(root, 'extra.js'), 'a\nb\nc\n');
  await writeFile(path.join(root, '.gitignore'), '');
  const service = await createMetricsService({ file });
  const before = await service.ensureProject(root);
  assert.equal(before.scanMode, 'git');
  assert.equal(before.currentLines, 4);
  await writeFile(path.join(root, '.gitignore'), 'extra.js\n');
  const after = await service.ensureProject(root);
  assert.equal(after.currentLines, 1);
  assert.equal(after.reconciliations.length, 1);
  assert.equal(after.reconciliations[0].beforeTotal, 4);
  assert.equal(after.reconciliations[0].afterTotal, 1);
  // 被忽略的行数变化必须是图上可见的未归属柱，而不是凭空消失。
  const bars = deriveBars(after, { now: Date.now() });
  const external = bars.filter(bar => bar.source === 'external');
  assert.equal(external.length, 1);
  assert.equal(external[0].volume, 3);
  assert.equal(bars.at(-1).close, after.currentLines);
  await service.close();
});

test('writing to a git-ignored file is reported instead of silently dropped', async () => {
  const { root, file } = await fixture();
  await promisify(execFile)('git', ['init', root], { windowsHide: true });
  await writeFile(path.join(root, 'extra.js'), 'a\nb\n');
  await writeFile(path.join(root, '.gitignore'), 'extra.js\n');
  const service = await createMetricsService({ file });
  await service.ensureProject(root);
  const exec = execFor(root, 'ignored');
  exec.arguments.file_path = 'extra.js';
  await service.capture(exec, async () => {
    await writeFile(path.join(root, 'extra.js'), 'a\nb\nc\n');
    return { isError: false, value: { path: 'extra.js', before: 'a\nb\n', after: 'a\nb\nc\n', operation: 'update' } };
  });
  const project = service.getProject(root);
  assert.equal(project.records.length, 0);
  assert.deepEqual(project.warnings, ['git-ignored-source-excluded:extra.js']);
  assert.equal(project.status, 'partial');
  // 已跟踪文件即使写进 .gitignore 也仍然被统计。
  await promisify(execFile)('git', ['-C', root, 'add', 'main.js'], { windowsHide: true });
  await writeFile(path.join(root, '.gitignore'), 'extra.js\nmain.js\n');
  await service.ensureProject(root);
  const tracked = execFor(root, 'tracked');
  await service.capture(tracked, () => writeResult(root, 'first\n', 'first\nsecond\n'));
  assert.equal(service.getProject(root).records.length, 1);
  await service.close();
});

test('switching between git and filesystem scanning is recorded as its own reconciliation reason', async () => {
  const { root, file } = await fixture();
  await writeFile(path.join(root, 'extra.js'), 'a\nb\nc\n');
  const service = await createMetricsService({ file });
  const walked = await service.ensureProject(root);
  assert.equal(walked.scanMode, 'filesystem');
  assert.equal(walked.currentLines, 4);
  await promisify(execFile)('git', ['init', root], { windowsHide: true });
  await writeFile(path.join(root, '.gitignore'), 'extra.js\n');
  const scanned = await service.ensureProject(root);
  assert.equal(scanned.scanMode, 'git');
  assert.equal(scanned.currentLines, 1);
  assert.equal(scanned.reconciliations.at(-1).reason, 'filesystem-reconciliation:scan-mode-filesystem-to-git');
  await service.close();
});
