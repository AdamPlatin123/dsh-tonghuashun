/**
 * 顶部行情条（layout.chrome.top occupant）：设计稿红色行情条的真实对齐。
 * 数据全部来自运行时会话快照（useSessions/useWorkspaces 标准钩子）——
 * 会话数、运行中会话、工作区数；不伪造行情数字。涨跌 chg 无真实数据来源，
 * 按契约省略该元素。demopage 的 top-icon 运行状态按钮无真实功能，同样省略。
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ChromeBar.module.css'

/** Full props of the top chrome occupant. */
export type TopChromeProps = PropsRuntime<'layout.chrome.top'> & PropsLocale<'settings.skins'>

/**
 * 渲染顶部行情条。
 * @param props - 插槽 props。
 * @returns 行情条元素。
 */
export function TopChrome({ useSessions, useWorkspaces }: TopChromeProps) {
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s)
  const rows = Object.values(sessions.byId)
  const total = rows.filter(r => !r.blank).length
  const running = rows.filter(r => r.running).length
  const wsCount = workspaces.items.length

  return (
    <header className={css.topbar} data-dsh-source="layout.chrome.top" aria-label="DSH 运行概览">
      <div className={css.brand}>
        <span className={css.logoDot} aria-hidden="true">DS</span>
        <span className={css.brandName}>DeepSeek Harness</span>
        <span className={css.skinBadge}>THS MARKET SKIN</span>
        <span className={css.sub}>LOCAL PROJECTION</span>
      </div>
      <div className={css.topIndices} aria-label="本地会话概览">
        <div className={css.idx}>
          <span className={css.nm}>会话数</span>
          <span className={css.vl}>{total}</span>
        </div>
        <div className={css.idx}>
          <span className={css.nm}>运行中</span>
          <span className={css.vl}>{running}</span>
        </div>
        <div className={css.idx}>
          <span className={css.nm}>工作区</span>
          <span className={css.vl}>{wsCount}</span>
        </div>
      </div>
      <span className={css.spacer} />
      <button
        type="button"
        className={css.topSearch}
        aria-label="搜索会话"
        onClick={() => { document.querySelector<HTMLInputElement>('[data-ths-session-search]')?.focus() }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span>搜索会话</span>
      </button>
      <div className={css.topActions}>
        <span className={css.feedState}><i className={css.feedDot} aria-hidden="true" />DEMO FEED</span>
      </div>
    </header>
  )
}
