/**
 * 右侧详情列行情面板（conversation.details.panel occupant）：DS 指数炒股
 * 界面 —— 指数卡、五档（真实会话映射）、分时（真实 turn 事件）。全部内容
 * 来自运行时会话的派生投影并标注 LOCAL PROJECTION。
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketDetailsInjected } from './index.ts'
import { deriveMarket } from './market-data.ts'

import { fmt } from './market-fmt.ts'
import css from './MarketDetails.module.css'

/** Full props of the details-panel occupant. */
export type MarketDetailsProps = PropsRuntime<'conversation.details.panel'>
  & PropsLocale<'ui-market'> & MarketDetailsInjected

// 皮肤会话内的一次性标记：详情面板只在首次挂载时自动展开一次（对齐 demopage
// 右侧常显），之后用户的手动关闭/打开不被覆盖，跨会话重挂载也不重复顶开。
let detailsAutoOpened = false


const TABS = ['五档', '变更明细', 'Token 流'] as const
type Tab = typeof TABS[number]

/**
 * 渲染 DS 指数详情面板。
 * @param props - 插槽 props。
 * @returns 面板元素树。
 */
export function MarketDetails({ useSession, sessionId, useSessions, repoStats, openDetails, t }: MarketDetailsProps) {
  const [tab, setTab] = useState<Tab>('五档')
  // AppFrame 首次 render 时 root 的 attachPanels 已执行，这里 openDetails 安全。
  useEffect(() => {
    if (detailsAutoOpened) return
    detailsAutoOpened = true
    openDetails()
  }, [openDetails])
  const sessions = useSessions(s => s)
  const session = useSession(s => s)
  const subscribe = (fn: () => void): (() => void) => repoStats.subscribe(fn)
  const stats = useSyncExternalStore(subscribe, () => repoStats.getSnapshot().snapshot)
  const projection = deriveMarket(
    Object.values(sessions.byId).map(row => ({
      id: row.id,
      displayTitle: row.displayTitle,
      updatedAt: row.updatedAt,
      running: row.running,
      blank: row.blank,
    })),
    {
      nodeCount: session.nodes.length,
      turnTimings: session.turnTimings,
      runningCalls: session.runningCalls.length,
    },
    sessionId,
    stats,
  )
  const up = projection.delta >= 0
  const [high, open, low, prevClose] = [projection.high, projection.open, projection.low, projection.prevClose]
  const changed = projection.changedLines

  return (
    <div className={css.root} data-screen-label="market-details" aria-label={t('details.label')}>
      <div className={css.qHead}>
        <div className={css.qTitle}>
          <span className={css.nm}>DS 运行指数</span><span className={css.cd}>DSH001</span><span className={css.pin}>LOCAL</span>
        </div>
        <div className={clsx(css.qPrice, !up && css.down)}>
          <span className={css.big}>{fmt(projection.indexValue)}</span>
          <span className={css.delta}>
            <span>{up ? '+' : ''}{fmt(projection.delta)}</span>
            <span>{up ? '+' : ''}{projection.deltaPct}%</span>
          </span>
        </div>
        <div className={css.qTags}>
          <span className={css.tagHot}>{t('common.demo')}</span>
          <span className={css.tag}>{t('common.projection')}</span>
          <span className={css.sector}>{t('details.codeVolume')}</span>
        </div>
      </div>
      <div className={css.qGrid}>
        <div className={css.cell}><span className={css.k}>{t('details.high')}</span><span className={clsx(css.v, css.up)}>{fmt(high)}</span></div>
        <div className={css.cell}><span className={css.k}>{t('details.open')}</span><span className={clsx(css.v, !up && css.down)}>{fmt(open)}</span></div>
        <div className={css.cell}><span className={css.k}>{t('details.low')}</span><span className={clsx(css.v, css.down)}>{fmt(low)}</span></div>
        <div className={css.cell}><span className={css.k}>{t('details.prevClose')}</span><span className={css.v}>{fmt(prevClose)}</span></div>
        <div className={css.cell}><span className={css.k}>{t('details.changedLines')}</span><span className={css.v}>{fmt(changed)}</span></div>
        <div className={css.cell}><span className={css.k}>{t('details.sessionSteps')}</span><span className={css.v}>{fmt(projection.sessionSteps)}</span></div>
      </div>
      <div className={css.tabs} role="tablist" aria-label={t('details.tabs')}>
        {TABS.map(name => (
          <button
            key={name} type="button" role="tab" aria-selected={tab === name} aria-pressed={tab === name}
            className={clsx(css.tab, tab === name && css.active)} onClick={() => { setTab(name) }}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === '五档' && (
        <div className={css.book} role="table" aria-label={t('details.book')}>
          {projection.rows.map((row, index) => {
            const maxValue = Math.max(1, ...projection.rows.map(r => r.value))
            const depth = (row.value / maxValue) * 100
            return (
              <div key={row.title} className={clsx(css.row, index < 3 ? css.sell : css.buy, row.active && css.activeRow)} role="row">
                <i className={css.bar} style={{ width: `${depth}%` }} aria-hidden="true" />
                <span className={css.lv}>{row.active ? '当前' : index < 3 ? `卖${5 - index}` : `买${index - 2}`}</span>
                <span className={css.title} title={row.title}>{row.title}</span>
                <span className={css.pr}>{fmt(row.value)}</span>
                <span className={clsx(css.qt, row.delta >= 0 ? css.up : css.down)}>{row.delta >= 0 ? '+' : ''}{fmt(row.delta)}</span>
              </div>
            )
          })}
        </div>
      )}
      {tab === '变更明细' && (
        <div className={css.tape}>
          <div className={css.tapeHead}>{t('details.tape')}</div>
          <div className={css.tapeCols}><span>Turn</span><span>{t('details.index')}</span><span>{t('details.lines')}</span><span></span></div>
          {projection.ticks.length === 0
            ? <div className={css.empty}>{t('details.noTicks')}</div>
            : projection.ticks.map(tick => (
              <div key={tick.turn} className={css.tapeRow}>
                <span className={css.tm}>{tick.time}</span>
                <span className={clsx(css.pr, tick.side === 'B' ? css.up : css.down)}>{fmt(tick.value)}</span>
                <span className={css.qt}>{fmt(tick.lines)}</span>
                <span className={clsx(css.bs, tick.side === 'B' ? css.up : css.down)}>{tick.side}</span>
              </div>
            ))}
        </div>
      )}
      {tab === 'Token 流' && (
        <div className={css.tape}>
          <div className={css.tapeHead}>{t('details.tokenFlow')}</div>
          <div className={css.tapeCols}><span>Turn</span><span>{t('details.tokens')}</span><span>{t('details.ms')}</span><span></span></div>
          {projection.ticks.length === 0
            ? <div className={css.empty}>{t('details.noTicks')}</div>
            : projection.ticks.map(tick => (
              <div key={tick.turn} className={css.tapeRow}>
                <span className={css.tm}>{tick.time}</span>
                <span className={css.pr}>{fmt(tick.value % 10_000)}</span>
                <span className={css.qt}>{tick.lines * 8}</span>
                <span className={clsx(css.bs, tick.side === 'B' ? css.up : css.down)}>{tick.side}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
