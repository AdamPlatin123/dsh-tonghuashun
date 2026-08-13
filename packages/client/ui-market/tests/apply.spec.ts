/**
 * 插件组合测试：对 stub ctx 调用 apply()，断言两个 occupant 席位
 * （conversation.bottom.panel / conversation.details.panel）与文案命名空间
 * 的注册面。
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, NS } from '../src/client/index.ts'
import type { Context } from 'cordis'

/** 构造满足 apply() 读取的最小 stub ctx。 */
function stubCtx() {
  const slotInjects = new Map<string, Array<() => unknown>>()
  const localeNamespaces = new Set<string>()
  const ctx = {
    locale: {
      register: vi.fn((ns: string) => { localeNamespaces.add(ns); return () => {} }),
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
  return { ctx: ctx as unknown as Context, slotInjects, localeNamespaces }
}

describe('apply', () => {
  it('注册文案命名空间', () => {
    const { ctx, localeNamespaces } = stubCtx()
    apply(ctx)
    expect(localeNamespaces.has(NS)).toBe(true)
  })

  it('注册底部 K 线席位与右侧指数席位', () => {
    const { ctx, slotInjects } = stubCtx()
    apply(ctx)
    expect(slotInjects.get('conversation.bottom.panel')).toHaveLength(1)
    expect(slotInjects.get('conversation.details.panel')).toHaveLength(1)
  })

  it('两个席位都有注册 factory 且产出注册', () => {
    const { ctx, slotInjects } = stubCtx()
    apply(ctx)
    const registrations: Array<{ name?: string; id?: string }> = []
    const register = ctx.slots.register as unknown as ReturnType<typeof vi.fn>
    register.mockImplementation((options: { name?: string; id?: string }) => { registrations.push(options); return () => {} })
    for (const key of ['conversation.bottom.panel', 'conversation.details.panel']) {
      const factory = slotInjects.get(key)?.[0]
      expect(factory).toBeTypeOf('function')
      factory?.()
    }
    expect(registrations.map(r => r.name)).toEqual(['conversation.bottom.panel', 'conversation.details.panel'])
    expect(registrations.map(r => r.name)).not.toContain(undefined)
  })
})
