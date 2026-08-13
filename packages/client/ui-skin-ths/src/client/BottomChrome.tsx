/**
 * 底部状态条（layout.chrome.bottom occupant）：设计稿状态条的真实对齐。
 * 数据来自运行时会话快照与本地时钟。
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ChromeBar.module.css'

/** Full props of the bottom chrome occupant. */
export type BottomChromeProps = PropsRuntime<'layout.chrome.bottom'> & PropsLocale<'settings.skins'>

function clock(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 渲染底部状态条。
 * @param props - 插槽 props。
 * @returns 状态条元素。
 */
export function BottomChrome({ useSessions, useWorkspaces }: BottomChromeProps) {
  const sessions = useSessions(s => s)
  const workspaces = useWorkspaces(s => s)
  const [now, setNow] = useState(clock)
  useEffect(() => {
    const timer = setInterval(() => { setNow(clock()) }, 1000)
    return () => { clearInterval(timer) }
  }, [])
  const rows = Object.values(sessions.byId)
  const total = rows.filter(r => !r.blank).length
  const running = rows.filter(r => r.running).length

  return (
    <footer className={css.statusbar} data-dsh-source="layout.chrome.bottom" aria-label="运行状态" aria-live="polite">
      <span className={css.grp}>DSH <b>{total}</b></span>
      <span className={css.grp}>Session <b>{total}</b></span>
      <span className={css.grp}>Running <b className={css.up}>{running}</b></span>
      <span className={css.grp}>Workspaces <b>{workspaces.items.length}</b></span>
      <span className={css.grow} />
      <span className={css.grp}>{now}</span>
      <span className={css.conn}><i className={css.pulse} aria-hidden="true" />Web 已连接 · ths-market ready</span>
    </footer>
  )
}
