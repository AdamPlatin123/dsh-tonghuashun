/**
 * 终端风格侧栏（sidebar.panel occupant）：设计稿侧栏视觉的真实对齐。
 * 数据全部来自运行时会话/工作区快照（useSessions/useWorkspaces 标准钩子），
 * 行为经注入面（startSession/toggleSidebar/openSession）走真实服务。
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar takeover SlotMap merge (sidebar.panel).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionId, SessionSummary, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { useState } from 'react'
import css from './TerminalSidebar.module.css'

/** Injected business face: real sidebar actions. */
export interface TerminalSidebarInjected {
  /** Start a New Session through the workspace service. */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
  /** Open an existing session. */
  openSession: (id: SessionId) => void
  /** Open the settings panel through the settings service. */
  openSettings: () => void
}

/** Full props of the terminal sidebar occupant. */
export type TerminalSidebarProps = PropsRuntime<'sidebar.panel'>
  & TerminalSidebarInjected & PropsLocale<'settings.skins'>

/**
 * 渲染终端风格侧栏：运行中会话置顶（真实 running 位，每组含 Ungrouped），
 * 折叠/展开时宽度随宿主列宽过渡、宽内容与窄栏交叉淡入淡出。
 * @param props - 插槽 props 与注入面。
 * @returns 侧栏元素树。
 */
export function TerminalSidebar({
  collapsed, width,
  useSessions, useWorkspaces,
  startSession, toggleSidebar, openSession, openSettings,
}: TerminalSidebarProps) {
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()
  const match = (title: string): boolean => query.length === 0 || title.toLowerCase().includes(query)
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s)
  const byId = sessions.byId
  /** 会话排序：运行中（真实 running 位）置顶，同级按最近更新（真实 updatedAt）降序。 */
  const byRecent = (a: SessionSummary, b: SessionSummary): number =>
    Number(b.running) - Number(a.running) || b.updatedAt - a.updatedAt
  const groups = workspaces.items.map(ws => ({
    id: ws.workspaceId,
    title: ws.title,
    sessions: ws.sessionIds
      .map(id => byId[id])
      .filter((row): row is SessionSummary => row !== undefined && !row.blank && match(row.displayTitle))
      .sort(byRecent),
  })).filter(g => g.sessions.length > 0)
  const ungrouped = Object.values(byId).filter((row): row is SessionSummary => !row.blank
    && !workspaces.items.some(ws => ws.sessionIds.includes(row.id))
    && match(row.displayTitle))
    .sort(byRecent)

  return (
    <aside
      className={css.root}
      data-dsh-source="sidebar.panel"
      data-collapsed={collapsed || undefined}
      style={{ width }}
      aria-label={collapsed ? '终端侧栏（折叠）' : '终端侧栏'}
    >
      {/* 折叠窄栏：与宽内容交叉淡入淡出（CSS transition，见 .rail/.wide）。 */}
      <div className={css.rail} aria-hidden={collapsed ? undefined : true}>
        <button type="button" className={css.railBtn} aria-label="展开侧栏" onClick={() => { toggleSidebar() }}>
          <span className={css.railGlyph}>≡</span>
        </button>
        <button type="button" className={css.railBtn} aria-label="新会话" onClick={() => { startSession() }}>
          <span className={css.railGlyph}>+</span>
        </button>
      </div>
      <div className={css.wide} aria-hidden={collapsed || undefined}>
        <div className={css.brandRow}>
          <span className={css.logoMark} aria-hidden="true">DS</span>
          <span className={css.t1}>DeepSeek Harness <small>THS MARKET SKIN</small></span>
          <button type="button" className={css.collapse} aria-label="折叠侧栏" onClick={() => { toggleSidebar() }}>
            ⟨
          </button>
        </div>
        <button type="button" className={css.newSession} aria-label="新会话" onClick={() => { startSession() }}>
          <span className={css.plus}>+</span>New Session
        </button>
        <div className={css.toolsRow}>
          <span className={css.watchHead}>Workspaces</span>
        </div>
        <label className={css.searchRow}>
          <input
            type="text"
            className={css.search}
            value={filter}
            onChange={(e) => { setFilter(e.target.value) }}
            placeholder="搜索会话…"
            aria-label="搜索会话"
            data-ths-session-search
            spellCheck={false}
          />
        </label>
        <div className={css.workspaces} role="tree" aria-label="工作区与会话">
          {groups.map(group => (
            <div key={group.id} className={css.group}>
              <div className={css.groupHead}>
                <span className={css.folder}>▣</span><span className={css.groupTitle}>{group.title}</span>
                <span className={css.count}>{group.sessions.length}</span>
              </div>
              {group.sessions.map(row => (
                <button
                  key={row.id} type="button" className={css.session}
                  data-active={sessions.current === row.id || undefined}
                  data-running={row.running || undefined}
                  onClick={() => { openSession(row.id) }}
                  title={row.displayTitle}
                >
                  <span className={css.branch} aria-hidden="true">└</span>
                  <span className={css.state} data-running={row.running || undefined} />
                  <span className={css.sessionTitle}>{row.displayTitle}</span>
                  <span className={css.updated}>{ago(row.updatedAt)}</span>
                </button>
              ))}
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className={css.group}>
              <div className={css.groupHead}>
                <span className={css.folder}>▣</span><span className={css.groupTitle}>Ungrouped</span>
                <span className={css.count}>{ungrouped.length}</span>
              </div>
              {ungrouped.map(row => (
                <button
                  key={row.id} type="button" className={css.session}
                  data-active={sessions.current === row.id || undefined}
                  data-running={row.running || undefined}
                  onClick={() => { openSession(row.id) }}
                  title={row.displayTitle}
                >
                  <span className={css.branch} aria-hidden="true">└</span>
                  <span className={css.state} data-running={row.running || undefined} />
                  <span className={css.sessionTitle}>{row.displayTitle}</span>
                  <span className={css.updated}>{ago(row.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
          {query.length > 0 && groups.length === 0 && ungrouped.length === 0 && (
            <div className={css.empty} role="status">无匹配</div>
          )}
        </div>
        <div className={css.plugin} data-owner="ths-market">
          <i className={css.pulse} aria-hidden="true" />THS Market Connected
        </div>
        <button type="button" className={css.settingsBtn} aria-label="设置" onClick={() => { openSettings() }}>Settings</button>
      </div>
    </aside>
  )
}

/** 相对时间（真实 updatedAt → 显示标签）。 */
function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
