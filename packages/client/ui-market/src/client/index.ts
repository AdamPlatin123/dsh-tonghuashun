/**
 * 行情功能插件（ui-market）：把 DS 指数与代码量 K 线做成真实可用的界面
 * 组件 —— 底部 `conversation.bottom.panel` 停靠代码量日 K 线，右侧
 * `conversation.details.panel` 接管为 DS 指数炒股界面，会话页头注册
 * 紧凑行情按钮；并把 `ths_market_snapshot` 工具调用渲染为终端风格行
 * （tool.call.toolview keyed 注册，真实 Result 摘要）。所有数字来自运行时
 * 会话的派生投影（market-data.ts）或真实 tool block，统一标注 LOCAL
 * PROJECTION；本插件不引入任何证券数据供应商。
 */
import type { Context } from 'cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the two conversation SlotMap rows (declared by the owning
// package) must be in the program for the register calls to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the keyed tool.call.toolview SlotMap row declared by ui-tool
// (the Tool rows dispatch seam) so the registration below types.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: pulls the layout service merge (ctx.layout) for the header
// action's open-details entry.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the repo/stats Events merge for the snapshot subscription.
import type {} from '@deepseek-ai/dsh-repo-stats'
import type { MarketKey } from './locales.ts'
import { zh, en } from './locales.ts'
import { MarketDock } from './MarketDock.tsx'
import { MarketDetails } from './MarketDetails.tsx'
import { MarketContextButton } from './MarketContext.tsx'
import { InputDockStrip } from './InputDockStrip.tsx'
import { MarketResultCard } from './ResultCard.tsx'
import { MarketToolRow } from './ToolRow.tsx'
import { MarketView } from './MarketView.tsx'
import { createRepoStatsStore, type RepoStatsInstance } from './repo-stats-store.ts'

/** 本功能文案的命名空间。 */
export const NS = 'ui-market'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 行情面板的文案命名空间。 */
    'ui-market': MarketKey
  }
}

/** 必需服务：插槽（两个 occupant 席位 + 会话页头 actions）+ 布局（打开详情）+ locale。 */
export const inject = ['slots', 'layout', 'locale']

/** 页头按钮的注入面：当前会话 id 与打开详情回调。 */
export interface MarketContextInjected {
  sessionId: SessionId
  /** 打开右侧详情列（显示 DS 指数面板）。 */
  openDetails: () => void
}

/** 行情面板注入面：真实 repo-stats 实例（组件经 useSyncExternalStore 订阅）。 */
export interface MarketRepoStatsInjected {
  repoStats: RepoStatsInstance
}

/** 详情面板注入面：repo-stats 之外，另注入 openDetails 让面板挂载时默认展开（对齐 demopage 右侧常显）。 */
export interface MarketDetailsInjected extends MarketRepoStatsInjected {
  openDetails: () => void
}

/**
 * 客户端插件主体：注册底部 K 线面板、右侧指数面板与页头行情按钮。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: Context): void {
  ctx.locale.register(NS, { zh, en })

  // 真实代码产出快照（repo-stats 宿主聚合）：创建一个共享 store 实例，
  // 订阅 repo/stats 事件写入；K 线/指数以真实 git 历史为数据源，无快照
  // 时留空。实例经 inject 面注入组件，组件用 useSyncExternalStore 订阅。
  const repoStats = createRepoStatsStore().create()
  ctx.on('repo/stats', (snapshot) => { repoStats.actions.set(snapshot) })
  const injectRepoStats = (): MarketRepoStatsInjected => ({ repoStats })

  // 底部代码量 K 线（conversation.bottom.panel 单席位）：数据来自真实
  // repo-stats 快照。
  ctx.slots.inject('conversation.bottom.panel', () => ctx.slots.register({
    name: 'conversation.bottom.panel',
    locale: NS,
    inject: injectRepoStats,
  }, MarketDock))

  // 右侧 DS 指数界面（conversation.details.panel 单席位）：指数卡与 K 线
  // 共用同一真实 repo-stats 实例。inject 附 openDetails，让面板挂载时默认展开。
  ctx.slots.inject('conversation.details.panel', () => ctx.slots.register({
    name: 'conversation.details.panel',
    locale: NS,
    inject: (): MarketDetailsInjected => ({ repoStats, openDetails: () => { ctx.layout.openDetails() } }),
  }, MarketDetails))

  // 会话页头紧凑行情按钮：点击打开右侧 DS 指数面板。
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'ui-market-context',
    order: 0,
    locale: NS,
    inject: (sessionId: SessionId): MarketContextInjected => ({
      sessionId,
      openDetails: () => { ctx.layout.openDetails() },
    }),
  }, MarketContextButton))

  // ths_market_snapshot 工具行（tool.call.toolview keyed 注册）：终端风格行，
  // 真实 Result 摘要，涨跌红涨绿跌；未注册此 key 时由 ui-tool 通用卡兜底。
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'ths_market_snapshot',
  }, MarketToolRow))

  // ths_market_snapshot 详情 Result 卡（conversation.details.tool keyed 注册）：
  // 详情列选中该工具调用时按真实工具名分发，渲染终端风格 Result 卡（指数/涨跌/
  // 变更行，红涨绿跌 + 表格化字段）；未注册此 key 时由详情壳层 raw-result 兜底。
  ctx.slots.inject('conversation.details.tool', () => ctx.slots.register({
    name: 'conversation.details.tool',
    key: 'ths_market_snapshot',
    locale: NS,
  }, MarketResultCard))

  // 行情投影视图页签（conversation.view 视图环）：终端大盘视图，真实会话
  // 活动投影；页签名随激活语言解析（label thunk 每次读取时求值）。
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'ths-market',
    order: 20,
    label: () => ctx.locale.bind(NS)('view.label'),
    locale: NS,
  }, MarketView))

  // 输入 dock 终端状态条（conversation.input.dock list 条目，order 0）：输入区
  // 上方的真实运行统计条（节点/Turn/调用数/Token 投影，全部来自运行时快照）。
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'ths-input-dock',
    order: 0,
  }, InputDockStrip))
}
