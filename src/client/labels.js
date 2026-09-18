// 屏幕空间标注排布：K 线上方/下方的文字标注必须互相让位，否则相邻柱的长标签会叠在一起。
// 这里保持纯函数，便于单元测试；Chart.jsx 只负责提供屏幕坐标和渲染结果。

const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/;

/** 粗略估算标签像素宽度：中文按字号算，数字与符号按约 0.56 字号算，另加左右内边距。 */
export function labelWidth(text, { fontSize = 11, padding = 8 } = {}) {
  let width = padding;
  for (const char of String(text ?? '')) width += fontSize * (CJK.test(char) ? 1 : 0.56);
  return width;
}

function overlaps(left, right, minGap) {
  return left.left < right.right + minGap && right.left < left.right + minGap;
}

/**
 * 挑选互不重叠的标注索引：同一侧（柱上方 / 柱下方）各自从最右（最新）开始贪心保留，
 * 与已保留矩形相交的候选只丢文字、保留标记符号。
 * @param candidates 每项形如 { x, text, position }，x 是屏幕横坐标。
 * @returns 保留文字的候选下标集合。
 */
export function packLabelIndices(candidates, { minGap = 8, fontSize = 11, maxLabels = 6 } = {}) {
  const groups = new Map();
  candidates.forEach((candidate, index) => {
    const key = candidate.position ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...candidate, index });
  });
  const kept = new Set();
  for (const group of groups.values()) {
    const chosen = [];
    for (const candidate of [...group].sort((left, right) => right.x - left.x)) {
      if (chosen.length >= maxLabels) break;
      const width = labelWidth(candidate.text, { fontSize });
      const rect = { left: candidate.x - width / 2, right: candidate.x + width / 2 };
      if (chosen.some(item => overlaps(rect, item.rect, minGap))) continue;
      chosen.push({ rect });
      kept.add(candidate.index);
    }
  }
  return kept;
}
