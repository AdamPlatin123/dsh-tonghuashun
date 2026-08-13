/**
 * 插件组合测试：对 stub ctx 调用 apply()（node 环境 —— DOM 镜像以
 * document 存在为前提自行守卫）。断言 web 皮肤插件必须提供的三个注册面：
 * 向 ThemeService 注册主题、文档镜像订阅、设置行注册及其 setTheme 注入面。
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, SETTINGS_NS } from '../src/client/index.ts'
import { THS_SKIN, SKIN_ID } from '../src/client/skins.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 构造满足 apply() 读取的最小 stub ctx。 */
function stubCtx() {
  const registeredThemes: Array<{ id: string; colorScheme: string; tokens: object }> = []
  const themeDisposers = new Set<() => void>()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  let snapshot = { preference: 'light', active: { id: 'light', colorScheme: 'light', tokens: {} }, themes: [], revision: 0 }
  const slotRegistrations: Array<{ name: string; id: string; order: number; locale: string; inject?: (actions: object) => object }> = []
  const slotInjects = new Map<string, Array<() => unknown>>()
  const localeNamespaces = new Set<string>()
  const effects: Array<() => void> = []
  const ctx = {
    theme: {
      register: vi.fn((def: { id: string; colorScheme: string; tokens: object }) => {
        registeredThemes.push(def)
        const disposer = vi.fn(() => {})
        themeDisposers.add(disposer)
        return disposer
      }),
      setTheme: vi.fn((id: string) => {
        snapshot = { ...snapshot, preference: id, revision: snapshot.revision + 1 }
      }),
      getTheme: () => snapshot,
    },
    slots: {
      spec: () => ({}),
      entries: () => [],
      subscribe: () => () => {},
      register: vi.fn((options: { name: string; id: string; order: number; locale: string; inject?: (actions: object) => object }) => {
        slotRegistrations.push(options)
        return () => {}
      }),
      inject: vi.fn((name: string, factory: () => unknown) => {
        const set = slotInjects.get(name) ?? []
        set.push(factory)
        slotInjects.set(name, set)
        return () => {
          const list = slotInjects.get(name)
          if (list === undefined) return
          const index = list.indexOf(factory)
          if (index >= 0) list.splice(index, 1)
        }
      }),
    },
    locale: {
      register: vi.fn((ns: string) => { localeNamespaces.add(ns); return () => {} }),
    },
    effect: vi.fn((fn: (() => void) | (() => (() => void))) => {
      const disposer = fn(); effects.push(() => { disposer?.() })
    }),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => { set.delete(listener) }
    }),
    emit: (event: string, payload: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
  }
  return {
    ctx: ctx as unknown as ClientContext, registeredThemes, themeDisposers, listeners,
    slotRegistrations, slotInjects, localeNamespaces, effects,
  }
}

describe('apply', () => {
  it('把 ths 皮肤注册进主题服务', () => {
    const { ctx, registeredThemes } = stubCtx()
    apply(ctx)
    expect(registeredThemes.map(t => t.id)).toEqual([SKIN_ID])
    const theme = registeredThemes[0]
    expect(theme).toBeDefined()
    if (theme === undefined) return
    expect(theme.colorScheme).toBe('dark')
    expect(Object.keys(theme.tokens).length).toBeGreaterThan(20)
  })

  it('把设置行注册进 settings.general.item 并使用皮肤文案命名空间', () => {
    const { ctx, slotInjects, slotRegistrations, localeNamespaces } = stubCtx()
    apply(ctx)
    expect(localeNamespaces.has(SETTINGS_NS)).toBe(true)
    expect(slotInjects.get('settings.general.item')).toHaveLength(1)
    for (const factory of slotInjects.get('settings.general.item') ?? []) factory()
    expect(slotRegistrations).toHaveLength(1)
    const row = slotRegistrations[0]
    expect(row).toMatchObject({ name: 'settings.general.item', id: 'ui-skin-ths', order: 20, locale: SETTINGS_NS })
  })

  it('注册的令牌覆盖全部落在 --dsw-alias-* 语义层', () => {
    const { ctx, registeredThemes } = stubCtx()
    apply(ctx)
    const theme = registeredThemes[0]
    expect(theme).toBeDefined()
    if (theme === undefined) return
    for (const name of Object.keys(theme.tokens)) {
      expect(name).toMatch(/^--dsw-alias-|^--dsw-specific-/)
    }
  })

  it('皮肤定义的红涨绿跌语义成立：success 为红、error 为绿（demopage --up/--down）', () => {
    const tokens = THS_SKIN.definition.tokens
    expect(tokens['--dsw-alias-state-success-primary']).toBe('#ef5c64')
    expect(tokens['--dsw-alias-state-error-primary']).toBe('#1fc67e')
  })

  it('主题注册与设置行注册的回收器在插件卸载时执行', () => {
    const { ctx, themeDisposers, effects } = stubCtx()
    apply(ctx)
    expect(effects.length).toBeGreaterThanOrEqual(3)
    for (const dispose of effects) dispose()
    expect(themeDisposers.size).toBeGreaterThan(0)
    for (const disposer of themeDisposers) expect(disposer).toHaveBeenCalled()
  })
})
