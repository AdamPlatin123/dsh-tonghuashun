/**
 * 输入 dock 终端状态条（conversation.input.dock list 条目，order 0）：在
 * 输入区上方以终端风格展示当前会话的真实运行统计 —— 会话节点数、turn 数、
 * 运行中调用数与 assistant 节点真实 token 汇总。全部数字来自运行时快照
 * （useSession 的 ConversationSnapshot 派生投影），缺失的真实记录一律留空
 * （显示占位符 —），不填任何模拟数据。
 */
import clsx from 'clsx'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fmt } from './market-fmt.ts'
import css from './InputDockStrip.module.css'

/** Full props of the input-dock strip entry (session-scope list slot). */
export type InputDockStripProps = PropsRuntime<'conversation.input.dock'>

/** 状态点语义：红涨绿跌（THS 皮肤 success=红/涨、error=绿/跌），待处理为警示黄。 */
type StripStatus = 'running' | 'pending' | 'idle'

/** 状态中文名（与现有行情组件一致，界面文案直接采用中文）。 */
const STATUS_LABEL: Record<StripStatus, string> = {
  running: '运行中',
  pending: '待处理',
  idle: '就绪',
}

/** Token usage 的未知形状收窄（与 MarketView 的 requestUsage 同一模式）。 */
interface UsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
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

/** 由真实会话标志派生状态点。 */
function statusOf(running: boolean, runningCalls: number, pending: number): StripStatus {
  if (running || runningCalls > 0) return 'running'
  if (pending > 0) return 'pending'
  return 'idle'
}

/**
 * 渲染输入 dock 终端状态条。
 * @param props - 插槽 props（标准 session kit）。
 * @returns 状态条元素树。
 */
export function InputDockStrip({ useSession }: InputDockStripProps) {
  const session = useSession(s => s)
  const nodeCount = session.nodes.length
  const turnCount = session.turnTimings.size
  const runningCalls = session.runningCalls.length
  const pendingCalls = session.pending.length
  const tokenTotal = sessionTokenTotal(session.nodes)
  const status = statusOf(session.running, runningCalls, pendingCalls)

  return (
    <div className={css.root} data-input-dock-strip aria-label="会话运行统计">
      <span className={css.status}>
        <i className={clsx(css.dot, css[status])} aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>
      <i className={css.sep} aria-hidden="true" />
      <div className={css.stats}>
        <span className={css.stat}>
          <span className={css.k}>节点</span>
          <span className={css.v}>{fmt(nodeCount)}</span>
        </span>
        <span className={css.stat}>
          <span className={css.k}>Turn</span>
          <span className={css.v}>{fmt(turnCount)}</span>
        </span>
        <span className={css.stat}>
          <span className={css.k}>调用中</span>
          <span className={css.v}>{fmt(runningCalls)}</span>
        </span>
        <span className={css.stat}>
          <span className={css.k}>Token</span>
          <span className={clsx(css.v, tokenTotal === '' && css.empty)}>
            {tokenTotal === '' ? '—' : tokenTotal}
          </span>
        </span>
      </div>
      <span className={css.grow} />
      <span className={css.local}>LOCAL PROJECTION</span>
    </div>
  )
}
