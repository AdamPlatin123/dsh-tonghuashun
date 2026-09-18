import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countLines, changeCounts, projectKey, createProject, recordChange,
  deriveCandles, deriveBars, intradaySeries, normalizeUsage, recordUsage,
} from '../src/core/metrics.js';

const at = '2026-09-06T00:00:00.000Z';
const change = (id, added, deleted, date = at) => ({ id, added, deleted, at: date, sessionId: 's1', tool: 'Edit', path: 'src/a.js' });
const usage = (overrides = {}) => ({ inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 10, reasoningTokens: 30, ...overrides });

test('line counting treats LF and CRLF equally without a phantom final line', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\n'), 1);
  assert.equal(countLines('a\r\nb\r\n'), 2);
  assert.equal(countLines('\n\n'), 2);
  assert.throws(() => countLines(null));
});

test('diff counts actual additions and deletions including net-zero edits', () => {
  assert.deepEqual(changeCounts('a\nb\nc\n', 'a\nx\nc\n'), { added: 1, deleted: 1 });
  assert.deepEqual(changeCounts('a\r\n', 'a\n'), { added: 0, deleted: 0 });
  assert.deepEqual(changeCounts('a', 'a\n'), { added: 0, deleted: 0 });
  assert.deepEqual(changeCounts(null, 'a\nb\n'), { added: 2, deleted: 0 });
  assert.deepEqual(changeCounts('a\nb\n', null), { added: 0, deleted: 2 });
  assert.throws(() => changeCounts(undefined, 'a'));
});

test('project identity normalizes Windows roots but preserves Linux case', () => {
  assert.equal(projectKey('G:\\Projects\\Foo\\'), projectKey('g:/projects/foo'));
  assert.equal(projectKey('\\\\Server\\Share\\Foo'), projectKey('//server/share/foo/'));
  assert.notEqual(projectKey('/projects/Foo'), projectKey('/projects/foo'));
  assert.equal(projectKey('/projects/a/../foo/'), '/projects/foo');
});

test('large deletion and restoration retain separate candles and history', () => {
  const initial = createProject('G:/project', 12000, at);
  const deleted = recordChange(initial, change('delete', 0, 10000));
  const restored = recordChange(deleted, change('restore', 10000, 0));
  assert.equal(initial.currentLines, 12000);
  assert.equal(initial.records.length, 0);
  assert.equal(deleted.currentLines, 2000);
  assert.equal(restored.currentLines, 12000);
  assert.deepEqual(restored.records.map(({ open, close, high, low, volume }) => ({ open, close, high, low, volume })), [
    { open: 12000, close: 2000, high: 12000, low: 2000, volume: 10000 },
    { open: 2000, close: 12000, high: 12000, low: 2000, volume: 10000 },
  ]);
  assert.equal(recordChange(restored, change('restore', 10000, 0)), restored);
  const edited = recordChange(restored, change('edit', 4, 4));
  assert.equal(edited.records.at(-1).volume, 8);
  assert.equal(edited.currentLines, 12000);
});

test('invalid counts and total drift are rejected without modifying project', () => {
  const project = createProject('/project', 10, at);
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createProject('/project', value, at));
    assert.throws(() => recordChange(project, change('bad', value, 0)));
    assert.throws(() => normalizeUsage(usage({ inputTokens: value })));
  }
  assert.throws(() => recordChange(project, change('negative-total', 0, 11)));
  assert.throws(() => recordChange(project, { ...change('drift', 2, 0), afterTotal: 13 }), /total|drift/i);
  assert.throws(() => recordChange(project, change('date', 1, 0, 'invalid')));
  assert.equal(project.records.length, 0);
});

test('net-zero edits preserve a safely representable maximum project total', () => {
  const project = createProject('/project', Number.MAX_SAFE_INTEGER, at);
  assert.equal(recordChange(project, change('replace', 2, 2)).currentLines, Number.MAX_SAFE_INTEGER);
});

test('event candles preserve identity for events sharing a timestamp', () => {
  let project = createProject('/project', 100, at);
  project = recordChange(project, change('a', 10, 0));
  project = recordChange(project, change('b', 0, 20));
  const candles = deriveCandles(project.records, 'event');
  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map((candle) => candle.id), ['a', 'b']);
});

test('daily candles use chronological records and open from previous close', () => {
  let project = createProject('/project', 100, at);
  project = recordChange(project, change('a', 10, 0, '2026-09-01T01:00:00Z'));
  project = recordChange(project, change('b', 0, 30, '2026-09-01T20:00:00Z'));
  project = recordChange(project, change('c', 5, 0, '2026-09-02T08:00:00Z'));
  const candles = deriveCandles([...project.records].reverse(), 'day');
  assert.equal(candles.length, 2);
  assert.deepEqual(candles.map(({ open, close, high, low, volume }) => ({ open, close, high, low, volume })), [
    { open: 100, close: 80, high: 110, low: 80, volume: 40 },
    { open: 80, close: 85, high: 85, low: 80, volume: 5 },
  ]);
  assert.equal(candles[0].time, '2026-09-01');
});

test('week starts on UTC Monday and months follow actual calendar boundaries', () => {
  let project = createProject('/project', 10, at);
  for (const [id, date] of [['a', '2026-08-30T23:59:00Z'], ['b', '2026-08-31T00:00:00Z'], ['c', '2026-09-01T00:00:00Z']]) {
    project = recordChange(project, change(id, 1, 0, date));
  }
  assert.deepEqual(deriveCandles(project.records, 'week').map((c) => [c.time, c.volume]), [['2026-08-24', 1], ['2026-08-31', 2]]);
  assert.deepEqual(deriveCandles(project.records, 'month').map((c) => [c.time, c.volume]), [['2026-08-01', 2], ['2026-09-01', 1]]);
  assert.throws(() => deriveCandles(project.records, 'year'));
});

test('token normalization does not add reasoning twice and honors provider total', () => {
  assert.equal(normalizeUsage(usage()).totalTokens, 170);
  assert.equal(normalizeUsage(usage({ totalTokens: 180 })).totalTokens, 180);
  assert.throws(() => normalizeUsage(usage({ totalTokens: 169 })));
  assert.throws(() => normalizeUsage(usage({ reasoningTokens: 41 })));
  assert.equal(normalizeUsage({ inputTokens: 100, outputTokens: 40 }).totalTokens, null);
  assert.equal(normalizeUsage({ totalTokens: 200 }).totalTokens, 200);
  assert.throws(() => normalizeUsage({ totalTokens: 10, reasoningTokens: 20 }));
});

test('usage updates replace one attempt, while retries accumulate', () => {
  const initial = createProject('/project', 10, at);
  const sample = { id: 'attempt-1', at, sessionId: 's1', turn: 't1', step: 'step1', attempt: 1, usage: usage() };
  const first = recordUsage(initial, sample);
  const updated = recordUsage(first, { ...sample, usage: usage({ outputTokens: 50 }) });
  const retried = recordUsage(updated, { ...sample, id: 'attempt-2', attempt: 2 });
  assert.equal(first.usage.totalTokens, 170);
  assert.equal(updated.usage.totalTokens, 180);
  assert.equal(updated.usageRecords.length, 1);
  assert.equal(retried.usage.totalTokens, 350);
  assert.equal(retried.usage.reasoningTokens, 60);
  assert.equal(retried.usageRecords.length, 2);
  assert.equal(initial.usageRecords.length, 0);
});

test('unknown usage keeps known subtotal without claiming an exact total', () => {
  let project = createProject('/project', 10, at);
  project = recordUsage(project, { id: 'known', at, usage: usage() });
  project = recordUsage(project, { id: 'unknown', at, usage: { outputTokens: 2 } });
  assert.equal(project.usage.totalTokens, null);
  assert.equal(project.usage.known.totalTokens, 170);
  assert.equal(project.usage.unknown.totalTokens, 1);
  assert.equal(project.usage.outputTokens, 42);
  assert.equal(project.usage.inputTokens, null);
  assert.equal(project.usage.known.inputTokens, 100);
  assert.equal(project.usage.sampleCount, 2);
});

test('bar stream stays continuous, exposes unattributed drift, and ends on the current total', () => {
  let project = createProject('/project', 100, at);
  project = recordChange(project, change('a', 10, 0, '2026-09-01T01:00:00.000Z'));
  // 外部校准把总量从 110 拉到 160，这笔变化没有任何逐笔记录。
  project = { ...project, reconciliations: [{ id: 'r1', at: '2026-09-01T02:00:00.000Z', kind: 'external', reason: 'filesystem-reconciliation', beforeTotal: 110, afterTotal: 160 }], currentLines: 160 };
  project = recordChange(project, change('b', 0, 20, '2026-09-01T03:00:00.000Z'));
  // 当前总量又与最后一笔收盘不一致（末次扫描看到的外部漂移）。
  project = { ...project, currentLines: 130 };
  const bars = deriveBars(project, { now: Date.parse('2026-09-01T04:00:00.000Z') });
  const agent = bars.filter(bar => bar.source === 'host-tool-result');
  assert.deepEqual(agent.map(bar => bar.id), ['a', 'b']);
  for (let index = 1; index < bars.length; index += 1) {
    assert.equal(bars[index].open, bars[index - 1].close, `第 ${index} 根的 open 必须等于上一根 close`);
  }
  assert.equal(bars.at(-1).close, 130);
  assert.equal(bars.at(-1).kind, 'current');
  assert.equal(bars.at(-1).volume, 0);
  const drift = bars.filter(bar => bar.source === 'unattributed');
  assert.deepEqual(drift.map(bar => [bar.reason, bar.volume]), [['current-state-drift', 10]]);
  assert.equal(bars.find(bar => bar.id === 'r1').source, 'external');
  for (const bar of bars) {
    assert.ok(bar.low <= Math.min(bar.open, bar.close));
    assert.ok(bar.high >= Math.max(bar.open, bar.close));
    assert.equal(bar.close, bar.open + bar.added - bar.deleted);
  }
});

test('a first record that already drifted from the baseline is not hidden', () => {
  const base = createProject('/project', 100, at);
  const project = {
    ...base, currentLines: 125,
    records: [{ ...change('a', 5, 0, '2026-09-01T01:00:00.000Z'), open: 120, close: 125, high: 125, low: 120, volume: 5, kind: 'edit', source: 'host-tool-result' }],
  };
  const bars = deriveBars(project, { now: Date.parse('2026-09-01T02:00:00.000Z') });
  assert.deepEqual(bars.map(bar => [bar.source, bar.open, bar.close, bar.volume]), [
    ['unattributed', 100, 120, 20],
    ['host-tool-result', 120, 125, 5],
    ['current', 125, 125, 0],
  ]);
  assert.equal(bars[0].reason, 'before-first-record');
  assert.equal(bars.at(-1).close, project.currentLines);
  const scoped = deriveBars(project, { now: Date.parse('2026-09-01T02:00:00.000Z'), sessionId: 'other' });
  assert.deepEqual(scoped, []);
});

test('aggregated candles recompute high and low around open and close', () => {
  const bars = [
    { id: 'x', at: '2026-09-01T01:00:00.000Z', open: 100, close: 90, high: 100, low: 90, added: 0, deleted: 10, volume: 10, source: 'host-tool-result' },
    { id: 'y', at: '2026-09-01T02:00:00.000Z', open: 90, close: 200, high: 200, low: 90, added: 110, deleted: 0, volume: 110, source: 'unattributed' },
    { id: 'z', at: '2026-09-01T03:00:00.000Z', open: 200, close: 205, high: 205, low: 200, added: 5, deleted: 0, volume: 5, source: 'host-tool-result' },
  ];
  const [candle] = deriveCandles(bars, 'day');
  assert.equal(candle.open, 100);
  assert.equal(candle.close, 205);
  assert.equal(candle.high, 205);
  assert.equal(candle.low, 90);
  assert.equal(candle.volume, 125);
  assert.equal(candle.agentCount, 2);
  assert.equal(candle.externalCount, 1);
  assert.equal(candle.close, candle.open + candle.added - candle.deleted);
});

test('intraday slots follow real time, fill empty buckets, and merge one second', () => {
  const bars = [
    { id: 'a', at: '2026-09-10T22:00:00.000Z', open: 10, close: 12, high: 12, low: 10, added: 2, deleted: 0, volume: 2, source: 'host-tool-result' },
    { id: 'b', at: '2026-09-10T22:00:00.500Z', open: 12, close: 11, high: 12, low: 11, added: 0, deleted: 1, volume: 1, source: 'host-tool-result' },
    { id: 'c', at: '2026-09-10T22:00:05.000Z', open: 11, close: 14, high: 14, low: 11, added: 3, deleted: 0, volume: 3, source: 'host-tool-result' },
    { id: 'd', at: '2026-09-10T22:00:59.000Z', open: 14, close: 15, high: 15, low: 14, added: 1, deleted: 0, volume: 1, source: 'host-tool-result' },
  ];
  const { seconds, series } = intradaySeries(bars);
  assert.equal(seconds, 5);
  assert.equal(series.length, 12);
  const start = Math.floor(Date.parse('2026-09-10T22:00:00.000Z') / 1000 / 5) * 5;
  assert.deepEqual(series.slice(0, 3).map(item => item.time), [start, start + 5, start + 10]);
  const first = series[0];
  assert.equal(first.open, 10);
  assert.equal(first.close, 11);
  assert.equal(first.high, 12);
  assert.equal(first.low, 10);
  assert.equal(first.volume, 3);
  assert.equal(first.eventCount, 2);
  assert.ok(series[2].whitespace);
  assert.equal(series.filter(item => item.whitespace).length, 9);
  for (let index = 1; index < series.length; index += 1) assert.ok(series[index].time > series[index - 1].time, '槽位时间必须严格递增');
  assert.equal(series.at(-1).close, 15);
});

test('intraday bucket width follows event density and keeps slots bounded', () => {
  const start = Date.parse('2026-09-01T00:00:00.000Z');
  const hourly = Array.from({ length: 40 }, (_, index) => {
    const at = new Date(start + index * 3600 * 1000).toISOString();
    return { id: `h${index}`, at, open: 1000 + index, close: 1001 + index, high: 1001 + index, low: 1000 + index, added: 1, deleted: 0, volume: 1, source: 'host-tool-result' };
  });
  const sparse = intradaySeries(hourly, { targetPoints: 1200 });
  assert.equal(sparse.seconds, 3600);
  assert.equal(sparse.series.length, 40);
  assert.equal(sparse.series[0].open, 1000);
  assert.equal(sparse.series.at(-1).close, 1040);

  const burst = Array.from({ length: 12 }, (_, index) => ({
    id: `b${index}`, at: new Date(start + index * 90000).toISOString(), open: 100 + index, close: 101 + index,
    high: 101 + index, low: 100 + index, added: 1, deleted: 0, volume: 1, source: 'host-tool-result',
  }));
  const dense = intradaySeries(burst, { targetPoints: 1200 });
  assert.equal(dense.seconds, 120);
  assert.ok(dense.series.length <= 1201);
  assert.deepEqual(intradaySeries([]), { seconds: 1, series: [], compressed: false });
});

test('a long idle tail is folded instead of stretching the axis, and the anchor keeps the current total', () => {
  const bars = [
    { id: 'a', at: '2026-09-01T00:00:00.000Z', open: 100, close: 110, high: 110, low: 100, added: 10, deleted: 0, volume: 10, source: 'host-tool-result' },
    { id: 'b', at: '2026-09-01T00:02:00.000Z', open: 110, close: 120, high: 120, low: 110, added: 10, deleted: 0, volume: 10, source: 'host-tool-result' },
    { id: 'current:1', at: '2026-09-11T00:00:00.000Z', open: 140, close: 140, high: 140, low: 140, added: 0, deleted: 0, volume: 0, kind: 'current', source: 'current' },
  ];
  const { seconds, series, compressed, idleSeconds } = intradaySeries(bars);
  assert.equal(seconds, 120);
  assert.equal(compressed, true);
  assert.ok(idleSeconds > 800000, '未折叠前的空闲时长应当记录下来');
  assert.equal(series.length, 8);
  assert.equal(series.at(-1).close, 140);
  assert.equal(series.at(-1).kind, 'current');
  const tight = intradaySeries([...bars.slice(0, 2), { ...bars[2], at: '2026-09-01T00:08:00.000Z' }]);
  assert.equal(tight.compressed, false);
  assert.equal(tight.idleSeconds, 0);
});
