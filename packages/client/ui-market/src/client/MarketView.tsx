/**
 * 行情投影视图页签（conversation.view occupant）：终端大盘视图。会话数、
 * 运行状态、turn 统计与 Token 投影全部来自真实会话运行时 ——
 * useSessions/useSession 快照与宿主计算的 tokenUsage 投影；缺失的真实
 * 记录一律留空（显示占位符 —），不填任何模拟数据。
 */
import clsx from 'clsx'
import type { ConversationNode, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fmt } from './market-fmt.ts'
import css from './MarketView.module.css'

/** Full props of the conversation-view occupant. */
export type MarketViewProps = PropsRuntime<'conversation.view'> & PropsLocale<'ui-market'>

/** 会话行状态（真实运行时标志的投影面）。 */
type RowStatus = 'running' | 'pending' | 'completed' | 'blank' | 'idle'

/** 状态中文名（与现有行情组件一致，界面文案直接采用中文）。 */
const STATUS_LABEL: Record<RowStatus, string> = {
  running: '运行中',
  pending: '待交互',
  completed: '完成',
  blank: '空会话',
  idle: '就绪',
}

/** Token usage 的未知形状收窄（与 ui-trajectory 的 requestUsage 同一模式）。 */
interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** 把一段未知 usage 合计为 token 总数；无记录返回空串。 */
function usageTotal(value: unknown): string {
  const usage = value as UsageLike | undefined
  if (usage === undefined) return ''
  const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    + (usage.reasoningTokens ?? 0)
  return total > 0 ? fmt(total) : ''
}

/** 当前会话真实 Token 投影：汇总 assistant 节点的 provider usage（无记录留空）。 */
function sessionTokenTotal(nodes: readonly ConversationNode[]): string {
  let total = 0
  for (const node of nodes) {
    if (node.kind !== 'assistant' || node.usage === undefined) continue
    const usage = node.usage as UsageLike | undefined
    if (usage === undefined) continue
    total += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      + (usage.reasoningTokens ?? 0)
  }
  return total > 0 ? fmt(total) : ''
}

/** 会话行 Token 投影：宿主 projectionValues 携带 tokenUsage 时读取，缺失留空。 */
function rowTokenTotal(row: SessionSummary): string {
  const values = row.projectionValues as Readonly<Record<string, unknown>> | undefined
  return usageTotal(values?.tokenUsage)
}

/** 由真实会话标志派生行状态。 */
function statusOf(row: SessionSummary): RowStatus {
  if (row.running) return 'running'
  if (row.pendingInteraction !== undefined) return 'pending'
  if (row.completed) return 'completed'
  if (row.blank) return 'blank'
  return 'idle'
}

/** 会话最近活动时间（HH:MM:SS）；无真实时间戳（如子代理合成行）返回空串。 */
function fmtActivity(updatedAt: number): string {
  if (updatedAt <= 0) return ''
  const d = new Date(updatedAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * 渲染行情投影视图页签。
 * @param props - 插槽 props（标准运行时 kit + ui-market locale）。
 * @returns 视图元素树。
 */
export function MarketView({ useSession, sessionId, useSessions, t }: MarketViewProps) {
  const sessions = useSessions(s => s)
  const session = useSession(s => s)

  const rows = sessions.ids
    .map(id => sessions.byId[id])
    .filter((row): row is SessionSummary => row !== undefined)
  const runningCount = rows.reduce((n, row) => n + (row.running ? 1 : 0), 0)
  const pendingCount = rows.reduce((n, row) => n + (row.pendingInteraction !== undefined ? 1 : 0), 0)
  const completedCount = rows.reduce((n, row) => n + (row.completed ? 1 : 0), 0)

  const nodeCount = session.nodes.length
  const turnCount = session.turnTimings.size
  const runningCalls = session.runningCalls.length
  const pendingCalls = session.pending.length
  const currentTokens = sessionTokenTotal(session.nodes)

  return (
    <section className={css.root} data-screen-label="market-view" aria-label={t('view.label')}>
      <div className={css.head}>
        <span className={css.brand}><i className={css.dot} aria-hidden="true" />DS 行情投影</span>
        <span className={css.local}>{t('common.local')}</span>
        <span className={css.grow} />
      </div>

      <div className={css.stats} role="list" aria-label="大盘统计">
        <div className={css.stat} role="listitem">
          <span className={css.k}>{t('view.sessions')}</span>
          <span className={css.v}>{fmt(rows.length)}</span>
        </div>
        <div className={css.stat} role="listitem">
          <span className={css.k}>{t('view.running')}</span>
          <span className={clsx(css.v, runningCount > 0 && css.up)}>{fmt(runningCount)}</span>
        </div>
        <div className={css.stat} role="listitem">
          <span className={css.k}>{t('view.turns')}</span>
          <span className={css.v}>{fmt(turnCount)}</span>
        </div>
        <div className={css.stat} role="listitem">
          <span className={css.k}>{t('view.tokens')}</span>
          <span className={clsx(css.v, currentTokens === '' && css.empty)}>{currentTokens === '' ? '—' : currentTokens}</span>
        </div>
      </div>

      <div className={css.detail}>
        <span>节点 {fmt(nodeCount)}</span>
        <span>调用中 {fmt(runningCalls)}</span>
        <span>待处理 {fmt(pendingCalls)}</span>
        <span>完成 {fmt(completedCount)}</span>
        <span>待交互 {fmt(pendingCount)}</span>
      </div>

      <div className={css.tableWrap}>
        <table className={css.table}>
          <caption className={css.caption}>会话活动</caption>
          <thead>
            <tr>
              <th className={css.th} scope="col">{t('view.table.session')}</th>
              <th className={css.th} scope="col">{t('view.table.status')}</th>
              <th className={css.th} scope="col">{t('view.table.updated')}</th>
              <th className={css.th} scope="col">{t('view.table.tokens')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = statusOf(row)
              return (
                <tr key={row.id} className={clsx(css.tr, row.id === sessionId && css.active)}>
                  <td className={clsx(css.td, css.title)} title={row.displayTitle}>{row.displayTitle}</td>
                  <td className={css.td}>
                    <span className={clsx(css.status, css[status])}>
                      <i className={css.dot} aria-hidden="true" />
                      {STATUS_LABEL[status]}
                    </span>
                  </td>
                  <td className={clsx(css.td, css.time)}>{fmtActivity(row.updatedAt) || '—'}</td>
                  <td className={clsx(css.td, css.time)}>{rowTokenTotal(row) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
