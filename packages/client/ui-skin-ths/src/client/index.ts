/**
 * 同花顺终端皮肤浏览器插件：把 ths 皮肤注册进官方 ThemeService（受认可的
 * 第三方主题表面），把已解析的活动皮肤镜像到文档（`body[data-ds-skin]` +
 * 插件拥有的富 CSS <style> 标签），把皮肤选择行注册进设置 General 区段，
 * 并在皮肤激活时注册终端 chrome、输入框左右终端控件（conversation.input.left/right）
 * 与终端消息流（conversation.chat.panel）。
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
// Type-only: pulls the chrome-slot SlotMap merge (layout.chrome.*).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar takeover SlotMap merge (sidebar.panel).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings Context merge (ctx.settingsPanel) — the sidebar
// Settings button opens the settings panel through the ui-settings service.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the two conversation input SlotMap rows (declared by the
// owning package) into the program so the register calls type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { SkinRowInjected } from './SkinRow.tsx'
import type { TerminalSidebarInjected } from './TerminalSidebar.tsx'
import type { InputControlsInjected } from './InputControls.tsx'
import type { TerminalInputInjected } from './TerminalInput.tsx'
import { SkinRow } from './SkinRow.tsx'
import { createSkinRowStore } from './settings-store.ts'
import { en, zh, type SkinKey } from './locales.ts'
import { THS_SKIN } from './skins.ts'
import { applySkinDom, retractSkinDom } from './skin-dom.ts'
import { TopChrome } from './TopChrome.tsx'
import { BottomChrome } from './BottomChrome.tsx'
import { TerminalSidebar } from './TerminalSidebar.tsx'
import { TerminalChat } from './TerminalChat.tsx'
import { InputLeft, InputRight } from './InputControls.tsx'
import { TerminalInput } from './TerminalInput.tsx'

export type { SkinRowComponentProps, SkinRowInjected } from './SkinRow.tsx'
export type { SkinRowState } from './settings-store.ts'
export type { SkinKey } from './locales.ts'
export type { ModelSelectionLike, ModelSource, TerminalInputInjected } from './TerminalInput.tsx'

/**
 * ui-model 模型服务的结构收窄面（ui-model 非本包依赖，经 ctx.get('models')
 * 动态解析；目录 store 的 current 即真实 ModelSelection）。
 */
interface ModelServiceLike {
  directoryFor(sessionId: SessionId): {
    store: {
      getSnapshot(): { current: { provider: string; model: string } | null }
      subscribe(fn: () => void): () => void
    }
    load(): Promise<unknown>
  }
}

/** 本功能设置行文案的命名空间。 */
export const SETTINGS_NS = 'settings.skins'

/** 皮肤激活持久化 key：ThemeService 只恢复内建主题，第三方主题偏好由本插件自行恢复。 */
export const SKIN_STORAGE_KEY = 'dsh.skin'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 皮肤选择行的文案命名空间。 */
    'settings.skins': SkinKey
  }
}

/** 必需服务：theme（注册表 + 偏好）、slots + locale（设置行）、
 * 以及侧栏/输入/消息各注入面走的真实服务 —— sessions/workspaces/layout/
 * settingsPanel。缺声明时 cordis fiber 链遍历到根会抛
 * `cannot get property "X" without inject`（见浏览器复现）。 */
export const inject = ['theme', 'slots', 'locale', 'sessions', 'workspaces', 'layout', 'settingsPanel']

/**
 * 客户端插件主体：把 ths 皮肤注册进 ThemeService、把活动皮肤镜像到文档、
 * 注册皮肤选择行到 General 区段的 item 插槽。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  // 注册皮肤；插件卸载时统一回收注册。
  ctx.effect(() => {
    const dispose = ctx.theme.register(THS_SKIN.definition)
    // ThemeService 的 restorePreference 只接受内建主题 id；第三方皮肤
    // 偏好由本插件持久化并自行恢复。
    if (typeof localStorage !== 'undefined' && localStorage.getItem(SKIN_STORAGE_KEY) === THS_SKIN.definition.id) {
      ctx.theme.setTheme(THS_SKIN.definition.id)
    }
    return () => { dispose() }
  }, 'ui-skin-ths: theme registration')

  // 把已解析的活动主题镜像到文档；卸载时回收。
  ctx.effect(() => {
    applySkinDom(ctx.theme.getTheme().active.id)
    ctx.on('theme/change', (snapshot: ThemeSnapshot) => { applySkinDom(snapshot.active.id) })
    return () => { retractSkinDom() }
  }, 'ui-skin-ths: document mirror')

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-skin-ths: settings row dictionaries')

  // 皮肤 chrome：顶部行情条与底部状态条。注册跟随主题激活状态 ——
  // 皮肤未启用时不占位，符合“默认配置不加载皮肤时结构不变”。
  ctx.effect(() => {
    let disposeTop: (() => void) | undefined
    let disposeBottom: (() => void) | undefined
    let disposeSidebar: (() => void) | undefined
    let disposeInputLeft: (() => void) | undefined
    let disposeInputRight: (() => void) | undefined
    let disposeChat: (() => void) | undefined
    const sync = (snapshot: ThemeSnapshot): void => {
      const active = snapshot.active.id === THS_SKIN.definition.id
      if (active && disposeTop === undefined) {
        disposeTop = ctx.slots.inject('layout.chrome.top', () => ctx.slots.register({
          name: 'layout.chrome.top',
          locale: SETTINGS_NS,
        }, TopChrome))
        disposeBottom = ctx.slots.inject('layout.chrome.bottom', () => ctx.slots.register({
          name: 'layout.chrome.bottom',
          locale: SETTINGS_NS,
        }, BottomChrome))
        disposeSidebar = ctx.slots.inject('sidebar.panel', () => ctx.slots.register({
          name: 'sidebar.panel',
          locale: SETTINGS_NS,
          inject: (): TerminalSidebarInjected => ({
            startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
            toggleSidebar: () => { ctx.layout.toggleSidebar() },
            openSession: (id) => { ctx.sessions.open(id) },
            openSettings: () => { ctx.settingsPanel.open() },
          }),
        }, TerminalSidebar))
        // 输入框左右终端控件：行情按钮经注入面打开右侧详情列，右侧状态
        // 标记读运行时会话快照。皮肤未启用时不注册（同 chrome 占位规则）。
        disposeInputLeft = ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'ui-skin-ths-input-left',
          order: 0,
          locale: SETTINGS_NS,
          inject: (): InputControlsInjected => ({
            openDetails: () => { ctx.layout.openDetails() },
          }),
        }, InputLeft))
        disposeInputRight = ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'ui-skin-ths-input-right',
          order: 0,
          locale: SETTINGS_NS,
        }, InputRight))
        // 终端消息流：皮肤激活时整体接管会话消息流（conversation.chat.panel
        // 为 fallback-反转占位，无 occupant 时原生消息流不变）。
        disposeChat = ctx.slots.inject('conversation.chat.panel', () => ctx.slots.register({
          name: 'conversation.chat.panel',
          locale: SETTINGS_NS,
        }, TerminalChat))
      } else if (!active && disposeTop !== undefined) {
        disposeTop()
        disposeBottom?.()
        disposeSidebar?.()
        disposeInputLeft?.()
        disposeInputRight?.()
        disposeChat?.()
        disposeTop = undefined
        disposeBottom = undefined
        disposeSidebar = undefined
        disposeInputLeft = undefined
        disposeInputRight = undefined
        disposeChat = undefined
      }
    }
    sync(ctx.theme.getTheme())
    ctx.on('theme/change', sync)
    return () => {
      disposeTop?.(); disposeBottom?.(); disposeSidebar?.()
      disposeInputLeft?.(); disposeInputRight?.(); disposeChat?.()
    }
  }, 'ui-skin-ths: chrome strips + input controls')

  // 终端 composer 输入卡：注册跟随主题激活状态（同 chrome 占位规则）。
  // 皮肤激活时整体替换原生 composer（conversation.composer.panel 单座，
  // 无 occupant 时原生 composer 不变）。发送动作走标准提供通道
  // （inputActions —— ui-conversation 输入机器的公开面），模型徽标经注入面
  // 动态解析 ui-model 的会话模型目录（ui-model 非本包依赖，结构收窄）。
  ctx.effect(() => {
    let disposeComposer: (() => void) | undefined
    const sync = (snapshot: ThemeSnapshot): void => {
      const active = snapshot.active.id === THS_SKIN.definition.id
      if (active && disposeComposer === undefined) {
        disposeComposer = ctx.slots.inject('conversation.composer.panel', () => ctx.slots.register({
          name: 'conversation.composer.panel',
          locale: SETTINGS_NS,
          inject: (): TerminalInputInjected => {
            const models = ctx.get('models') as ModelServiceLike | undefined
            return {
              modelSource: (sessionId) => {
                try {
                  const directory = models?.directoryFor(sessionId)
                  if (directory === undefined) return undefined
                  return {
                    getSnapshot: () => directory.store.getSnapshot().current,
                    subscribe: fn => directory.store.subscribe(fn),
                  }
                } catch {
                  return undefined // 目录服务不可用（会话 scope 未解析）：徽标保持占位
                }
              },
              loadModel: (sessionId) => {
                try {
                  void models?.directoryFor(sessionId).load().catch(() => undefined)
                } catch {
                  // 同上：服务不可用时静默，错误不上抛到渲染层
                }
              },
            }
          },
        }, TerminalInput))
      } else if (!active && disposeComposer !== undefined) {
        disposeComposer()
        disposeComposer = undefined
      }
    }
    sync(ctx.theme.getTheme())
    ctx.on('theme/change', sync)
    return () => { disposeComposer?.() }
  }, 'ui-skin-ths: composer terminal input')

  const store = createSkinRowStore()
  let bound: BoundActions<typeof store> | undefined
  const sync = (snapshot: ThemeSnapshot): void => {
    bound?.sync(snapshot.active.id, snapshot.revision)
  }
  ctx.on('theme/change', sync)
  const injected = (actions: BoundActions<typeof store>): SkinRowInjected => {
    bound = actions
    // 从 getter 重新同步，避免注册与首次渲染之间丢事件（store 的修订号
    // 守卫会丢弃过期重复）。
    sync(ctx.theme.getTheme())
    return {
      setTheme: (id) => {
        if (id === THS_SKIN.definition.id) {
          localStorage.setItem(SKIN_STORAGE_KEY, THS_SKIN.definition.id)
        } else {
          localStorage.removeItem(SKIN_STORAGE_KEY)
        }
        ctx.theme.setTheme(id)
      },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'ui-skin-ths',
    order: 20,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  }, SkinRow))
}
