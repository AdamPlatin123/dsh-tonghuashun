/**
 * 终端风格 composer 输入卡（conversation.composer.panel occupant）：皮肤激活
 * 时整体替换原生 composer（hero 与活跃会话 alike —— 输入卡包含在内）。
 * 数据全部来自运行时会话快照与输入机器（useSession/useInput 标准钩子）：
 * 草稿/相位/运行位是真实记录；发送走真实管线 —— inputActions 标准提供通道
 * （ui-conversation 的 SessionInputShell.actions）触发 adjudicate → 命令裁决
 * / 默认 sink 的完整提交事务，绝不伪造。模型徽标经注入面读取 ui-model 的
 * 会话模型目录（真实 ModelSelection）；目录未加载或服务缺位时显示占位 —。
 * 无记录一律留空/占位，不填任何模拟数据。
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation composer SlotMap merge (composer.panel).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './TerminalInput.module.css'

/** 会话真实模型选择（与 ui-model 的 ModelSelection 同形；结构收窄，零值依赖）。 */
export interface ModelSelectionLike {
  readonly provider: string
  readonly model: string
}

/** 模型目录订阅源（ui-model ModelService 目录 store 的瘦面；无源时快照恒 null）。 */
export interface ModelSource {
  getSnapshot(): ModelSelectionLike | null
  subscribe(fn: () => void): () => void
}

/** 注入面：真实模型目录源与刷新动作（index.ts 经 ctx 动态解析 ui-model 服务）。 */
export interface TerminalInputInjected {
  /** 解析某会话的模型目录源；ui-model 服务缺位时返回 undefined（徽标占位）。 */
  modelSource: (sessionId: SessionId) => ModelSource | undefined
  /** 触发模型目录刷新（fire-and-forget；错误落在目录 store 上，不上抛）。 */
  loadModel: (sessionId: SessionId) => void
}

/** Full props of the terminal composer occupant. */
export type TerminalInputProps = PropsRuntime<'conversation.composer.panel'> & TerminalInputInjected

const noopSubscribe = (): (() => void) => () => {}

/**
 * 订阅会话模型目录源（uSES 绑定；源缺位时快照恒为 null 且从不通知）。
 * @param source - 注入面解析出的目录源（undefined = 服务缺位）。
 * @returns 当前模型选择（null = 未加载/无选择）。
 */
function useModel(source: ModelSource | undefined): ModelSelectionLike | null {
  const subscribe = useCallback(
    (fn: () => void) => source?.subscribe(fn) ?? noopSubscribe,
    [source],
  )
  const getSnapshot = useCallback(
    () => source?.getSnapshot() ?? null,
    [source],
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * 渲染终端风格 composer 输入卡。
 * @param props - 插槽标准套件（会话快照 + 输入机器 + 发送动作）与注入面。
 * @returns 输入卡元素树。
 */
/* oxlint-disable typescript/no-unnecessary-condition -- 运行时防御：inputActions 在
 * 类型上必填，但热卸载/竞态下可能缺位；此处显式兜底避免空指针。 */
export function TerminalInput({
  sessionId, useSession, useSessions, useInput, inputActions, modelSource, loadModel,
}: TerminalInputProps) {
  const input = useInput(s => s)
  const composerPhase = useSession(s => s.composerPhase)
  const removed = useSession(s => s.removed)
  const summaryBlank = useSessions(s => s.byId[sessionId]?.blank)

  // 源按会话缓存（注入面解析出的包装对象保持同一身份，uSES 不重订阅）。
  const source = useMemo(() => modelSource(sessionId), [modelSource, sessionId])
  const model = useModel(source)
  // 本卡替换了原生 composer（原生模型座不再挂载），目录的挂载刷新由本卡承担。
  useEffect(() => { loadModel(sessionId) }, [loadModel, sessionId])

  const draft = input.draft
  const empty = draft.trim() === ''
  const machineBusy = input.phase === 'adjudicating' || input.phase === 'submitting'
  // 占位禁用态：空白会话（hero 态）、会话被移除、或输入机器缺位（防御 ——
  // session-scope 渲染器保证本卡只在会话存在时挂载）。
  const hero = composerPhase === 'blank' || summaryBlank
  const locked = removed || hero || inputActions == null
  const canSend = !empty && !locked && !machineBusy

  // IME 守卫：组合态 Enter 选中候选，不得发送；Safari 在 compositionend
  // 之后才投递关闭 keydown，清除延迟一帧（与原生 InputBar 同规则）。
  const composingRef = useRef(false)
  const onCompositionStart = (): void => { composingRef.current = true }
  const onCompositionEnd = (): void => {
    setTimeout(() => { composingRef.current = false }, 10)
  }
  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    if (machineBusy || inputActions == null) return // 提交中只读，不接收编辑
    inputActions.setDraft(e.target.value)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey) return // Shift+Enter 原生换行，无条件
    if (composingRef.current) return
    e.preventDefault()
    if (e.repeat) return // 按住 Enter 不连发
    if (canSend) inputActions.submit()
  }
  const onSend = (): void => {
    if (canSend) inputActions.submit()
  }

  const modelLabel = model === null ? '—' : model.model

  return (
    <div
      className={css.card}
      data-dsh-source="conversation.composer.panel"
      data-phase={hero ? 'hero' : 'active'}
    >
      <div className={css.box}>
        <textarea
          className={css.input}
          value={draft}
          rows={2}
          disabled={locked}
          readOnly={machineBusy}
          placeholder={hero ? '暂无会话 · 请从侧栏选择或新建会话' : '给智能体发消息'}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          aria-label="给智能体发消息"
        />
        <div className={css.row}>
          <span className={css.grow} />
          <span
            className={css.model}
            title={model === null ? '模型目录未加载' : `模型：${model.provider}/${model.model}`}
          >
            {modelLabel}
          </span>
          <button
            type="button"
            className={css.send}
            disabled={!canSend}
            onClick={onSend}
            aria-label="发送消息"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3l16 9-16 9v-7l9-2-9-2V3z" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
