/**
 * 输入框左右终端控件（conversation.input.left / conversation.input.right
 * occupants）：左侧紧凑"行情"按钮（点击经注入面打开右侧详情列）加
 * Terminal 徽标；右侧实时终端状态标记。数据全部来自运行时会话快照
 * （useSessions 标准钩子）——会话数与运行中数为真实记录，不伪造。
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the two conversation input SlotMap rows (declared by the
// owning package) into the program so the register calls type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './InputControls.module.css'

/** 注入面：行情按钮的打开详情回调。 */
export interface InputControlsInjected {
  /** 打开右侧详情列（显示行情面板）。 */
  openDetails: () => void
}

/** Full props of the left input control occupant. */
export type InputLeftProps = PropsRuntime<'conversation.input.left'>
  & InputControlsInjected & PropsLocale<'settings.skins'>

/** Full props of the right input control occupant. */
export type InputRightProps = PropsRuntime<'conversation.input.right'> & PropsLocale<'settings.skins'>

/**
 * 渲染输入框左侧终端控件（行情入口按钮 + Terminal 徽标）。
 * @param props - 插槽 props 与注入面。
 * @returns 左侧控件元素。
 */
export function InputLeft({ openDetails }: InputLeftProps) {
  return (
    <div className={css.left} data-dsh-source="conversation.input.left" aria-label="行情入口">
      <button type="button" className={css.market} onClick={openDetails}>行情</button>
      <span className={css.term}>Terminal</span>
    </div>
  )
}

/**
 * 渲染输入框右侧终端状态标记（真实会话数 / 运行中数）。
 * @param props - 插槽 props（标准会话快照钩子）。
 * @returns 右侧状态元素。
 */
export function InputRight({ useSessions }: InputRightProps) {
  const sessions = useSessions(s => s)
  const rows = Object.values(sessions.byId)
  const total = rows.filter(r => !r.blank).length
  const running = rows.filter(r => r.running).length

  return (
    <div className={css.right} data-dsh-source="conversation.input.right" aria-label="终端状态">
      <span className={css.stat}>Sessions <b>{total}</b></span>
      <span className={css.stat}>Running <b className={css.up}>{running}</b></span>
    </div>
  )
}
