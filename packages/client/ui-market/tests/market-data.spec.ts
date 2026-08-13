/**
 * 行情投影派生测试：真实 repo-stats 驱动的确定性、股市规则、边界。
 */
import { describe, expect, it } from 'vitest'
import { deriveMarket, deriveRealKline, type MarketSessionRow, type MarketSessionFacts } from '../src/client/market-data.ts'
import type { RepoStatsSnapshot } from '@deepseek-ai/dsh-repo-stats'

const ROWS: MarketSessionRow[] = [
  { id: 's1', displayTitle: '皮肤布局审查', updatedAt: 1000, running: false, blank: false },
  { id: 's2', displayTitle: 'K 线接入', updatedAt: 2000, running: true, blank: false },
  { id: 's3', displayTitle: '空会话', updatedAt: 3000, running: false, blank: true },
]

function facts(
  nodeCount = 12,
  turns: Array<[number, { startTime: number; endTime: number }]> = [
    [1, { startTime: 0, endTime: 300 }],
    [2, { startTime: 0, endTime: 700 }],
    [3, { startTime: 0, endTime: 450 }],
  ],
): MarketSessionFacts {
  return { nodeCount, turnTimings: new Map(turns), runningCalls: 1 }
}

interface DaySeed {
  date: string
  commits: number
  addLines: number
  delLines: number
  files: number
}

function stats(
  daily: DaySeed[] = [
    { date: '2026-08-01', commits: 2, addLines: 300, delLines: 100, files: 5 },
    { date: '2026-08-03', commits: 1, addLines: 80, delLines: 40, files: 3 },
  ],
  today: { changedFiles: number; addLines: number; delLines: number } = { changedFiles: 2, addLines: 60, delLines: 20 },
): RepoStatsSnapshot {
  return { root: '/tmp/repo', at: Date.parse('2026-08-04T10:00:00Z'), daily, today }
}

describe('deriveRealKline', () => {
  it('确定性：相同输入必得相同输出', () => {
    expect(deriveRealKline(stats())).toEqual(deriveRealKline(stats()))
  })

  it('每 commit 日一根，收盘=前收+净变更×刻度，无 commit 日不出现在序列（休市留空）', () => {
    const r = deriveRealKline(stats(undefined, { changedFiles: 0, addLines: 0, delLines: 0 }))
    expect(r).not.toBeNull()
    if (r === null) return
    expect(r.kline).toHaveLength(2) // 08-01、08-03；08-02 无 commit 不出现
    const [d1, d2] = r.kline
    expect(d1?.date).toBe('2026-08-01')
    expect(d1?.close).toBe(100_000 + 200 * 12)
    expect(d2?.close).toBe(d1?.close !== undefined ? d1.close + 40 * 12 : 0)
  })

  it('今日有工作区变更才追加今日 K（真实盘中），无变更则截止最后 commit 日', () => {
    const withToday = deriveRealKline(stats(undefined, { changedFiles: 2, addLines: 60, delLines: 20 }))
    expect(withToday?.kline).toHaveLength(3)
    const flat = deriveRealKline(stats(undefined, { changedFiles: 0, addLines: 0, delLines: 0 }))
    expect(flat?.kline).toHaveLength(2)
  })

  it('高≥max(开,收)、低≤min(开,收)、量=真实变更行', () => {
    const r = deriveRealKline(stats())
    if (r === null) return
    for (const c of r.kline) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.volume).toBeGreaterThan(0)
    }
  })

  it('快照缺失返回 null（留空不伪造）', () => {
    expect(deriveRealKline(undefined)).toBeNull()
    expect(deriveRealKline({ root: '/x', at: 0, daily: [], today: { changedFiles: 0, addLines: 0, delLines: 0 } })).toBeNull()
  })
})

describe('deriveMarket', () => {
  it('确定性：相同输入必得相同输出', () => {
    const a = deriveMarket(ROWS, facts(), 's2', stats())
    const b = deriveMarket(ROWS, facts(), 's2', stats())
    expect(a).toEqual(b)
  })

  it('有真实快照时 K 线/指数来自 git 聚合，source=repo-stats', () => {
    const p = deriveMarket(ROWS, facts(), 's2', stats())
    expect(p.source).toBe('repo-stats')
    expect(p.kline.length).toBeGreaterThan(0)
    expect(p.changedLines).toBe(p.kline[p.kline.length - 1]?.volume)
  })

  it('无快照时 K 线留空（source=session 兜底仅指数/五档真实会话数据）', () => {
    const p = deriveMarket(ROWS, facts())
    expect(p.kline).toHaveLength(0)
    expect(p.source).toBe('session')
    expect(p.sessionSteps).toBe(12)
  })

  it('五档按活跃度排序、最多 5 行，当前会话高亮', () => {
    const p = deriveMarket(ROWS, facts(), 's2')
    expect(p.rows).toHaveLength(2) // blank 已过滤
    const first = p.rows[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(first.title).toBe('K 线接入')
    expect(first.active).toBe(true)
  })

  it('分时逐 turn 生成且与 turnTimings 一一对应，放量 turn 为 B 侧', () => {
    const p = deriveMarket(ROWS, facts())
    expect(p.ticks).toHaveLength(3)
    expect(p.ticks.map(t => t.turn)).toEqual([1, 2, 3])
    expect(p.ticks.find(t => t.turn === 2)?.side).toBe('B')
  })
})
