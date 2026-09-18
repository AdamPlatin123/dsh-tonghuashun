import { mkdir, readFile, open, rename, unlink, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import path from 'node:path';
import { changeCounts, countLines, createProject, projectKey, recordChange, recordUsage, normalizeUsage, TOKEN_FIELDS } from '../core/metrics.js';
import { fingerprint, safeRelative, scanProject, sourcePath } from './scan.js';
import { editorEvidence } from './editor-evidence.js';

function assertLedger(value) {
  const object = item => item && typeof item === 'object' && !Array.isArray(item);
  const natural = item => Number.isSafeInteger(item) && item >= 0;
  const date = item => (typeof item === 'string' || typeof item === 'number') && Number.isFinite(new Date(item).getTime());
  const text = item => typeof item === 'string' && item.length > 0;
  const hash = item => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item);
  const relative = item => text(item) && !path.isAbsolute(item) && !item.split(/[\\/]/).includes('..');
  const require = condition => { if (!condition) throw new Error('Invalid metrics ledger schema'); };
  require(value?.version === 1 && object(value.projects));
  for (const [key, entry] of Object.entries(value.projects)) {
    const project = entry?.project;
    require(object(entry) && object(project) && project.id === key && projectKey(project.root) === key && natural(project.baseline) && natural(project.currentLines) && date(project.createdAt));
    require(Array.isArray(project.records) && Array.isArray(project.usageRecords) && object(entry.files));
    require(Array.isArray(entry.warnings) && entry.warnings.every(text) && Array.isArray(entry.reconciliations));
    require(['git', 'filesystem'].includes(entry.scanMode));
    for (const field of ['seenCalls', 'seenEvents', 'attempts']) require(object(entry[field]));
    for (const field of ['seenCalls', 'seenEvents']) require(Object.values(entry[field]).every(item => item === true));
    require(Object.values(entry.attempts).every(natural));
    let total = 0;
    for (const [name, file] of Object.entries(entry.files)) {
      require(relative(name) && object(file) && natural(file.lines) && hash(file.hash));
      total += file.lines;
    }
    require(natural(total) && total === project.currentLines);
    const recordIds = new Set();
    for (const record of project.records) {
      require(object(record) && text(record.id) && !recordIds.has(record.id) && date(record.at) && text(record.sessionId) && text(record.tool) && relative(record.path));
      recordIds.add(record.id);
      for (const field of ['open', 'close', 'high', 'low', 'added', 'deleted', 'volume']) require(natural(record[field]));
      require(record.close === record.open + (record.added - record.deleted) && record.high === Math.max(record.open, record.close) && record.low === Math.min(record.open, record.close) && record.volume === record.added + record.deleted);
      if (record.afterTotal !== undefined) require(record.afterTotal === record.close);
    }
    let replay = createProject(project.root, 0, project.createdAt);
    const usageIds = new Set();
    for (const sample of project.usageRecords) {
      require(object(sample) && text(sample.id) && !usageIds.has(sample.id) && date(sample.at) && object(sample.usage));
      usageIds.add(sample.id);
      require(TOKEN_FIELDS.every(field => Object.hasOwn(sample.usage, field)));
      replay = recordUsage(replay, sample);
    }
    require(object(project.usage) && object(project.usage.known) && object(project.usage.unknown) && project.usage.sampleCount === replay.usage.sampleCount);
    for (const field of TOKEN_FIELDS) require(project.usage[field] === replay.usage[field] && project.usage.known[field] === replay.usage.known[field] && project.usage.unknown[field] === replay.usage.unknown[field]);
    for (const item of entry.reconciliations) require(object(item) && text(item.id) && date(item.at) && text(item.reason) && item.kind === 'external' && natural(item.beforeTotal) && natural(item.afterTotal));
    if (entry.versions !== undefined) {
      require(object(entry.versions));
      for (const [name, versions] of Object.entries(entry.versions)) require(relative(name) && Array.isArray(versions) && versions.every(hash));
    }
    if (entry.tokenEvents !== undefined) {
      require(object(entry.tokenEvents));
      for (const sample of Object.values(entry.tokenEvents)) {
        require(object(sample) && text(sample.sessionId) && natural(sample.seq) && date(sample.at) && typeof sample.isRetry === 'boolean');
        if (!sample.isRetry) { require(object(sample.usage)); normalizeUsage(sample.usage); }
      }
    }
    if (entry.clearedAt !== undefined) require(date(entry.clearedAt));
    if (entry.clearWatermarks !== undefined) { require(object(entry.clearWatermarks)); require(Object.values(entry.clearWatermarks).every(item => Number.isSafeInteger(item) && item >= -1)); }
  }
}

async function acquireLock(file) {
  const lock = `${file}.lock`;
  const owner = { pid: process.pid, owner: randomUUID(), host: hostname() };
  const readOwner = async () => {
    const value = JSON.parse(await readFile(lock, 'utf8'));
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || typeof value.owner !== 'string' || !value.owner || value.host !== hostname()) throw new Error('Ledger lock owner cannot be verified');
    return value;
  };
  const create = async () => {
    const handle = await open(lock, 'wx');
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
    finally { await handle.close(); }
  };
  try { await create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // 只回收同一主机上已确认退出的进程；恢复锁阻止两个新进程同时接管。
    const stale = await readOwner();
    try { process.kill(stale.pid, 0); throw new Error(`Ledger already has an active writer (PID ${stale.pid})`); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    let guard;
    try { guard = await open(`${lock}.recovery`, 'wx'); }
    catch { throw new Error('Ledger lock recovery is already in progress'); }
    try {
      if ((await readOwner()).owner !== stale.owner) throw new Error('Ledger lock owner changed during recovery');
      await unlink(lock);
      await create();
    } finally { await guard.close(); await unlink(`${lock}.recovery`); }
  }
  return async () => {
    if ((await readOwner()).owner !== owner.owner) throw new Error('Ledger lock owner changed before release');
    await unlink(lock);
  };
}

async function writeAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, file);
}

function sessionIdentity(session) {
  return { root: session?.header?.cwd, id: session?.id ?? session?.header?.id };
}

const MAX_IGNORED_WARNINGS = 8;
/** 警告按 token 去重；被忽略文件的告警单独限额，避免一条规则改动淹没整个状态列表。 */
function warn(entry, token) {
  if (entry.warnings.includes(token)) return;
  if (token.startsWith('git-ignored-source-excluded') && entry.warnings.filter(item => item.startsWith('git-ignored-source-excluded')).length >= MAX_IGNORED_WARNINGS) return;
  entry.warnings = [...new Set([...entry.warnings, token])];
}

function reconcile(entry, snapshot, reason, at = Date.now()) {
  const previous = entry.project.currentLines;
  const changed = previous !== snapshot.total || Object.keys(entry.files).length !== Object.keys(snapshot.files).length
    || Object.entries(snapshot.files).some(([name, item]) => entry.files[name]?.hash !== item.hash || entry.files[name]?.lines !== item.lines);
  if (changed) {
    // git 与文件系统两种口径的纳入范围不同，切换本身就会让总量跳变，必须在原因里标明。
    const modeChanged = snapshot.mode && snapshot.mode !== entry.scanMode;
    entry.reconciliations.push({ id: randomUUID(), at: new Date(at).toISOString(), kind: 'external',
      reason: modeChanged ? `${reason}:scan-mode-${entry.scanMode}-to-${snapshot.mode}` : reason,
      beforeTotal: previous, afterTotal: snapshot.total });
    entry.project = { ...entry.project, currentLines: snapshot.total };
  }
  entry.files = snapshot.files;
  entry.warnings = [...new Set([...entry.warnings, ...snapshot.warnings])];
  entry.scanMode = snapshot.mode ?? entry.scanMode;
}

export async function createMetricsService({ file, query, onError = () => {} }) {
  if (!file || !path.isAbsolute(file)) throw new Error('Metrics ledger file must be an absolute path');
  await mkdir(path.dirname(file), { recursive: true });
  file = path.join(await realpath(path.dirname(file)), path.basename(file));
  const releaseLock = await acquireLock(file);
  let state = { version: 1, projects: {} };
  try { state = JSON.parse(await readFile(file, 'utf8')); assertLedger(state); }
  catch (error) { if (error.code !== 'ENOENT') { await releaseLock(); throw new Error(`Cannot load metrics ledger: ${error.message}`, { cause: error }); } }
  let queue = Promise.resolve();
  const active = new Map();
  const pending = new Map();
  let closed = false;
  let lastError = null;
  const report = error => { lastError = error.message; try { onError(error); } catch {} };
  const enqueue = operation => {
    if (closed) return Promise.reject(new Error('Metrics service is closed'));
    const result = queue.then(async () => {
      if (closed) throw new Error('Metrics service is closed');
      const previous = structuredClone(state);
      try { const value = await operation(); await writeAtomic(file, state); return value; }
      catch (error) { state = previous; throw error; }
    });
    queue = result.catch(() => {});
    return result;
  };
  const view = entry => entry ? structuredClone({ ...entry.project, warnings: entry.warnings, reconciliations: entry.reconciliations, scanMode: entry.scanMode, status: lastError ? 'error' : entry.warnings.length ? 'partial' : 'ready', error: lastError }) : null;
  async function ensureInner(root, refresh) {
    const key = projectKey(root);
    let entry = state.projects[key];
    if (entry && !refresh) return entry;
    const snapshot = await scanProject(root);
    if (!entry) {
      entry = { project: createProject(root, snapshot.total, Date.now()), files: snapshot.files, warnings: snapshot.warnings, reconciliations: [], seenCalls: {}, seenEvents: {}, attempts: {}, tokenEvents: {}, versions: Object.fromEntries(Object.entries(snapshot.files).map(([name, item]) => [name, [item.hash]])), scanMode: snapshot.mode };
      state.projects[key] = entry;
    } else reconcile(entry, snapshot, 'filesystem-reconciliation');
    return entry;
  }
  const ensureProject = root => enqueue(async () => view(await ensureInner(root, !active.get(projectKey(root)))));
  async function scanAffected(root, entry, samples) {
    if (samples.some(({ exec }) => !['write', 'edit', 'str_replace_editor'].includes(exec.name))) return scanProject(root);
    const paths = new Set();
    for (const { exec, result } of samples) {
      for (const candidate of [exec.arguments?.file_path, exec.arguments?.path, result?.value?.path]) {
        if (typeof candidate !== 'string') continue;
        const relative = await safeRelative(root, candidate);
        if (relative && sourcePath(relative)) paths.add(relative);
      }
    }
    const partial = await scanProject(root, { paths: [...paths], mode: entry.scanMode });
    const files = { ...entry.files };
    for (const relative of paths) delete files[relative];
    Object.assign(files, partial.files);
    return { ...partial, files, total: Object.values(files).reduce((sum, item) => sum + item.lines, 0) };
  }
  async function applyPending(root, entry, samples) {
    const snapshot = await scanAffected(root, entry, samples);
    const byPath = new Map();
    for (const { exec, result, sessionId } of samples) {
      const id = `${sessionId}:${exec.callId}`;
      if (!exec.callId || entry.seenCalls[id]) continue;
      if (!['write', 'edit', 'str_replace_editor'].includes(exec.name)) {
        warn(entry, 'shell-attribution-unsupported');
        continue;
      }
      const value = result?.value;
      if (result?.isError || !value || typeof value.after !== 'string' || !(typeof value.before === 'string' || value.before === null && value.operation === 'create')) continue;
      if (value.after.includes('\0') || value.before?.includes('\0')) {
        warn(entry, 'binary-tool-result-excluded');
        continue;
      }
      const relative = await safeRelative(root, value.path ?? exec.arguments?.file_path ?? '');
      if (!relative || !sourcePath(relative)) continue;
      if (!snapshot.files[relative]) {
        // 被 .gitignore 排除（或已删除）的文件改动不会进入统计：被忽略时必须显式告知，不能静默丢弃。
        if (snapshot.ignored?.includes(relative)) warn(entry, `git-ignored-source-excluded:${relative}`);
        continue;
      }
      entry.seenCalls[id] = true;
      if (value.before === value.after) continue;
      const changes = byPath.get(relative) ?? [];
      changes.push({ id, sessionId, tool: exec.name, value, beforeHash: value.before === null ? undefined : fingerprint(value.before), afterHash: fingerprint(value.after) });
      byPath.set(relative, changes);
    }
    for (const [relative, changes] of byPath) {
      let current = entry.files[relative]?.hash;
      const remaining = [...changes];
      const chain = [];
      // 返回顺序不能代表写入顺序；只有闭合到实际磁盘内容的唯一内容链才归因于 Agent。
      while (remaining.length) {
        const matches = remaining.filter(change => change.beforeHash === current);
        if (matches.length !== 1) break;
        const change = matches[0];
        chain.push(change);
        remaining.splice(remaining.indexOf(change), 1);
        current = change.afterHash;
      }
      if (remaining.length || current !== snapshot.files[relative]?.hash) {
        warn(entry, 'unverified-or-concurrent-file-change');
        continue;
      }
      for (const change of chain) {
        const before = change.value.before ?? '';
        const after = change.value.after;
        const counts = changeCounts(before, after);
        entry.versions ??= {};
        const versions = entry.versions[relative] ?? [];
        if (counts.added || counts.deleted) {
          entry.project = recordChange(entry.project, { id: change.id, at: Date.now(), sessionId: change.sessionId, tool: change.tool, path: relative, ...counts,
            kind: versions.includes(change.afterHash) ? 'restore' : 'edit', source: 'host-tool-result', afterTotal: entry.project.currentLines + (countLines(after) - countLines(before)) });
        }
        entry.versions[relative] = [...new Set([...versions, fingerprint(before), change.afterHash])];
        entry.files[relative] = { lines: countLines(after), hash: change.afterHash };
      }
    }
    reconcile(entry, snapshot, 'unattributed-filesystem-reconciliation');
  }
  async function capture(exec, next) {
    if (!['write', 'edit', 'str_replace_editor'].includes(exec.name) && !/bash|pwsh|shell/.test(exec.name)) return next();
    if (exec.name === 'str_replace_editor' && exec.arguments?.command === 'view') return next();
    const { root, id: sessionId } = sessionIdentity(exec.agent?.session);
    if (!root || !sessionId) return next();
    const rootKey = projectKey(root);
    let available = true;
    let counted = false;
    let evidence;
    try {
      await enqueue(async () => {
        const entry = await ensureInner(root, false);
        if (!active.get(rootKey)) reconcile(entry, await scanAffected(root, entry, [{ exec }]), 'target-file-reconciliation');
        if (exec.name === 'str_replace_editor') evidence = await editorEvidence(root, exec.arguments);
        active.set(rootKey, (active.get(rootKey) ?? 0) + 1);
        counted = true;
      });
    } catch (error) {
      available = false;
      if (counted) active.set(rootKey, Math.max(0, (active.get(rootKey) ?? 1) - 1));
      report(error);
    }
    let result;
    let toolError;
    try { result = await next(); }
    catch (error) { toolError = error; }
    if (available) {
      try {
        await enqueue(async () => {
          const samples = pending.get(rootKey) ?? [];
          samples.push({ exec, result: evidence && !result?.isError ? { ...result, value: evidence } : result, sessionId });
          pending.set(rootKey, samples);
          active.set(rootKey, Math.max(0, (active.get(rootKey) ?? 1) - 1));
          if (!active.get(rootKey)) {
            await applyPending(root, state.projects[rootKey], samples);
            pending.delete(rootKey);
          }
        });
      } catch (error) { report(error); }
    }
    if (toolError) throw toolError;
    return result;
  }
  function rebuildUsage(entry, root, sessionId) {
    const retained = entry.project.usageRecords.filter(record => record.sessionId !== sessionId);
    let project = { ...entry.project, usageRecords: [], usage: createProject(root, 0, Date.now()).usage };
    for (const record of retained) project = recordUsage(project, record);
    const attempts = {};
    // 实时事件和历史回填可能交错；按宿主序号重放，避免将旧样本覆盖到新请求。
    for (const sample of Object.values(entry.tokenEvents).filter(item => item.sessionId === sessionId).sort((a, b) => a.seq - b.seq)) {
      const key = `${sessionId}:${sample.turn}:${sample.step}`;
      if (sample.isRetry) attempts[key] = (attempts[key] ?? 0) + 1;
      else {
        const attempt = attempts[key] ?? 0;
        project = recordUsage(project, { id: `${key}:${attempt}`, at: sample.at, sessionId, turn: sample.turn, step: sample.step, attempt, usage: sample.usage });
      }
    }
    entry.project = project;
  }
  async function ingestInner(session, event, rebuild = true) {
    const { root, id: sessionId } = sessionIdentity(session);
    if (!root || !sessionId || !event || !Number.isSafeInteger(event.seq)) return;
    if (event.seq < (session.inheritedEventCount ?? 0)) return;
    const data = event.data ?? {};
    const isRetry = event.type === 'llm/retry-started';
    const usage = event.type === 'assistant/chunk' && data.chunk?.type === 'usage' ? data.chunk.usage : event.type === 'assistant/message' ? data.usage : undefined;
    if (!isRetry && !usage) return;
    const entry = await ensureInner(root, false);
    const watermark = entry.clearWatermarks?.[sessionId];
    if (watermark !== undefined ? event.seq <= watermark : entry.clearedAt !== undefined && (event.time ?? 0) <= entry.clearedAt) return;
    const eventId = `${sessionId}:${event.seq}`;
    if (entry.seenEvents[eventId]) return;
    entry.tokenEvents ??= {};
    entry.tokenEvents[eventId] = { sessionId, seq: event.seq, at: event.time ?? Date.now(), turn: data.turn, step: data.step, isRetry, ...(usage ? { usage } : {}) };
    if (rebuild) rebuildUsage(entry, root, sessionId);
    entry.seenEvents[eventId] = true;
  }
  const ingest = (session, event) => {
    if (event?.type !== 'llm/retry-started' && !(event?.type === 'assistant/message' && event.data?.usage) && !(event?.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage')) return Promise.resolve();
    return enqueue(() => ingestInner(session, event)).catch(report);
  };
  async function backfill(root) {
    if (!query) return;
    const allowed = new Set(root ? [projectKey(root)] : Object.keys(state.projects));
    const sessions = await query.listSessions();
    for (const { header } of sessions) {
      if (!header?.cwd || !header.id) continue;
      if (!allowed.has(projectKey(header.cwd))) continue;
      try {
        const loaded = await query.readSession(header.id);
        await enqueue(async () => {
          const session = { id: loaded.session.id, header: loaded.session };
          for (const event of loaded.events.slice(loaded.inheritedEventCount ?? 0)) await ingestInner(session, event, false);
          const entry = state.projects[projectKey(loaded.session.cwd)];
          if (entry?.tokenEvents) rebuildUsage(entry, loaded.session.cwd, loaded.session.id);
        });
      } catch (error) { report(error); }
    }
  }
  const clearProject = root => enqueue(async () => {
    const key = projectKey(root);
    if (active.get(key)) throw new Error('Cannot clear project metrics while a tool is executing');
    const entry = await ensureInner(root, true);
    const clearWatermarks = { ...entry.clearWatermarks };
    for (const event of Object.values(entry.tokenEvents ?? {})) clearWatermarks[event.sessionId] = Math.max(clearWatermarks[event.sessionId] ?? -1, event.seq);
    if (query) {
      for (const { header } of await query.listSessions()) {
        if (!header?.cwd || projectKey(header.cwd) !== key) continue;
        const loaded = await query.readSession(header.id);
        clearWatermarks[header.id] = loaded.events.reduce((max, event) => Math.max(max, event.seq), clearWatermarks[header.id] ?? -1);
      }
    }
    const now = Date.now();
    const snapshot = await scanProject(root);
    state.projects[key] = { ...entry, project: createProject(root, snapshot.total, now), files: snapshot.files, tokenEvents: {}, seenEvents: {}, attempts: {}, warnings: snapshot.warnings, reconciliations: [], clearedAt: now, clearWatermarks,
      versions: Object.fromEntries(Object.entries(entry.files).map(([name, item]) => [name, [item.hash]])) };
    return view(state.projects[key]);
  });
  return { ensureProject, capture, ingest, backfill,
    getProject: root => view(state.projects[projectKey(root)]),
    listProjects: () => Object.values(state.projects).map(view),
    flush: async () => { await queue; },
    close: () => {
      const closing = queue.then(async () => {
        if (closed) return;
        if ([...active.values()].some(Boolean)) throw new Error('Cannot close metrics service while a tool is executing');
        closed = true;
        await releaseLock();
      });
      queue = closing.catch(() => {});
      return closing;
    },
    clearProject,
  };
}
