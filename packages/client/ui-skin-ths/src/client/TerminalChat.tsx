/**
 * 终端风格消息流（conversation.chat.panel occupant）：替换原生消息流表面，对齐
 * demopage 的气泡式 chat-flow —— user/steering 右对齐气泡（meta: YOU + 时间），
 * assistant 左对齐消息块（meta: DEEPSEEK + 时间；正文含文本、思考披露、工具步骤
 * 行；末尾 Ran for / TTFT / tok/s 推理统计由节点 timing/usage 真实推导，缺记录的
 * 部分省略，不伪造）。context 注入、工具结果、命令、错误/重试/压缩渲染为对齐
 * demopage 的步骤行（时间 + 类型标签 + 摘要 + 状态；红涨绿跌：成功为红、失败为
 * 绿）。进行中的 assistant（partial）实时呈现。空日志显示空态提示，不伪造任何
 * 内容。流内跟随滚动：钉在底部时新内容自动到底，读者上翻后停止跟随。
 *
 * 本 occupant 不渲染自有顶栏 —— 会话标题/操作由 conversation.session.header
 * 承担（demopage 的 chat-panel 同样直接是 chat-flow）。
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat-panel takeover SlotMap row (declared by the
// owning package) into the program so the register calls type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AssistantBlock, AssistantMessageNode, ConversationNode, UnknownSurfaceNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { toAssistantBlocks } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useMemo, useRef, useState } from 'react'
import css from './TerminalChat.module.css'

/** Full props of the terminal message-flow occupant. */
export type TerminalChatProps = PropsRuntime<'conversation.chat.panel'> & PropsLocale<'settings.skins'>

/** Context 注入折叠阈值：超过该字符数则主流折叠为一行摘要。 */
const CONTEXT_SUMMARY_CHARS = 160

/**
 * 渲染终端风格消息流：可滚动气泡流。
 * @param props - 插槽 props（标准会话快照钩子）与文案座位。
 * @returns 消息流元素树。
 */
export function TerminalChat({ useSession, t }: TerminalChatProps) {
  const nodes = useSession(s => s.nodes)
  const partial = useSession(s => s.partial)
  const runningCalls = useSession(s => s.runningCalls)
  // 运行中工具调用按 callId 去重：assistant 块里的 tool-call 与 runningCalls
  // 短暂重叠时只呈现一行（结果落地后由 tool-result 行接替）。
  const runningCallIds = useMemo(
    () => new Set(runningCalls.map(call => call.callId)),
    [runningCalls],
  )
  // 已落地工具结果按 callId 去重：assistant 块里的 tool-call 与 tool-result 行
  // 同指一次调用，结果行落地后省略块内的待结果行，避免双行。
  const hiddenCallIds = useMemo(() => {
    const set = new Set(runningCallIds)
    for (const node of nodes) if (node.kind === 'tool-result') set.add(node.callId)
    return set
  }, [nodes, runningCallIds])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  const [pinned, setPinned] = useState(true)

  // 空态：无任何真实记录（节点为空、无运行中工具调用、无进行中 assistant ——
  // 后两者是流的实时部分，有它就不算空）。
  const empty = nodes.length === 0 && runningCalls.length === 0 && partial === null

  // 滚动容器解析：外层 `[data-conversation-scroll]`（活跃会话列）拥有唯一
  // 滚动轴时用它，否则回退到内部 `.scroll`（独立挂载/单测）。与原生
  // ChatView 的 scrollerOf 同契约。
  const scroller = (): HTMLElement | null => {
    const local = scrollRef.current
    if (local === null) return null
    return local.closest<HTMLElement>('[data-conversation-scroll]') ?? local
  }

  const onScroll = (): void => {
    const el = scroller()
    if (el === null) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 4
    pinnedRef.current = atBottom
    setPinned(atBottom)
  }

  const jumpToBottom = (): void => {
    const el = scroller()
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }

  // 钉在底部时跟随新内容；读者上翻后停止跟随（保持阅读位置）。
  useEffect(() => {
    const el = scroller()
    if (el === null || !pinnedRef.current) return
    el.scrollTop = el.scrollHeight
  })

  // 滚动事件必须绑在解析出的滚动容器上：外层滚动时内部 `.scroll` 自身
  // 不再滚动，React 的 onScroll 属性不会触发。与 ChatView 一致用原生
  // 监听 + 解析后的容器。
  useEffect(() => {
    const local = scrollRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the node commits. */
    if (local === null) return
    const el = scroller()
    if (el === null) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll) }
  }, [])

  return (
    <div className={css.root} data-dsh-source="conversation.chat.panel" aria-label="终端消息流">
      <div className={css.scrollWrap}>
        <div ref={scrollRef} className={css.scroll}>
          {empty ? (
            <div className={css.empty} role="status">
              <span className={css.prompt} aria-hidden="true">❯</span> {t('chat.empty')}
            </div>
          ) : (
            <div className={css.chatFlow}>
              {nodes.map(node => (
                <MessageRow key={node.seq} node={node} hiddenCallIds={hiddenCallIds} />
              ))}
              {partial !== null && (
                <article className={css.message} data-kind="assistant" data-live="true">
                  <div className={css.messageMeta}>
                    <span className={css.messageRole}>DEEPSEEK</span>
                    <span className={css.liveDot} aria-hidden="true" />
                  </div>
                  {partial.blocks.map((block, i) => (
                    <AssistantBlockRow key={i} block={block} hiddenCallIds={hiddenCallIds} />
                  ))}
                </article>
              )}
              {runningCalls.map(call => (
                <ToolStep key={call.callId} time={call.time} name={call.name} state="run" />
              ))}
            </div>
          )}
        </div>
        {!pinned && !empty && (
          <button type="button" className={css.jump} onClick={jumpToBottom}>↓ 最新</button>
        )}
      </div>
    </div>
  )
}

/** 按节点 kind 渲染一条气泡消息或步骤行。 */
function MessageRow({ node, hiddenCallIds }: { node: ConversationNode; hiddenCallIds: ReadonlySet<string> }) {
  switch (node.kind) {
    case 'user':
      return <UserMessage time={node.time} text={textOf(node.content)} />
    case 'steering':
      return <UserMessage time={node.time} text={textOf(node.content)} steering />
    case 'assistant':
      return <AssistantMessage node={node} hiddenCallIds={hiddenCallIds} />
    case 'context':
      return <ContextStep node={node} />
    case 'tool-result':
      return (
        <ToolStep
          time={node.time}
          name={node.call?.name ?? node.callId}
          state={node.isError ? 'fail' : 'ok'}
          detail={node.call === null ? '' : summarizeArgs(node.call.argsRaw)}
          errCode={node.error?.code}
        />
      )
    case 'model-retry':
      return (
        <div className={css.step} data-kind="retry">
          <span className={css.stepTs}>{clock(node.time)}</span>
          <span className={css.tag} data-kind="tool">RETRY</span>
          <span className={css.stepBody}>{node.retryState}</span>
        </div>
      )
    case 'turn-error':
      return (
        <div className={css.step} data-kind="error">
          <span className={css.stepTs}>{clock(node.time)}</span>
          <span className={css.tag} data-kind="error">ERROR</span>
          <span className={css.stepBody}>
            {node.message}
            {node.code !== undefined && <span className={css.toolErr}>{node.code}</span>}
          </span>
        </div>
      )
    case 'command': {
      const cmd = `/${node.name ?? '?'}${node.args === null ? '' : ` ${node.args}`}`
      return (
        <div className={css.step} data-kind="command">
          <span className={css.stepTs}>{clock(node.time)}</span>
          <span className={css.tag} data-kind="bash">$</span>
          <span className={css.stepBody}><span className={css.stepHl}>{cmd}</span></span>
          {node.outcome !== null && (
            <span className={css.stepResult} data-state={node.outcome.kind === 'error' ? 'fail' : 'ok'}>
              {node.outcome.kind === 'error' ? 'FAIL' : 'OK'}
            </span>
          )}
        </div>
      )
    }
    case 'compaction':
      return (
        <div className={css.step} data-kind="compaction">
          <span className={css.stepTs}>{clock(node.time)}</span>
          <span className={css.tag} data-kind="tool">COMPACT</span>
          <span className={css.stepBody}>{node.summary ?? '—'}</span>
        </div>
      )
    case 'unknown':
      return (
        <div className={css.step} data-kind="unknown">
          <span className={css.stepTs}>{clock(node.time)}</span>
          <span className={css.tag} data-kind="unknown">[{node.type}]</span>
        </div>
      )
    // 防御臂：ConversationNode 为闭联合（UnknownSurfaceNode 即文档化兜底），
    // 未来拓宽时降级为原始行而非静默丢弃。
    default: {
      const fallback = node as UnknownSurfaceNode
      return (
        <div className={css.step} data-kind="unknown">
          <span className={css.stepTs}>{clock(fallback.time)}</span>
          <span className={css.tag} data-kind="unknown">[{fallback.type}]</span>
        </div>
      )
    }
  }
}

/** user/steering 消息：meta（YOU + 时间）+ 右对齐气泡正文。 */
function UserMessage({ time, text, steering = false }: { time: number; text: string; steering?: boolean }) {
  return (
    <article className={css.message} data-kind="user">
      <div className={css.messageMeta}>
        <span className={css.messageRole}>{steering ? 'YOU · STEER' : 'YOU'}</span>
        <span className={css.messageTime}>{clock(time)}</span>
      </div>
      <p className={css.messageCopy}>
        {text.length > 0 ? text : <span className={css.muted}>(空)</span>}
      </p>
    </article>
  )
}

/** assistant 消息：meta（DEEPSEEK + 时间）+ 块（文本/思考/工具步骤）+ 推理统计尾。 */
function AssistantMessage({ node, hiddenCallIds }: { node: AssistantMessageNode; hiddenCallIds: ReadonlySet<string> }) {
  const footer = assistantFooter(node)
  return (
    <article className={css.message} data-kind="assistant">
      <div className={css.messageMeta}>
        <span className={css.messageRole}>DEEPSEEK</span>
        <span className={css.messageTime}>{clock(node.time)}</span>
        {node.interrupted === true && <span className={css.muted}>已停止</span>}
      </div>
      {node.blocks.length === 0 && <span className={css.muted}>(空)</span>}
      {node.blocks.map((block, i) => (
        <AssistantBlockRow key={i} block={block} hiddenCallIds={hiddenCallIds} />
      ))}
      {footer !== null && <p className={css.assistantFinal}>{footer}</p>}
    </article>
  )
}

/** 渲染 assistant 消息的一个块（文本 / 推理 / 工具调用 / 其他兜底）。 */
function AssistantBlockRow({ block, hiddenCallIds }: { block: AssistantBlock; hiddenCallIds: ReadonlySet<string> }) {
  switch (block.kind) {
    case 'text':
      return block.text.length > 0
        ? <p className={css.messageCopy}>{block.text}</p>
        : <span className={css.muted}>(空)</span>
    case 'reasoning':
      return <div className={css.thinkDisclosure}>{block.text}</div>
    case 'tool-call':
      // 运行中或已落地的调用由运行行/结果行呈现，避免双行；此处仅兜「结果未到
      // 且不在运行集」的罕见中间态。
      if (hiddenCallIds.has(block.callId)) return null
      return <ToolStep time={0} name={block.name} state="run" />
    default:
      return <span className={css.muted}>[other-block]</span>
  }
}

/** 工具步骤行：时间 + 类型标签 + 摘要 + 状态（红涨绿跌：成功为红、失败为绿）。 */
function ToolStep({ time, name, state, detail = '', errCode }: {
  time: number
  name: string
  state: 'ok' | 'fail' | 'run'
  detail?: string
  errCode?: string | undefined
}) {
  return (
    <div className={css.step} data-kind="tool">
      <span className={css.stepTs}>{clock(time)}</span>
      <span className={css.tag} data-kind={tagKindOf(name)}>{name}</span>
      <span className={css.stepBody}>
        {detail.length > 0 && <span className={css.stepPath}>{detail}</span>}
        {errCode !== undefined && <span className={css.toolErr}>{errCode}</span>}
      </span>
      <span className={css.stepResult} data-state={state}>
        {state === 'run' ? 'RUN' : state === 'fail' ? 'FAIL' : 'OK'}
      </span>
    </div>
  )
}

/** context 注入步骤行：长注入折叠为一行摘要（点击展开全文），短注入单行呈现。 */
function ContextStep({ node }: { node: Extract<ConversationNode, { kind: 'context' }> }) {
  const text = textOf(node.content)
  const long = text.length > CONTEXT_SUMMARY_CHARS
  const label = node.provenance.label ?? node.provenance.role
  const head = (
    <>
      <span className={css.stepTs}>{clock(node.time)}</span>
      <span className={css.tag} data-kind="context">≡ Context</span>
      <span className={css.stepBody}>
        <span className={css.stepPath}>{label}</span>
        <span className={css.stepPreview}>{long ? `${text.slice(0, CONTEXT_SUMMARY_CHARS)}…` : text}</span>
      </span>
      <span className={css.stepResult}>inject</span>
    </>
  )
  if (!long) return <div className={css.step} data-kind="context">{head}</div>
  return (
    <details className={css.stepFold} data-kind="context">
      <summary className={css.step}>{head}</summary>
      <div className={css.stepFoldText}>{text}</div>
    </details>
  )
}

/** 工具名 → demopage 步骤标签类型（read 蓝 / bash 橙 / skill 青 / tool 琥珀）。 */
function tagKindOf(name: string): 'read' | 'bash' | 'skill' | 'tool' {
  const n = name.toLowerCase()
  if (/read|view|open|cat|grep|glob|ls\b/.test(n)) return 'read'
  if (/bash|shell|exec|run|terminal|pwsh|cmd/.test(n)) return 'bash'
  if (/skill/.test(n)) return 'skill'
  return 'tool'
}

/** 从工具调用参数原文提取最具代表性的目标（路径/命令/查询等）；非 JSON 回退原文。 */
function summarizeArgs(argsRaw: string): string {
  const trimmed = argsRaw.trim()
  if (trimmed.length === 0) return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      const rec = parsed as Record<string, unknown>
      for (const key of ['path', 'file', 'filePath', 'command', 'cmd', 'query', 'url', 'pattern', 'name', 'prompt']) {
        const v = rec[key]
        if (typeof v === 'string' && v.length > 0) return v
      }
    }
  } catch {
    // argsRaw 非 JSON：回退原文，由 stepBody 的 ellipsis 截断。
  }
  return trimmed
}

/** assistant 推理统计尾：`时间 · Ran for · TTFT · tok/s`，缺记录的部分省略。 */
function assistantFooter(node: AssistantMessageNode): string | null {
  const timing = node.timing
  const parts: string[] = []
  if (timing !== undefined && timing.stepStartTime !== null) {
    parts.push(`Ran for ${formatSeconds(Math.max(0, timing.completedTime - timing.stepStartTime))}`)
    if (timing.firstTokenTime !== null) {
      parts.push(`TTFT ${formatSeconds(Math.max(0, timing.firstTokenTime - timing.stepStartTime))}`)
    }
  }
  const tokens = outputTokensOf(node.usage)
  if (timing !== undefined && timing.firstTokenTime !== null && tokens !== null) {
    const decodeMs = Math.max(0, timing.completedTime - timing.firstTokenTime)
    if (decodeMs > 0) parts.push(`${Math.round(tokens / (decodeMs / 1000))} tok/s`)
  }
  if (parts.length === 0) return null
  return `${clock(node.time)} · ${parts.join(' · ')}`
}

/** 从 provider usage 读取 completion token 数；缺失或非数返回 null。 */
function outputTokensOf(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const v = (usage as { outputTokens?: unknown }).outputTokens
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** 毫秒 → 秒读数（<10s 保留一位小数、去尾零；否则取整）。 */
function formatSeconds(ms: number): string {
  const s = ms / 1000
  if (s < 10) {
    const r = Math.round(s * 10) / 10
    return `${Number.isInteger(r) ? r.toFixed(0) : r}s`
  }
  return `${Math.round(s)}s`
}

/** 从内容块中提取文本（只取 text 块，按序拼接；无文本返回空串）。 */
function textOf(blocks: Parameters<typeof toAssistantBlocks>[0]): string {
  const parts: string[] = []
  for (const block of toAssistantBlocks(blocks)) {
    if (block.kind === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

/** 时间戳（Unix 毫秒 → HH:MM:SS）；未知时间显示占位。 */
function clock(ts: number): string {
  if (ts <= 0) return '--:--:--'
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
