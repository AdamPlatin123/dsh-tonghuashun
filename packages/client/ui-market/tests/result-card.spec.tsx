// @vitest-environment jsdom
/**
 * 行情工具详情 Result 卡测试：渲染面（工具名/指数/涨跌/变更行/字段表，红涨绿跌，
 * 真实 Result JSON 解析）与注册面（apply 在 conversation.details.tool 注册
 * key=ths_market_snapshot 条目）。数据全部来自真实 ToolCallBlock；无识别记录
 * 留空不伪造。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Context } from 'cordis'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'
import { MarketResultCard, type ResultCardProps } from '../src/client/ResultCard.tsx'
import css from '../src/client/ResultCard.module.css'

afterEach(cleanup)

/** 构造满足 apply() 读取的最小 stub ctx（与 apply.spec.ts 同一模式）。 */
function stubCtx() {
  const slotInjects = new Map<string, Array<() => unknown>>()
  const ctx = {
    locale: { register: vi.fn(() => () => {}) },
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

/** 真实 result JSON 的结算节点夹具。 */
function result(
  name: string,
  text: string,
  over: Partial<ToolResultNode> = {},
): ToolResultNode {
  return {
    kind: 'tool-result', seq: 1, time: 1_000, callId: 'c1',
    call: { name, argsRaw: '{}' },
    callTime: 500,
    content: [{ type: 'text', text }], isError: false, callView: null, resultView: null,
    subCalls: [],
    ...over,
  }
}

/** 以真实结果渲染 Result 卡。 */
function renderCard(block: ResultCardProps['block']) {
  const t = ((key: string) => key) as unknown as ResultCardProps['t']
  const props = {
    block,
    t,
    useSession: () => { throw new Error('unused') },
    sessionId: 's1',
    useProjection: () => { throw new Error('unused') },
    useInput: () => { throw new Error('unused') },
    inputActions: undefined,
    useSessions: () => { throw new Error('unused') },
    useWorkspaces: () => { throw new Error('unused') },
  } as unknown as ResultCardProps
  return render(<MarketResultCard {...props} />)
}

describe('apply 注册', () => {
  it('在 conversation.details.tool 注册 key=ths_market_snapshot 条目', () => {
    const { ctx, slotInjects } = stubCtx()
    apply(ctx)
    const factory = slotInjects.get('conversation.details.tool')?.[0]
    expect(factory).toBeTypeOf('function')
    const registrations: Array<{ name?: string; key?: string }> = []
    const register = ctx.slots.register as unknown as ReturnType<typeof vi.fn>
    register.mockImplementation((options: { name?: string; key?: string }) => { registrations.push(options); return () => {} })
    factory?.()
    expect(registrations).toEqual([{ name: 'conversation.details.tool', key: 'ths_market_snapshot', locale: 'ui-market' }])
  })
})

describe('MarketResultCard', () => {
  it('渲染真实指数/涨跌（红涨绿跌）与变更行', () => {
    const block = result('ths_market_snapshot', JSON.stringify({
      quotes: [
        { name: 'DS 指数', value: 114_400, change: 1_600, changePct: 1.42 },
        { name: '代码量', value: 9_004_168, change: -383, changePct: -0.0042 },
      ],
      changedLines: 383,
      source: 'repo-stats',
    }))
    const view = renderCard(block)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('ths_market_snapshot')
    expect(card!.textContent).toContain('DS 指数')
    expect(card!.textContent).toContain('114,400')
    expect(card!.textContent).toContain('+1,600')
    expect(card!.textContent).toContain('+1.42%')
    expect(card!.textContent).toContain('9,004,168')
    expect(card!.textContent).toContain('-383')
    // 涨跌色：红涨绿跌（THS 语义互换 success=红）。
    expect(card!.querySelectorAll(`.${css.up}`).length).toBeGreaterThan(0)
    expect(card!.querySelectorAll(`.${css.down}`).length).toBeGreaterThan(0)
  })

  it('表格化剩余标量字段（变更行单独成行，不出现在字段表）', () => {
    const block = result('ths_market_snapshot', JSON.stringify({
      quotes: [{ name: 'DS 指数', value: 100, change: 2 }],
      changedLines: 12,
      source: 'repo-stats',
      date: '2026-08-12',
    }))
    const view = renderCard(block)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card!.textContent).toContain('source')
    expect(card!.textContent).toContain('repo-stats')
    expect(card!.textContent).toContain('date')
    expect(card!.textContent).toContain('2026-08-12')
  })

  it('数组根：每条行情一个渲染行，无变更行/字段', () => {
    const block = result('ths_market_snapshot', JSON.stringify([
      { name: 'DS 指数', value: 100, change: 1 },
      { name: '代码量', value: 200, change: -1 },
    ]))
    const view = renderCard(block)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card!.textContent).toContain('DS 指数')
    expect(card!.textContent).toContain('代码量')
    expect(card!.textContent).not.toContain('result.changedLines')
  })

  it('非 JSON 结果回退首行文本', () => {
    const block = result('ths_market_snapshot', '第一行摘要\n第二行细节')
    const view = renderCard(block)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card!.textContent).toContain('第一行摘要')
    expect(card!.textContent).not.toContain('第二行细节')
  })

  it('真实记录缺失留空（不伪造）', () => {
    const block = result('ths_market_snapshot', JSON.stringify({}))
    const view = renderCard(block)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card!.textContent).toContain('result.empty')
  })

  it('失败结果渲染错误摘要', () => {
    const block = result('ths_market_snapshot', 'boom: 500', { isError: true })
    const view = renderCard(block)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card!.getAttribute('data-state')).toBe('error')
    expect(card!.textContent).toContain('boom: 500')
  })

  it('运行中调用渲染运行态（无结算内容）', () => {
    const running = {
      callId: 'c1', name: 'ths_market_snapshot', argsRaw: '{}', turn: 1, step: 1,
      time: 1_000, callView: null, subCalls: [],
    } as unknown as ResultCardProps['block']
    const view = renderCard(running)
    const card = view.container.querySelector('[data-tool="ths_market_snapshot"]')
    expect(card!.getAttribute('data-state')).toBe('running')
    expect(card!.textContent).toContain('result.running')
  })
})
