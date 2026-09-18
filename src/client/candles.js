// 柱体样式映射：颜色表涨跌方向，空/满表归属。
// 轻量图表的边框是系列级开关，逐根只能用 color / borderColor / wickColor；
// 因此「实心」= color 不透明，「空心」= color 透明只留边框（渲染时边框先画、内部填充后画并四边内缩）。

export const UP = '#f05a62';
export const DOWN = '#28d981';
export const DRIFT = '#7b8494';
export const CURRENT = '#e0b34a';
export const HOLLOW = 'transparent';

export const SCALE_MODES = ['absolute', 'baseline', 'change'];
export const SCALE_LABELS = { absolute: '绝对行数', baseline: '相对基线', change: '每笔变化' };

/**
 * 把一根柱映射到当前纵轴口径下的开高低收。
 * - absolute：项目真实总量；
 * - baseline：总量减去基线，只去掉固定锚点；
 * - change：**这根柱自己的净变化**（0 居中）。总量漂移有几百万行时，绝对口径会把
 *   几十行的真实改动压到 0 像素，因为纵轴画的是「总量」而不是「这次改了多少」。
 */
export function scaledOhlc(bar, mode = 'absolute', baseline = 0) {
  if (mode === 'change') {
    const delta = bar.close - bar.open;
    return { open: 0, close: delta, high: Math.max(0, delta), low: Math.min(0, delta) };
  }
  const offset = mode === 'baseline' ? baseline : 0;
  return { open: bar.open - offset, high: bar.high - offset, low: bar.low - offset, close: bar.close - offset };
}

const NON_AGENT_SOURCES = new Set(['external', 'unattributed', 'current']);

/**
 * 是否算 Agent 归属。
 * 聚合柱只要含 Agent 增量就算归属（哪怕组内第一根是未归属柱）；原始柱则只有明确的
 * 未归属来源才算非归属——历史账本里没有 source 字段的记录同样是工具结果，不能误判成漂移。
 */
export const isAgent = (bar) => {
  if ((bar.agentCount ?? 0) > 0) return true;
  if (bar.agentCount !== undefined) return false;
  return !NON_AGENT_SOURCES.has(bar.source);
};

/**
 * 一根柱子的着色方案。
 * - Agent 归属改动：按涨跌红/绿实心；
 * - 未归属（外部校准、补齐的漂移）：灰色空心；
 * - 当前状态锚点：金色空心（零高度，渲染成一条金线）。
 * volume 单独给出：空心柱的 color 是透明的，成交量直方图不能跟着变透明。
 */
export function candleStyle(bar) {
  const direction = bar.close >= bar.open ? UP : DOWN;
  if (bar.source === 'current') return { fill: HOLLOW, border: CURRENT, wick: CURRENT, volume: CURRENT, hollow: true, agent: false };
  if (isAgent(bar)) return { fill: direction, border: direction, wick: direction, volume: direction, hollow: false, agent: true };
  return { fill: HOLLOW, border: DRIFT, wick: DRIFT, volume: DRIFT, hollow: true, agent: false };
}
