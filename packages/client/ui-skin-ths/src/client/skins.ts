/**
 * 同花顺终端皮肤（THS Market Skin）定义：一个 ThemeDefinition（注册进官方
 * ThemeService —— 第三方主题表面）加可选富 CSS 载荷。令牌层把 DSH 语义别名
 * 映射为深蓝灰终端底色与红涨绿跌；富 CSS 在 `body[data-ds-skin="ths"]`
 * 作用域内做方角、细边框与数字等宽化，全部可随卸载对称回收。
 */
import type { ThemeDefinition } from '@deepseek-ai/dsh-client-ui-theme/client'

/** 皮肤 id：注册进 ThemeService 的主题 id（唯一，非 system/light/dark）。 */
export const SKIN_ID = 'ths'

/** 皮肤显示名 key（必须存在于 settings.skins 字典）。 */
export type SkinKey = 'skin.title' | 'skin.name.ths' | 'skin.enable' | 'skin.enabled'

/** 同花顺红（涨）—— demopage --up。 */
const UP = '#ef5c64'
/** 涨亮 —— demopage --up-bright（指数大数、亮强调）。 */
const UP_BRIGHT = '#ff7178'
/** 同花顺绿（跌）—— demopage --down。 */
const DOWN = '#1fc67e'
/** 跌亮 —— demopage --down-bright（状态点、亮强调）。 */
const DOWN_BRIGHT = '#35df95'
/** 行情红 —— demopage --market（顶栏、页签下划线、发送按钮、图表 active tab）。 */
const MARKET = '#b72733'
/** 行情红暗调 —— demopage --market-dark。 */
const MARKET_DARK = '#98202a'
/** 品牌蓝 —— demopage --brand（侧栏 DS 方块、选中左边条、folder、new-session glyph）。 */
const BRAND = '#5d83f7'
/** 深蓝灰终端底色 —— demopage --bg/--panel/--panel-2/--panel-3。 */
const BG_BASE = '#0b1017'
const BG_L1 = '#101722'
const BG_L2 = '#141c28'
const BG_L3 = '#182230'
/** 终端细边框 —— demopage --line-soft/--line，及选中边的 #34435c。 */
const BORDER_L1 = '#1c2635'
const BORDER_L2 = '#263145'
const BORDER_L3 = '#34435c'

/**
 * 别名令牌覆盖：映射到 --dsw-alias-* 层，由 ui-layout 的 ThemePresenter
 * 作为 body 内联变量应用。覆盖集合刻意保守 —— 未列出的令牌保持 DSH 基础
 * 暗色语义，避免第三方皮肤造成不可预期的 UI 破坏。
 */
export const THS_TOKENS: ThemeDefinition['tokens'] = {
  // 红涨绿跌：交换 success（涨）/error（跌）语义颜色，对齐 demopage --up/--down。
  '--dsw-alias-state-success-primary': UP,
  '--dsw-alias-state-success-secondary': UP_BRIGHT,
  '--dsw-alias-state-success-tertiary': 'rgba(239,92,100,0.16)',
  '--dsw-alias-state-error-primary': DOWN,
  '--dsw-alias-state-error-secondary': DOWN_BRIGHT,
  '--dsw-alias-interactive-bg-hover-danger': 'rgba(31,198,126,0.16)',
  // 品牌主色收敛为品牌蓝（DS 方块 / 选中边条）；按钮主色用行情红（发送）。
  '--dsw-alias-brand-primary': BRAND,
  '--dsw-alias-button-primary-fill': MARKET,
  '--dsw-alias-button-primary-hover': '#d13946',
  '--dsw-alias-button-primary-dimmed': MARKET_DARK,
  // 业务强调（页签下划线、链接、图表 active tab）对齐 demopage --market。
  '--dsw-alias-state-business-primary': MARKET,
  '--dsw-alias-state-business-tertiary': 'rgba(183,39,51,0.14)',
  // 终端深蓝灰背景与蓝灰边框，对齐 demopage --bg/--panel*/--line*。
  '--dsw-alias-bg-base': BG_BASE,
  '--dsw-alias-bg-layer-1': BG_L1,
  '--dsw-alias-bg-layer-2': BG_L2,
  '--dsw-alias-bg-layer-3': BG_L3,
  '--dsw-alias-bg-module-platform': BG_L2,
  '--dsw-alias-bg-overlay': '#1c2635',
  '--dsw-alias-border-inverted': BORDER_L1,
  '--dsw-alias-border-l1': BORDER_L1,
  '--dsw-alias-border-l2': BORDER_L2,
  '--dsw-alias-border-l3': BORDER_L3,
  // 文字层级压暗，对齐 demopage --text/--dim/--faint。
  '--dsw-alias-label-primary': '#dce3ee',
  '--dsw-alias-label-secondary': '#909caf',
  '--dsw-alias-label-tertiary': '#5f6c80',
  '--dsw-alias-label-caption': '#5f6c80',
  '--dsw-alias-label-dimmed': '#46536a',
  // 交互悬停/激活：低对比蓝灰高亮，accent 保持品牌蓝。
  '--dsw-alias-interactive-bg-hover': 'rgba(255,255,255,0.05)',
  '--dsw-alias-interactive-bg-active': 'rgba(255,255,255,0.10)',
  '--dsw-alias-interactive-bg-hover-accent': 'rgba(93,131,247,0.18)',
  '--dsw-alias-interactive-bg-hover-solid': BG_L2,
  // 滚动条细窄蓝灰，对齐 demopage #2a364a。
  '--dsw-alias-scrollbar-bg-l1': '#2a364a',
  '--dsw-alias-scrollbar-bg-l2': '#2a364a',
  '--dsw-alias-scrollbar-hover-l1': '#34435c',
  '--dsw-alias-scrollbar-hover-l2': '#34435c',
  // 会话气泡、输入区、侧栏、菜单等专属表面。
  '--dsw-specific-bubble': BG_L1,
  '--dsw-specific-bubble-highlight': BG_L2,
  '--dsw-specific-input-major': BG_L1,
  '--dsw-specific-sidebar-fill': BG_L1,
  '--dsw-specific-sidebar-nav-item-active': '#141e2b',
  '--dsw-specific-sidebar-nav-item-active-accent': '#182230',
  '--dsw-specific-sidebar-nav-item-hover': '#121a28',
  '--dsw-specific-menu': BG_L3,
  '--dsw-specific-selector': BG_L2,
  '--dsw-specific-tip': BG_L3,
  '--dsw-alias-toast-bg': '#1c2635',
  '--dsw-alias-tooltip-bg': '#1c2635',
}

/**
 * 富 CSS 载荷：皮肤激活时注入 <style>，作用域固定在 body[data-ds-skin="ths"]。
 * 只做方角、细边框、数字等宽与终端感微调，不触碰组件布局结构。
 */
export const THS_CSS = `
body[data-ds-skin="ths"] {
  /* 终端方角：去掉圆形控件。 */
  --dsh-radius-control: 0;
  --dsh-radius-panel: 0;
  --dsh-radius-bubble: 0;
}
/* 全组件方角：设计稿为方角/极小圆角终端风格。 */
body[data-ds-skin="ths"] * {
  border-radius: 0;
}
/* 数字与代码区域使用等宽终端字体。 */
body[data-ds-skin="ths"] [class*="num"],
body[data-ds-skin="ths"] [class*="code"],
body[data-ds-skin="ths"] [class*="mono"],
body[data-ds-skin="ths"] [class*="terminal"],
body[data-ds-skin="ths"] [class*="token"],
body[data-ds-skin="ths"] pre,
body[data-ds-skin="ths"] code {
  font-family: var(--ds-font-family-code);
  font-variant-numeric: tabular-nums;
}
/* 细边框与紧凑间距：组件外框统一 1px 蓝灰细线。 */
body[data-ds-skin="ths"] [class*="panel"],
body[data-ds-skin="ths"] [class*="card"],
body[data-ds-skin="ths"] [class*="bubble"],
body[data-ds-skin="ths"] [class*="menu"],
body[data-ds-skin="ths"] [class*="input"],
body[data-ds-skin="ths"] [class*="search"],
body[data-ds-skin="ths"] [class*="button"] {
  border-color: ${BORDER_L1};
  border-width: 1px;
}
/* 侧栏终端化：导航项紧凑、选中项红色左边条。 */
body[data-ds-skin="ths"] [class*="item"][class*="selected"],
body[data-ds-skin="ths"] [class*="row"][class*="selected"],
body[data-ds-skin="ths"] [aria-selected="true"][class*="item"],
body[data-ds-skin="ths"] [aria-selected="true"][class*="row"] {
  box-shadow: inset 2px 0 0 ${BRAND};
}
/* 中栏消息流：助手消息顶部细分隔线（对齐设计稿）。 */
body[data-ds-skin="ths"] [class*="assistant"],
body[data-ds-skin="ths"] [class*="message"] {
  border-radius: 0;
}
/* 输入区：方形输入卡。 */
body[data-ds-skin="ths"] [class*="composer"],
body[data-ds-skin="ths"] [class*="inputBar"],
body[data-ds-skin="ths"] textarea {
  border-radius: 0;
}
/* 红涨绿跌的强调：hover 危险操作保持绿调（语义为“跌”），对齐 --down。 */
body[data-ds-skin="ths"] [data-ds-danger],
body[data-ds-skin="ths"] [class*="danger"]:hover {
  background: rgba(31,198,126,0.12);
}
`

/**
 * 皮肤定义：注册进 ThemeService 的完整 ThemeDefinition（id/colorScheme/tokens）
 * 加富 CSS 载荷。colorScheme 固定 dark —— 终端视觉建立在暗色基座上。
 */
export const THS_SKIN: Readonly<{ definition: ThemeDefinition; css: string }> = Object.freeze({
  definition: Object.freeze({
    id: SKIN_ID,
    colorScheme: 'dark',
    tokens: THS_TOKENS,
  }),
  css: THS_CSS,
})
