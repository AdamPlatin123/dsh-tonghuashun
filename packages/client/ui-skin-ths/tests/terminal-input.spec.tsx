// @vitest-environment jsdom
// 终端 composer 输入卡行为：发送走真实输入管线（SessionInputShell ——
// inputActions 标准提供通道 → 默认 sink 事务），空输入禁用发送，
// Enter 发送 / Shift+Enter 换行 / IME 组合不发送，hero（空白会话）与
// removed 占位禁用，模型徽标显示注入面解析的真实模型选择（无源占位）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionInputShell } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/facade.ts'
import { TerminalInput } from '../src/client/TerminalInput.tsx'
import type { TerminalInputProps } from '../src/client/TerminalInput.tsx'

afterEach(cleanup)

const SCTX = {} as ClientContext
const SID = 's1' as SessionId

function snapshotOf(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

interface BenchOptions {
  /** 会话快照覆盖（running / composerPhase / removed / blank…）。 */
  snapshot?: Partial<ConversationSnapshot>
  /** 会话列表摘要（blank 位；缺省 = 活跃非空白）。 */
  summaryBlank?: boolean
  /** 预置草稿。 */
  draft?: string
  /** 注入面模型源；undefined = 服务缺位。 */
  model?: { provider: string; model: string } | null
}

/** 真实输入机器（无 slash 管道）＋ stub 标准套件。defaultSink 模拟 hub sink
 * 的提交语义（commitSend 清草稿 —— 发送后草稿不复活），记录发送文本。 */
function bench(over: BenchOptions = {}) {
  const sink = vi.fn()
  const shell: SessionInputShell = new SessionInputShell({
    actx: SCTX,
    defaultSink: (text, mode) => {
      sink(text, mode)
      shell.commitSend() // hub sink 的真实清稿语义
    },
  })
  if (over.draft !== undefined && over.draft !== '') shell.setDraft(over.draft)
  const session = createSnapshotStore<ConversationSnapshot>(snapshotOf(over.snapshot))
  const sessions = createSnapshotStore({
    ids: [], byId: {}, current: undefined, phase: 'ready' as const,
    subagentsByParent: {}, currentAddress: undefined,
  })
  const modelStore = createSnapshotStore<{ current: { provider: string; model: string } | null }>({
    current: over.model ?? null,
  })
  const loadModel = vi.fn()
  const modelSource = vi.fn(() => ({
    getSnapshot: () => modelStore.getSnapshot().current,
    subscribe: (fn: () => void) => modelStore.subscribe(fn),
  }))
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(session),
    useSessions: bindSnapshotSelector(sessions),
    useInput: bindSnapshotSelector(shell.state),
    inputActions: shell.actions,
    modelSource,
    loadModel,
  }
  return { props, sink, shell, loadModel, modelSource }
}

describe('TerminalInput', () => {
  it('空输入禁用发送；输入草稿后按钮启用，点击经真实管线提交到 sink', async () => {
    const { props, sink } = bench()
    const view = render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    const send = view.getByRole('button', { name: '发送消息' })
    expect((send as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(view.getByRole('textbox'), { target: { value: 'hello ths' } })
    expect((send as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(send)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith('hello ths', 'queue')
    // 发送成功后草稿清空（机器 send-committed 语义），按钮回到禁用。
    await waitFor(() => { expect((send as HTMLButtonElement).disabled).toBe(true) })
  })

  it('空白草稿（纯空格）同样禁用发送', () => {
    const { props } = bench({ draft: '   ' })
    const view = render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    expect((view.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Enter 发送；Shift+Enter 保留原生换行不发送', () => {
    const { props, sink } = bench({ draft: 'line' })
    const view = render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    const box = view.getByRole('textbox')

    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(sink).not.toHaveBeenCalled()

    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith('line', 'queue')
  })

  it('IME 组合态 Enter 选中候选，不发送', () => {
    const { props, sink } = bench({ draft: '你好' })
    const view = render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    const box = view.getByRole('textbox')

    fireEvent.compositionStart(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(sink).not.toHaveBeenCalled()
  })

  it('hero（空白会话）占位禁用态：输入与发送均不可用', () => {
    const { props, sink } = bench({ snapshot: { composerPhase: 'blank', blank: true } })
    const view = render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' })
    expect(sink).not.toHaveBeenCalled()
    expect(view.getByPlaceholderText('暂无会话 · 请从侧栏选择或新建会话')).toBeDefined()
  })

  it('会话被移除时占位禁用', () => {
    const { props } = bench({ snapshot: { removed: true }, draft: 'text' })
    const view = render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('提交事务进行中（submitting）textarea 只读、发送禁用', () => {
    const { props } = bench({ draft: 'text' })
    // 注入真实机器状态：adjudicating/submitting 相位直接驱动只读。
    const input = createSnapshotStore({ draft: 'text', phase: 'submitting' })
    const readOnlyProps = {
      ...props,
      useInput: bindSnapshotSelector(input),
    }
    const view = render(<TerminalInput {...readOnlyProps as unknown as TerminalInputProps} />)
    expect((view.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true)
    expect((view.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('模型徽标显示注入面解析的真实模型选择；无源时占位 —', () => {
    const withModel = bench({ model: { provider: 'volc', model: 'doubao-pro-256k' } })
    const viewA = render(<TerminalInput {...withModel.props as unknown as TerminalInputProps} />)
    expect(viewA.getByText('doubao-pro-256k')).toBeDefined()

    const noModel = bench({ model: null })
    const viewB = render(<TerminalInput {...noModel.props as unknown as TerminalInputProps} />)
    expect(viewB.getByText('—')).toBeDefined()
  })

  it('挂载即触发模型目录刷新（替换原生 composer 后目录由本卡负责加载）', () => {
    const { props, loadModel } = bench()
    render(<TerminalInput {...props as unknown as TerminalInputProps} />)
    expect(loadModel).toHaveBeenCalledTimes(1)
    expect(loadModel).toHaveBeenCalledWith(SID)
  })
})
