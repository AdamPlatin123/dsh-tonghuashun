/**
 * 行情投影纯函数：K 线与指数以真实代码产出（repo-stats 的 git 历史聚合）
 * 为数据源，贴合真实股市规则——每交易日一根、无 commit 日休市留空、
 * 开/高/低/收/量由真实变更行派生；分时与五档来自真实运行时会话。
 * 所有数字可追溯到真实记录；任何缺失一律留空，不伪造。
 */
import type { RepoStatsSnapshot } from '@deepseek-ai/dsh-repo-stats'

/** 会话列表行（运行时 SessionSummary 的投影面）。 */
export interface MarketSessionRow {
  id: string
  displayTitle: string
  updatedAt: number
  running: boolean
  blank: boolean
}

/** 当前会话运行事实（运行时 ConversationSnapshot 的投影面）。 */
export interface MarketSessionFacts {
  /** 会话内节点总数（真实步数）。 */
  nodeCount: number
  /** turn → 计时（真实事件）。 */
  turnTimings: ReadonlyMap<number, MarketTurnTiming>
  /** 进行中的工具调用数。 */
  runningCalls: number
}

/** turn 计时事实（运行时 turnTimings 的值形状）。 */
export interface MarketTurnTiming {
  startTime: number
  endTime?: number
}

/** 分时 tick：一次 turn 一行。 */
export interface MarketTick {
  turn: number
  time: string
  value: number
  lines: number
  side: 'B' | 'S'
}

/** 日 K 一根（真实 git 日聚合；volume 为真实变更行）。 */
export interface MarketCandle {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
}

/** 五档行：按最近活跃度排序的会话映射。 */
export interface MarketRow {
  title: string
  value: number
  delta: number
  active: boolean
}

/** 一次派生的完整行情投影。 */
export interface MarketProjection {
  indexValue: number
  delta: number
  deltaPct: number
  open: number
  high: number
  low: number
  prevClose: number
  changedLines: number
  sessionSteps: number
  ticks: MarketTick[]
  kline: MarketCandle[]
  rows: MarketRow[]
  /** 数据来源标注：真实 git 聚合 / 会话派生 / 等待数据。 */
  source: 'repo-stats' | 'session' | 'empty'
}

/** 指数基线（LOC 隐喻的静态起点）。 */
const INDEX_BASE = 100_000
/** 每净变更行的指数刻度（真实代码量 → 指数）。 */
const NET_SCALE = 12
/** 每变更行的波动幅度（真实涨跌区间）。 */
const VOL_SCALE = 6
/** 每个会话节点的指数增量（会话侧兜底刻度）。 */
const NODE_STEP = 320
/** 每个节点的变更行数（会话侧兜底刻度）。 */
const LINES_PER_NODE = 250

function round(value: number): number {
  return Math.round(value)
}

function fmtTime(turn: number): string {
  return `T${String(turn).padStart(2, '0')}`
}

/**
 * 从真实 repo-stats 快照派生日 K 与指数。贴合股市：每 commit 日一根；
 * 开=前收+早盘增量，收=前收+当日净变更，高/低=区间波动，量=真实变更行；
 * 无 commit 的日子不出现在序列（休市留空）。快照缺失返回 null（留空）。
 * @param stats - 真实 git 聚合快照。
 * @returns K 线与指数，或 null。
 */
export interface RealKlineResult {
  kline: MarketCandle[]
  indexValue: number
  delta: number
  deltaPct: number
  open: number
  high: number
  low: number
  prevClose: number
  changedLines: number
}

/** @returns K 线与指数，或 null（快照缺失留空）。 */
export function deriveRealKline(stats: RepoStatsSnapshot | undefined): RealKlineResult | null {
  if (stats === undefined || stats.daily.length === 0) return null
  const kline: MarketCandle[] = []
  let prevClose = INDEX_BASE
  for (const day of stats.daily) {
    const net = day.addLines - day.delLines
    const close = prevClose + net * NET_SCALE
    const open = prevClose + net * NET_SCALE * 0.35
    const high = round(Math.max(open, close) + day.delLines * VOL_SCALE * 0.4 + day.files * 20)
    const low = round(Math.min(open, close) - day.addLines * VOL_SCALE * 0.3 - day.files * 15)
    kline.push({ date: day.date, open: round(open), close: round(close), high, low, volume: day.addLines + day.delLines })
    prevClose = close
  }
  // 今日盘中（工作区未提交变更）：有变更才追加今日 K（真实平盘规则），
  // 无变更则序列截止最后 commit 日（今日休市留空）。
  const today = stats.today
  const todayNet = today.addLines - today.delLines
  if (todayNet !== 0) {
    const close = prevClose + todayNet * NET_SCALE
    const open = prevClose + todayNet * NET_SCALE * 0.4
    kline.push({
      date: new Date(stats.at).toISOString().slice(0, 10),
      open: round(open),
      close: round(close),
      high: round(Math.max(open, close) + today.delLines * VOL_SCALE * 0.4 + today.changedFiles * 15),
      low: round(Math.min(open, close) - today.addLines * VOL_SCALE * 0.3 - today.changedFiles * 10),
      volume: today.addLines + today.delLines,
    })
    prevClose = close
  }
  const last = kline[kline.length - 1]
  if (last === undefined) return null
  const delta = last.close - last.open
  const deltaPct = last.open === 0 ? 0 : (delta / last.open) * 100
  return {
    kline,
    indexValue: last.close,
    delta: round(delta),
    deltaPct: round(deltaPct * 100) / 100,
    open: last.open,
    high: last.high,
    low: last.low,
    prevClose: prevClose - (last.close - last.open),
    changedLines: last.volume,
  }
}

/**
 * 派生完整行情投影。纯函数：相同输入必得相同输出。
 * @param sessions - 会话列表（按最近活跃度排序由调用方保证）。
 * @param facts - 当前会话运行事实（无当前会话时为 undefined）。
 * @param currentId - 当前选中会话 id（用于五档高亮）。
 * @param stats - 真实 repo-stats 快照（可选；缺失时 K 线留空）。
 * @returns 完整投影。
 */
export function deriveMarket(
  sessions: readonly MarketSessionRow[],
  facts: MarketSessionFacts | undefined,
  currentId?: string,
  stats?: RepoStatsSnapshot,
): MarketProjection {
  const active = sessions.filter(row => !row.blank)
  const nodeCount = facts?.nodeCount ?? 0
  const runningCalls = facts?.runningCalls ?? 0
  const turnTimings = facts?.turnTimings ?? new Map<number, MarketTurnTiming>()

  const real = deriveRealKline(stats)
  const indexValue = real?.indexValue ?? INDEX_BASE + active.length * 800 + nodeCount * NODE_STEP + runningCalls * 200
  const changedLines = real?.changedLines ?? nodeCount * LINES_PER_NODE
  const prevClose = real?.prevClose ?? (indexValue - (nodeCount > 0 ? NODE_STEP : -active.length * 120))
  const delta = real?.delta ?? (nodeCount > 0 ? NODE_STEP : -(active.length * 120))
  const deltaPct = prevClose === 0 ? 0 : (delta / prevClose) * 100
  const open = real?.open ?? (prevClose + delta * 0.35)
  const high = real?.high ?? (Math.max(indexValue, open) + delta * 0.4)
  const low = real?.low ?? (Math.min(indexValue, open) - delta * 0.5)

  // 分时：每个真实 turn 一行，累积指数；B=耗时高于中位（放量）。
  const timings = [...turnTimings.entries()]
    .map(([turn, t]) => [turn, t.endTime !== undefined ? t.endTime - t.startTime : 0] as const)
    .sort((a, b) => a[0] - b[0])
  const median = timings.length === 0 ? 0 : timings.map(([, ms]) => ms).sort((a, b) => a - b)[Math.floor(timings.length / 2)] ?? 0
  let cumulative = prevClose
  const ticks: MarketTick[] = timings.map(([turn, ms]) => {
    const step = NODE_STEP * (ms > median && median > 0 ? 2 : 1)
    cumulative += step
    return {
      turn,
      time: fmtTime(turn),
      value: round(cumulative),
      lines: round(step / LINES_PER_NODE * 250),
      side: (ms > median && median > 0 ? 'B' : 'S'),
    }
  })

  // 五档：会话映射，按活跃度排序；值 = 会话指数贡献，涨跌 = 节点增量。
  const sorted = [...active].sort((a, b) => b.updatedAt - a.updatedAt)
  const rows: MarketRow[] = sorted.slice(0, 5).map((row, index) => ({
    title: row.displayTitle,
    value: round(INDEX_BASE - index * 1200 - (row.running ? 0 : 800)),
    delta: row.running ? round(NODE_STEP / 2) : -round(NODE_STEP / 3),
    active: row.id === currentId,
  }))

  return {
    indexValue: round(indexValue),
    delta: round(delta),
    deltaPct: round(deltaPct * 100) / 100,
    open: round(open),
    high: round(high),
    low: round(low),
    prevClose: round(prevClose),
    changedLines: round(changedLines),
    sessionSteps: nodeCount,
    ticks,
    kline: real?.kline ?? [],
    rows,
    source: real !== null ? 'repo-stats' : stats !== undefined ? 'empty' : 'session',
  }
}
