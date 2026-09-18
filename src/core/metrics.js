import { diffLines } from 'diff';

export const TOKEN_FIELDS = Object.freeze([
  'totalTokens', 'inputTokens', 'outputTokens', 'cacheReadTokens',
  'cacheWriteTokens', 'reasoningTokens',
]);
const INPUT_OUTPUT_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function sum(values, name) {
  return count(values.reduce((total, value) => total + value, 0), name);
}

function timestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('at must be a valid timestamp');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError('at must be a valid timestamp');
  return date.toISOString();
}

function identifier(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('id must be a non-empty string');
  return value;
}

function text(value) {
  if (typeof value !== 'string') throw new TypeError('File content must be a string');
  return value.replace(/\r\n/g, '\n');
}

export function countLines(value) {
  const normalized = text(value);
  if (!normalized) return 0;
  return normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0);
}

export function changeCounts(before, after) {
  const previous = before === null ? '' : text(before);
  const next = after === null ? '' : text(after);
  const result = { added: 0, deleted: 0 };
  for (const part of diffLines(previous, next, { ignoreNewlineAtEof: true })) {
    if (part.added) result.added += part.count;
    if (part.removed) result.deleted += part.count;
  }
  return result;
}

export function projectKey(root) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('root must be an absolute path');
  const windows = /^[a-z]:[\\/]/i.test(root) || root.startsWith('\\\\') || root.startsWith('//');
  let normalized = windows ? root.replace(/\\/g, '/').toLowerCase() : root;
  let prefix;
  if (windows && /^[a-z]:\//.test(normalized)) {
    prefix = normalized.slice(0, 3);
    normalized = normalized.slice(3);
  } else if (windows && normalized.startsWith('//')) {
    prefix = '//';
    normalized = normalized.slice(2);
  } else if (normalized.startsWith('/')) {
    prefix = '/';
    normalized = normalized.slice(1);
  } else {
    throw new TypeError('root must be an absolute path');
  }
  const parts = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join('/');
}

function summarizeUsage(records) {
  const known = {};
  const unknown = {};
  const summary = {};
  for (const field of TOKEN_FIELDS) {
    known[field] = sum(records.map(({ usage }) => usage[field] ?? 0), field);
    unknown[field] = records.filter(({ usage }) => usage[field] === null).length;
    summary[field] = unknown[field] ? null : known[field];
  }
  return { ...summary, known, unknown, sampleCount: records.length };
}

export function createProject(root, baseline, at) {
  return {
    id: projectKey(root), root, baseline: count(baseline, 'baseline'),
    currentLines: baseline, createdAt: timestamp(at), records: [],
    usage: summarizeUsage([]), usageRecords: [],
  };
}

export function recordChange(project, event) {
  const id = identifier(event.id);
  if (project.records.some((record) => record.id === id)) return project;
  const added = count(event.added, 'added');
  const deleted = count(event.deleted, 'deleted');
  const open = count(project.currentLines, 'currentLines');
  const close = count(open + (added - deleted), 'close');
  if (event.afterTotal !== undefined && count(event.afterTotal, 'afterTotal') !== close) {
    throw new RangeError(`Project total drift: expected ${close}, received ${event.afterTotal}`);
  }
  const record = {
    ...event, id, at: timestamp(event.at), added, deleted,
    open, close, high: Math.max(open, close), low: Math.min(open, close),
    volume: sum([added, deleted], 'volume'),
  };
  return { ...project, currentLines: close, records: [...project.records, record] };
}

function periodStart(at, period) {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  if (period === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (period === 'month') date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
}

const AGENT_SOURCE = 'host-tool-result';
const total = value => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** 一段从 from 到 to 的真实变化，用于补齐未被任何记录解释的落差。 */
function driftBar(from, to, at, reason) {
  const delta = to - from;
  return {
    id: `drift:${at}:${from}:${to}`, at: timestamp(at), open: from, close: to,
    high: Math.max(from, to), low: Math.min(from, to),
    added: delta > 0 ? delta : 0, deleted: delta < 0 ? -delta : 0, volume: Math.abs(delta),
    kind: 'drift', source: 'unattributed', reason, eventCount: 1,
  };
}

function externalBar(item) {
  const delta = item.afterTotal - item.beforeTotal;
  return {
    id: item.id, at: timestamp(item.at), open: item.beforeTotal, close: item.afterTotal,
    high: Math.max(item.beforeTotal, item.afterTotal), low: Math.min(item.beforeTotal, item.afterTotal),
    added: delta > 0 ? delta : 0, deleted: delta < 0 ? -delta : 0, volume: Math.abs(delta),
    kind: 'external', source: 'external', reason: item.reason, eventCount: 1,
  };
}

function agentBar(record) {
  const open = total(record.open);
  const close = total(record.close);
  return {
    ...record, open, close,
    high: Math.max(open, close, total(record.high)), low: Math.min(open, close, total(record.low ?? open)),
    added: total(record.added), deleted: total(record.deleted),
    volume: total(record.volume ?? total(record.added) + total(record.deleted)),
    source: AGENT_SOURCE, eventCount: 1,
  };
}

/**
 * 把逐笔记录、外部校准和「当前状态」锚点串成一条连续柱流：
 * 每根 open 严格等于上一根 close，因此所有行数变化要么归属 Agent，要么显式标成未归属柱。
 * 末根永远是当前项目总量，图表右端与界面顶栏不会再互相矛盾。
 */
export function deriveBars(project, { now = Date.now(), sessionId } = {}) {
  const scoped = sessionId
    ? { ...project, records: (project.records ?? []).filter((record) => record.sessionId === sessionId), reconciliations: [] }
    : project;
  const records = scoped.records ?? [];
  if (sessionId) {
    const last = records.at(-1);
    scoped.currentLines = last ? total(last.close) : total(scoped.baseline);
  }
  const events = [
    ...records.map((record, index) => ({ at: timestamp(record.at), rank: 0, index, kind: 'agent', record })),
    ...(scoped.reconciliations ?? []).map((item, index) => ({ at: timestamp(item.at), rank: 1, index, kind: 'external', item })),
  ].sort((left, right) => {
    if (left.at !== right.at) return left.at.localeCompare(right.at);
    if (left.rank !== right.rank) return left.rank - right.rank;
    return left.index - right.index;
  });

  const bars = [];
  let cursor = null;
  for (const event of events) {
    const from = total(event.kind === 'agent' ? event.record.open : event.item.beforeTotal);
    const to = total(event.kind === 'agent' ? event.record.close : event.item.afterTotal);
    if (cursor === null) {
      // 首笔之前的偏移也用一根未归属柱补齐，不隐藏这段时间的变化。
      if (total(scoped.baseline) !== from) bars.push(driftBar(total(scoped.baseline), from, event.at, 'before-first-record'));
      cursor = from;
    }
    if (from !== cursor) bars.push(driftBar(cursor, from, event.at, 'unrecorded-drift'));
    bars.push(event.kind === 'agent' ? agentBar(event.record) : externalBar(event.item));
    cursor = to;
  }

  if (bars.length) {
    const current = total(scoped.currentLines ?? cursor);
    const lastAt = Date.parse(bars.at(-1).at);
    const anchorAt = Math.max(now, Number.isFinite(lastAt) ? lastAt + 1000 : now);
    if (cursor !== current) bars.push(driftBar(cursor, current, anchorAt, 'current-state-drift'));
    // 末根是零高度锚点，把图表右端钉在当前状态上。
    bars.push({
      id: `current:${anchorAt}`, at: new Date(anchorAt).toISOString(), open: current, close: current,
      high: current, low: current, added: 0, deleted: 0, volume: 0,
      kind: 'current', source: 'current', eventCount: 1,
    });
  }
  return bars;
}

function mergeInto(group, record) {
  group.close = record.close;
  group.high = Math.max(group.high, total(record.high), total(record.open), total(record.close));
  group.low = Math.min(group.low, total(record.low), total(record.open), total(record.close));
  group.volume = sum([group.volume, record.volume], 'volume');
  group.added = sum([group.added, record.added], 'added');
  group.deleted = sum([group.deleted, record.deleted], 'deleted');
  group.eventCount += 1;
  if (record.source === AGENT_SOURCE) group.agentCount += 1;
  else if (record.kind !== 'current') group.externalCount += 1;
}

/** 当前状态锚点不算外部变化：它只把零高度收盘钉在当前总量上。 */
const externalOf = record => record.source !== AGENT_SOURCE && record.kind !== 'current' ? 1 : 0;

export function deriveCandles(records, period = 'event') {
  if (!['event', 'day', 'week', 'month'].includes(period)) throw new RangeError('Unsupported candle period');
  const ordered = records.map((record) => ({ ...record, at: timestamp(record.at) }))
    .sort((left, right) => left.at.localeCompare(right.at));
  if (period === 'event') return ordered.map((record) => ({ ...record, time: record.at }));
  const groups = new Map();
  for (const record of ordered) {
    const time = periodStart(record.at, period);
    const group = groups.get(time);
    if (!group) {
      // 高低必须覆盖开收本身，聚合后仍然满足 low <= min(open, close) <= max(open, close) <= high。
      groups.set(time, {
        ...record, id: `${period}:${time}`, time, eventCount: 1,
        open: total(record.open), close: total(record.close),
        added: total(record.added), deleted: total(record.deleted), volume: total(record.volume),
        high: Math.max(total(record.high), total(record.open), total(record.close)),
        low: Math.min(total(record.low), total(record.open), total(record.close)),
        agentCount: record.source === AGENT_SOURCE ? 1 : 0,
        externalCount: externalOf(record),
      });
    } else mergeInto(group, record);
  }
  return [...groups.values()];
}

const BUCKETS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800, 604800];
const ladder = seconds => BUCKETS.find(size => seconds <= size) ?? BUCKETS.at(-1);

/**
 * 分时：按真实时间分桶，空桶用空白槽位补齐，因此每根柱子的横向位置严格对应真实时间，
 * 而不是把 4 天的跨度压成等距的 38 个刻度。同一桶内的记录合并成一根。
 * 槽位宽度取「事件间隔中位数」与「跨度/目标点数」两者中较粗的一个：前者避免稀疏事件
 * 散落在上千个空格里，后者保证点数有界。末尾长时间空闲折叠成固定几个槽位，且明确标记。
 */
export function intradaySeries(bars, { targetPoints = 1200, maxIdleSlots = 6 } = {}) {
  if (!bars.length) return { seconds: 1, series: [], compressed: false };
  const ordered = bars.map((bar) => ({ ...bar, at: timestamp(bar.at) }))
    .sort((left, right) => left.at.localeCompare(right.at));
  const anchor = ordered.filter((bar) => bar.kind === 'current').at(-1) ?? null;
  const activity = ordered.filter((bar) => bar !== anchor);
  const first = activity[0] ?? ordered[0];
  const last = activity.at(-1) ?? ordered.at(-1);
  const span = Math.max(0, Date.parse(last.at) - Date.parse(first.at)) / 1000;
  const gaps = [];
  for (let index = 1; index < activity.length; index += 1) {
    const gap = (Date.parse(activity[index].at) - Date.parse(activity[index - 1].at)) / 1000;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((left, right) => left - right);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const seconds = Math.max(ladder(median), ladder(span / targetPoints), 1);

  const slotOf = (at) => Math.floor(Date.parse(at) / 1000 / seconds) * seconds;
  const lastSlot = slotOf(last.at);
  const anchorSlot = anchor ? slotOf(anchor.at) : lastSlot;
  const idleSlots = Math.round((anchorSlot - lastSlot) / seconds);
  const compressed = idleSlots > maxIdleSlots;
  const endSlot = compressed ? lastSlot + maxIdleSlots * seconds : anchorSlot;

  const groups = new Map();
  for (const bar of ordered) {
    // 折叠时锚点紧跟在最后一段活动之后，价格仍等于当前总量，只是空闲时间不再占满整条轴。
    const time = bar === anchor ? endSlot : slotOf(bar.at);
    const group = groups.get(time);
    if (!group) {
      groups.set(time, {
        ...bar, id: `slot:${time}`, time, at: new Date(time * 1000).toISOString(), eventCount: 1,
        open: total(bar.open), close: total(bar.close),
        added: total(bar.added), deleted: total(bar.deleted), volume: total(bar.volume),
        high: Math.max(total(bar.high), total(bar.open), total(bar.close)),
        low: Math.min(total(bar.low), total(bar.open), total(bar.close)),
        agentCount: bar.source === AGENT_SOURCE ? 1 : 0,
        externalCount: externalOf(bar),
      });
    } else mergeInto(group, bar);
  }
  const series = [];
  const from = slotOf(first.at);
  for (let time = from; time <= endSlot; time += seconds) {
    series.push(groups.get(time) ?? { id: `slot-gap:${time}`, time, whitespace: true });
  }
  return { seconds, series, compressed, idleSeconds: compressed ? idleSlots * seconds : 0 };
}

export function normalizeUsage(usage = {}) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) throw new TypeError('usage must be an object');
  const result = {};
  for (const field of TOKEN_FIELDS) {
    result[field] = usage[field] == null ? null : count(usage[field], field);
  }
  if (result.reasoningTokens !== null && result.outputTokens !== null && result.reasoningTokens > result.outputTokens) {
    throw new RangeError('reasoningTokens cannot exceed outputTokens');
  }
  // 推理 token 已包含在输出中；缓存读取、写入和未缓存输入是互斥计费桶。
  const knownTotal = sum(INPUT_OUTPUT_FIELDS.map((field) => result[field] ?? 0), 'totalTokens');
  if (result.totalTokens !== null) {
    const minimumTotal = result.outputTokens === null
      ? sum([knownTotal, result.reasoningTokens ?? 0], 'totalTokens') : knownTotal;
    if (result.totalTokens < minimumTotal) throw new RangeError('totalTokens cannot be smaller than known input and output tokens');
  } else if (INPUT_OUTPUT_FIELDS.every((field) => result[field] !== null)) {
    result.totalTokens = knownTotal;
  }
  return result;
}

export function recordUsage(project, event) {
  const record = { ...event, id: identifier(event.id), at: timestamp(event.at), usage: normalizeUsage(event.usage) };
  const existing = project.usageRecords.findIndex(({ id }) => id === record.id);
  const usageRecords = [...project.usageRecords];
  if (existing < 0) usageRecords.push(record);
  else usageRecords[existing] = record;
  return { ...project, usageRecords, usage: summarizeUsage(usageRecords) };
}
