import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { bindThemeOverrides, createSkinState, SKIN_STORAGE_KEY, TERMINAL_TOKENS } from '../src/client/theme.js';
import { labelWidth, packLabelIndices } from '../src/client/labels.js';
import { candleStyle, isAgent, scaledOhlc, SCALE_LABELS, HOLLOW, UP, DOWN, DRIFT, CURRENT } from '../src/client/candles.js';

test('skin defaults on and preserves the visual preference only', () => {
  const writes = [];
  const skin = createSkinState({ getItem: () => null, setItem: (...args) => writes.push(args) });
  assert.equal(skin.getSnapshot(), true);
  skin.setEnabled(false);
  assert.deepEqual(writes, [[SKIN_STORAGE_KEY, 'false']]);
  assert.equal(createSkinState({ getItem: () => 'false' }).getSnapshot(), false);
});

test('theme overrides restore on disable and plugin disposal without changing preference', () => {
  const skin = createSkinState({ getItem: () => null });
  let mounted = 0;
  const cleanup = bindThemeOverrides({
    overrideTokens(source, tokens) {
      assert.equal(source, 'dsh-tonghuashun');
      assert.equal(tokens, TERMINAL_TOKENS);
      for (const pair of Object.values(tokens)) {
        assert.equal(typeof pair.light, 'string');
        assert.equal(typeof pair.dark, 'string');
      }
      mounted++;
      return () => { mounted--; };
    },
    setTheme() { assert.fail('must preserve the user theme preference'); },
  }, skin);
  assert.equal(mounted, 1);
  skin.setEnabled(false);
  assert.equal(mounted, 0);
  skin.setEnabled(true);
  assert.equal(mounted, 1);
  cleanup();
  assert.equal(mounted, 0);
  skin.setEnabled(false);
  skin.setEnabled(true);
  assert.equal(mounted, 0);
});

test('client uses current additive slots and obtains project data from standard hooks', async () => {
  const source = await readFile(new URL('../src/client/plugin.jsx', import.meta.url), 'utf8');
  assert.match(source, /name: 'details', priority: -100/);
  assert.match(source, /layout\.openDetails/);
  assert.match(source, /conversation\.session\.header\.utilities/);
  assert.match(source, /settings\.general\.item/);
  assert.match(source, /useSessions/);
  assert.match(source, /useWorkspaces/);
  assert.doesNotMatch(source, /dsh-client-runtime|conversation\.bottom\.panel|conversation\.input\.dock|document\./);
});

test('period tabs expose 逐步 before 分时 and the detail tab is renamed to 逐步修改', async () => {
  const source = await readFile(new URL('../src/client/MarketPanel.jsx', import.meta.url), 'utf8');
  const periods = source.match(/const PERIODS = \[(.*?)\];/s)?.[1];
  assert.ok(periods, 'PERIODS 必须存在');
  const order = ['逐步', '分时', '日 K', '周 K', '月 K'].map(label => periods.indexOf(`'${label}'`));
  for (const [index, at] of order.entries()) {
    assert.ok(at >= 0, `周期 ${index} 缺失`);
    if (index) assert.ok(order[index - 1] < at, '周期顺序必须是 逐步 → 分时 → 日 K → 周 K → 月 K');
  }
  assert.match(source, /setTab\('changes'\)}>逐步修改</);
  assert.doesNotMatch(source, /逐笔修改/);
});

test('label width grows with CJK characters and digits', () => {
  assert.ok(labelWidth('行') > labelWidth('1'));
  assert.ok(labelWidth('未归属') > labelWidth('行'));
  assert.ok(labelWidth('+10,000 行') > labelWidth('+10,000'));
  assert.equal(labelWidth(''), 8);
});

test('crowded markers keep symbols but drop colliding text, newest first', () => {
  // 三根相邻柱子，屏幕坐标只差 20px，而每条标签约 60px 宽：只能留一条。
  const crowded = [
    { x: 100, text: '-10,000 行', position: 'aboveBar' },
    { x: 120, text: '-10,000 行', position: 'aboveBar' },
    { x: 300, text: '+10,000 行', position: 'belowBar' },
  ];
  assert.deepEqual([...packLabelIndices(crowded)].sort((a, b) => a - b), [1, 2]);

  // 两侧互不遮挡：柱上方与柱下方各自排布，可以同时保留。
  const split = [{ x: 100, text: '-10,000 行', position: 'aboveBar' }, { x: 104, text: '+10,000 行', position: 'belowBar' }];
  assert.deepEqual([...packLabelIndices(split)].sort((a, b) => a - b), [0, 1]);

  // 间隔足够时全部保留，且不超过上限。
  const spaced = Array.from({ length: 9 }, (_, index) => ({ x: index * 200, text: '+1,000 行', position: 'belowBar' }));
  assert.equal(packLabelIndices(spaced, { maxLabels: 6 }).size, 6);
  assert.equal(packLabelIndices([]).size, 0);
});

test('hollow and solid encode provenance while colour keeps the direction', () => {
  // Agent 归属：涨红跌绿，实心（color 不透明）。
  assert.deepEqual(candleStyle({ source: 'host-tool-result', open: 10, close: 12 }), { fill: UP, border: UP, wick: UP, volume: UP, hollow: false, agent: true });
  assert.deepEqual(candleStyle({ source: 'host-tool-result', open: 12, close: 10 }), { fill: DOWN, border: DOWN, wick: DOWN, volume: DOWN, hollow: false, agent: true });
  // 未归属：灰色空心，只剩边框。
  const drift = candleStyle({ source: 'external', open: 10, close: 12 });
  assert.equal(drift.fill, HOLLOW);
  assert.equal(drift.border, DRIFT);
  assert.equal(drift.hollow, true);
  // 当前状态锚点：金色空心，零高度渲染成一条金线。
  const anchor = candleStyle({ source: 'current', open: 10, close: 10 });
  assert.equal(anchor.fill, HOLLOW);
  assert.equal(anchor.border, CURRENT);
  assert.equal(anchor.agent, false);
  // 聚合柱只要含 Agent 工作量就算归属，且成交量直方图不能跟着变透明。
  assert.equal(candleStyle({ source: 'unattributed', agentCount: 3, externalCount: 1, open: 10, close: 11 }).hollow, false);
  for (const style of [drift, anchor]) assert.notEqual(style.volume, HOLLOW);
  assert.equal(isAgent({ source: 'unattributed', agentCount: 1 }), true);
  assert.equal(isAgent({ source: 'unattributed' }), false);
  assert.equal(isAgent({}), true, '历史账本里没有 source 字段的记录同样是工具结果，按归属处理');
});

test('per-bar change mode decouples small edits from total drift', () => {
  // 同一次 +20 行改动：绝对口径只占 20 行高度，变化口径画满 20 行本身。
  const small = { open: 1000000, high: 1000020, low: 1000000, close: 1000020 };
  assert.deepEqual(scaledOhlc(small, 'absolute', 0), { open: 1000000, high: 1000020, low: 1000000, close: 1000020 });
  assert.deepEqual(scaledOhlc(small, 'baseline', 999000), { open: 1000, high: 1020, low: 1000, close: 1020 });
  assert.deepEqual(scaledOhlc(small, 'change', 0), { open: 0, close: 20, high: 20, low: 0 });
  // 删除：变化口径画出 0 到负值的柱，且 low 取负值、high 取 0。
  assert.deepEqual(scaledOhlc({ open: 500, high: 500, low: 480, close: 480 }, 'change', 0), { open: 0, close: -20, high: 0, low: -20 });
  // 零变化（当前状态锚点）在变化口径下是一条 0 线。
  assert.deepEqual(scaledOhlc({ open: 122857, high: 122857, low: 122857, close: 122857 }, 'change', 0), { open: 0, close: 0, high: 0, low: 0 });
  assert.equal(Object.keys(SCALE_LABELS).length, 3);
  assert.equal(scaledOhlc({ open: 10, high: 12, low: 8, close: 11 }, 'absolute', 99).open, 10, '绝对口径不得偏移');
});
