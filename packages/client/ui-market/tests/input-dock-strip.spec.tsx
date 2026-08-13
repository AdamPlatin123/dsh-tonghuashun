// @vitest-environment jsdom
/**
 * 输入 dock 终端状态条测试：注册面（apply 在 conversation.input.dock 注册
 * order 0 条目）与渲染面（节点/Turn/调用数来自真实快照，Token 缺失留空
 * —，状态点按红涨绿跌着色）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Context } from 'cordis'
import type { ConversationNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'
import { InputDockStrip, type InputDockStripProps } from '../src/client/InputDockStrip.tsx'
import css from '../src/client/InputDockStrip.module.css'

/** 状态点元素：root 首子（.status）内的 <i>；分隔符是 root 直子，不在首子内。 */
function statusDot(view: ReturnType<typeof render>) {
  return view.container.querySelector('[data-input-dock-strip] > span:first-child > i')
}

afterEach(cleanup)

/** 构造满足 apply() 读取的最小 stub ctx（与 apply.spec.ts 同一模式）。 */
function stubCtx() {
  const slotInjects = new Map<string, Array<() => unknown>>()
  const ctx = {
    locale: {
      register: vi.fn((ns: string) => { void ns; return () => {} }),
    },
    on: vi.fn(() => () => {}),
    slots: {
      inject: vi.fn((name: string, factory: () => unknown) => {
        const set = slotInjects.get(name) ?? []
        set.push(factory)
        slotInjects.set(name, set)
        return () => {}
      }),
      register: vi.fn(() => () => {}),
    },
  }
  return { ctx: ctx as unknown as Context, slotInjects }
}

/** 最小 ConversationSnapshot 夹具（仅含状态条读取的字段）。 */
function snapshot(overrides: {
  nodes?: readonly ConversationNode[]
  turnTimings?: ReadonlyMap<number, { readonly startTime: number; readonly endTime?: number }>
  runningCalls?: readonly unknown[]
  pending?: readonly unknown[]
  running?: boolean
} = {}): ConversationSnapshot {
  return {
    nodes: [],
    turnTimings: new Map(),
    runningCalls: [],
    pending: [],
    running: false,
    ...overrides,
  } as unknown as ConversationSnapshot
}

/** 以固定快照渲染状态条。 */
function renderStrip(snap: ConversationSnapshot) {
  const useSession = ((selector: (s: ConversationSnapshot) => unknown) => selector(snap)) as unknown as InputDockStripProps['useSession']
  return render(<InputDockStrip {...({ useSession } as unknown as InputDockStripProps)} />)
}

describe('apply 注册', () => {
  it('在 conversation.input.dock 注册 order 0 终端条', () => {
    const { ctx, slotInjects } = stubCtx()
    apply(ctx)
    const factories = slotInjects.get('conversation.input.dock')
    expect(factories).toHaveLength(1)
    const registrations: Array<{ name?: string; id?: string; order?: number }> = []
    const register = ctx.slots.register as unknown as ReturnType<typeof vi.fn>
    register.mockImplementation((options: { name?: string; id?: string; order?: number }) => {
      registrations.push(options)
      return () => {}
    })
    factories?.[0]?.()
    expect(registrations).toEqual([{ name: 'conversation.input.dock', id: 'ths-input-dock', order: 0 }])
  })
})

describe('InputDockStrip', () => {
  it('渲染真实统计；Token 无真实记录时留空 —（就绪/绿点）', () => {
    const snap = snapshot({
      nodes: [
        { kind: 'user', seq: 1, time: 1, content: [], source: 'test' },
        { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [], usage: { inputTokens: 0, outputTokens: 0 } },
      ],
      turnTimings: new Map([[1, { startTime: 1 }]]),
    })
    const view = renderStrip(snap)
    expect(view.getByText('就绪')).toBeTruthy()
    expect(view.getByText('2')).toBeTruthy()
    expect(view.getByText('1')).toBeTruthy()
    expect(view.getByText('0')).toBeTruthy()
    expect(view.getByText('—')).toBeTruthy()
    expect(statusDot(view)?.className.includes(css.idle!)).toBe(true)
  })

  it('运行中显示红点并汇总 assistant 节点真实 usage（非 assistant/无 usage 节点跳过）', () => {
    const snap = snapshot({
      nodes: [
        { kind: 'user', seq: 1, time: 1, content: [], source: 'test' },
        { kind: 'assistant', seq: 2, time: 2, turn: 1, step: 1, blocks: [] },
        { kind: 'assistant', seq: 3, time: 3, turn: 2, step: 0, blocks: [], usage: { cacheReadTokens: 500 } },
        { kind: 'assistant', seq: 4, time: 4, turn: 2, step: 1, blocks: [], usage: { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } },
      ],
      turnTimings: new Map([[1, { startTime: 1 }], [2, { startTime: 2, endTime: 3 }]]),
      runningCalls: [{ callId: 'c1' }],
    })
    const view = renderStrip(snap)
    expect(view.getByText('运行中')).toBeTruthy()
    expect(view.getByText('4')).toBeTruthy()
    expect(view.getByText('2')).toBeTruthy()
    expect(view.getByText('2,040')).toBeTruthy()
    expect(statusDot(view)?.className.includes(css.running!)).toBe(true)
  })

  it('运行标志（session.running）与待处理均派生正确状态点', () => {
    const runningSnap = snapshot({ running: true })
    const runningView = renderStrip(runningSnap)
    expect(runningView.getByText('运行中')).toBeTruthy()
    expect(statusDot(runningView)?.className.includes(css.running!)).toBe(true)
    cleanup()

    const pendingView = renderStrip(snapshot({ pending: [{ kind: 'approval' }] }))
    expect(pendingView.getByText('待处理')).toBeTruthy()
    expect(statusDot(pendingView)?.className.includes(css.pending!)).toBe(true)
  })
})
