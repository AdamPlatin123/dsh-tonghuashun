// @vitest-environment jsdom
/**
 * 终端消息流（conversation.chat.panel occupant）渲染测试：真实快照节点按
 * kind 呈现 —— user 文本右对齐气泡、assistant 文本左对齐、工具行名称 + 状态
 * （红涨绿跌：ok 为红、fail 为绿）、Context 注入行标注 CONtext；空日志显示
 * 空态提示；运行中工具调用与 assistant 工具块按 callId 去重为一行 RUN。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore, EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationNode, ConversationSnapshot, SessionId, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { TerminalChat } from '../src/client/TerminalChat.tsx'
import type { TerminalChatProps } from '../src/client/TerminalChat.tsx'

afterEach(cleanup)

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

function bench(overrides: Partial<ConversationSnapshot> = {}) {
  const session = createSnapshotStore<ConversationSnapshot>(snapshotOf(overrides))
  const sessions = createSnapshotStore({
    ids: [], byId: {}, current: undefined, phase: 'ready' as const,
    subagentsByParent: {}, currentAddress: undefined,
  })
  const workspaces = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready',
    error: null, baselinesReady: false, recentWorkspaceId: undefined,
  })
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(session),
    useSessions: bindSnapshotSelector(sessions),
    useWorkspaces: bindSnapshotSelector(workspaces),
    // 文案座位：测试直接用 key 占位，断言文案键与渲染路径。
    t: (key: string) => key,
  }
  return { props, session }
}

/** 覆盖全部关键 kind 的真实节点：user / assistant（文本 + 工具块）/ 工具结果（成功/失败）/ Context 注入。 */
const nodes: ConversationNode[] = [
  { kind: 'user', seq: 1, time: 1_000, content: [{ type: 'text', text: '帮我查一下行情' }], source: null },
  {
    kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
    blocks: [
      { kind: 'text', text: '正在查询…' },
      { kind: 'tool-call', callId: 'call-1', name: 'market_search', argsRaw: '{}' },
    ],
  },
  {
    kind: 'tool-result', seq: 3, time: 3_000, callId: 'call-1',
    call: { name: 'market_search', argsRaw: '{}' }, callTime: 2_500, content: [],
    isError: false, callView: null, resultView: null, subCalls: [],
  },
  {
    kind: 'tool-result', seq: 4, time: 4_000, callId: 'call-2', call: null, callTime: null,
    content: [], isError: true, error: { name: 'Error', code: 'E_BUSY' }, meta: undefined,
    callView: null, resultView: null, subCalls: [],
  },
  {
    kind: 'context', seq: 5, time: 5_000,
    content: [{ type: 'text', text: '已注入上下文' }], source: null,
    provenance: { role: 'inject', label: 'ths-context' }, form: null,
  },
]

describe('TerminalChat', () => {
  it('空日志（blank）显示空态提示', () => {
    const { props } = bench({ blank: true })
    const view = render(<TerminalChat {...props as unknown as TerminalChatProps} />)
    expect(view.getByText('chat.empty')).toBeDefined()
    expect(view.getByRole('status')).toBeDefined()
  })

  it('按 kind 渲染真实快照节点：user / assistant / 工具行 / Context 注入行', () => {
    const { props } = bench({ nodes })
    const view = render(<TerminalChat {...props as unknown as TerminalChatProps} />)
    // user 文本与 assistant 文本。
    expect(view.getByText('帮我查一下行情')).toBeDefined()
    expect(view.getByText('正在查询…')).toBeDefined()
    // 工具行：tool-call 块随结果落地省略，结果行呈一次工具名；call-2 缺 call 头回退 callId。
    expect(view.getAllByText('market_search')).toHaveLength(1)
    expect(view.getByText('call-2')).toBeDefined()
    expect(view.queryAllByText('RUN')).toHaveLength(0)
    // 红涨绿跌：成功（涨）为红、失败（跌）为绿 —— data-state 驱动 CSS 语义。
    const ok = view.getByText('OK')
    expect(ok.getAttribute('data-state')).toBe('ok')
    const fail = view.getByText('FAIL')
    expect(fail.getAttribute('data-state')).toBe('fail')
    expect(view.getByText('E_BUSY')).toBeDefined()
    // Context 注入行：≡ Context 徽标 + 来源标签 + 内容。
    expect(view.getByText('≡ Context')).toBeDefined()
    expect(view.getByText('ths-context')).toBeDefined()
    expect(view.getByText('已注入上下文')).toBeDefined()
  })

  it('运行中工具调用与 assistant 工具块按 callId 去重为一行 RUN', () => {
    const { props } = bench({
      nodes: [{
        kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 1,
        blocks: [{ kind: 'tool-call', callId: 'call-1', name: 'market_search', argsRaw: '{}' }],
      }],
      runningCalls: [{
        callId: 'call-1', name: 'market_search', argsRaw: '{}',
        turn: 1, step: 1, time: 2_000, callView: null, subCalls: [],
      }],
    })
    const view = render(<TerminalChat {...props as unknown as TerminalChatProps} />)
    expect(view.getAllByText('RUN')).toHaveLength(1)
  })

  it('无记录的运行中工具调用仍实时呈现 RUN 行', () => {
    const { props } = bench({
      runningCalls: [{
        callId: 'call-9', name: 'live_quote', argsRaw: '{}',
        turn: 2, step: 1, time: 6_000, callView: null, subCalls: [],
      }],
    })
    const view = render(<TerminalChat {...props as unknown as TerminalChatProps} />)
    expect(view.getAllByText('RUN')).toHaveLength(1)
    expect(view.getByText('live_quote')).toBeDefined()
  })
})
