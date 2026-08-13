/**
 * 行情工具行（tool.call.toolview / ths_market_snapshot）：终端风格单行视图。
 * 数据完全来自冻结的 tool block（Result 内容），无任何 mock：指数/涨跌从
 * 真实 result 文本尽力解析（JSON 数组/对象内的行情条目），解析不到时回退到
 * 结果首行文本，真实记录缺失则留空。涨跌红涨绿跌（跟随 THS 皮肤的
 * success/error 语义互换，与 MarketDetails 同一约定）。行生命周期
 * （运行中/成功/失败）仅由冻结的 call/result 切片推导。
 */
import { clsx } from 'clsx'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { fmt } from './market-fmt.ts'
import css from './ToolRow.module.css'

/** 行生命周期，仅由冻结的 call/result 切片推导。 */
type ToolRowState = 'running' | 'ok' | 'error'

/** 一条可展示的行情条目（来自真实 result 的尽力解析）。 */
export interface MarketQuote {
  name: string
  value: number
  change: number | null
  changePct: number | null
}

/** 行视图模型：状态 + 行情条目列表（无条目时用回退文本，再无则留空）。 */
interface MarketToolRowModel {
  state: ToolRowState
  quotes: readonly MarketQuote[]
  fallback: string | null
}

/** 行情条目的候选键（wire 工具尚无定型契约，按常见键尽力解析）。 */
export const NAME_KEYS = ['name', 'title', 'symbol', 'code', 'index', '名称', '指数'] as const
export const VALUE_KEYS = ['value', 'price', 'close', 'last', 'now', '最新价', '现价', '点位'] as const
export const CHANGE_KEYS = ['change', 'delta', 'diff', '涨跌'] as const
export const CHANGE_PCT_KEYS = ['changePct', 'pct', 'percent', 'chg', '涨跌幅'] as const
export const COLLECTION_KEYS = ['quotes', 'indices', 'indexes', 'market', 'list', 'data', '行情', '指数'] as const

/** 数字化：接受 number 或可解析的字符串（去掉千分位/百分号/空白）。 */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,，\s%]/g, '')
    if (cleaned === '') return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 取记录中第一个命中键的字符串值（trim 后非空）。 */
export function firstString(rec: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = rec[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

/** 取记录中第一个命中键的数值。 */
export function firstNumber(rec: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = toNumber(rec[key])
    if (value !== null) return value
  }
  return null
}

/** 从一条未知记录里提取行情条目；缺名称或数值则视为非行情条目。 */
export function quoteFrom(value: unknown): MarketQuote | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  const name = firstString(rec, NAME_KEYS)
  const price = firstNumber(rec, VALUE_KEYS)
  if (name === null || price === null) return null
  return {
    name,
    value: price,
    change: firstNumber(rec, CHANGE_KEYS),
    changePct: firstNumber(rec, CHANGE_PCT_KEYS),
  }
}

/** 收集数组里的行情条目。 */
export function collectQuotes(items: readonly unknown[]): MarketQuote[] {
  const out: MarketQuote[] = []
  for (const item of items) {
    const quote = quoteFrom(item)
    if (quote !== null) out.push(quote)
  }
  return out
}

/** 从解析后的 result JSON 中提取行情条目列表；没有可识别的条目返回 null。 */
export function quotesFromJson(root: unknown): MarketQuote[] | null {
  if (Array.isArray(root)) {
    const quotes = collectQuotes(root)
    return quotes.length > 0 ? quotes : null
  }
  if (typeof root === 'object' && root !== null) {
    const rec = root as Record<string, unknown>
    for (const key of COLLECTION_KEYS) {
      const value = rec[key]
      if (Array.isArray(value)) {
        const quotes = collectQuotes(value)
        if (quotes.length > 0) return quotes
      }
    }
    const single = quoteFrom(root)
    if (single !== null) return [single]
  }
  return null
}

/** 摊平结算结果的内容块为文本（与 ui-tool tool-call-model 的 resultText 对齐）。 */
export function resultText(block: ToolCallBlock): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** 结果文本首行（错误摘要与回退展示用）。 */
export function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/**
 * 从冻结的 call/result 切片推导行视图模型。
 * @param block - 冻结的运行中调用或已结算结果节点。
 * @returns 状态 + 行情条目（或回退文本，再无则留空）。
 */
function marketToolRowModel(block: ToolCallBlock): MarketToolRowModel {
  if (!('kind' in block)) return { state: 'running', quotes: [], fallback: null }
  const text = resultText(block)
  if (block.isError) {
    return { state: 'error', quotes: [], fallback: text !== null ? firstLine(text) : null }
  }
  if (text === null) return { state: 'ok', quotes: [], fallback: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    // 非 JSON 文本（普通文本摘要）：走 fallback。
    parsed = undefined
  }
  if (parsed !== undefined) {
    // 真实 JSON 记录：能识别出行情条目就展示，识别不出按「留空」处理。
    const quotes = parsed !== null ? quotesFromJson(parsed) : null
    return { state: 'ok', quotes: quotes ?? [], fallback: null }
  }
  const trimmed = text.trim()
  return { state: 'ok', quotes: [], fallback: trimmed !== '' ? firstLine(trimmed) : null }
}

/** 行情条目方向：涨/跌/平。 */
export function directionOf(quote: MarketQuote): 1 | -1 | 0 {
  const delta = quote.change ?? quote.changePct
  if (delta === null) return 0
  return delta > 0 ? 1 : delta < 0 ? -1 : 0
}

/** 涨跌摘要片段（变化值与涨跌幅，缺哪个不渲染哪个）。 */
export function deltaParts(quote: MarketQuote): string[] {
  const parts: string[] = []
  if (quote.change !== null) {
    parts.push(`${quote.change > 0 ? '+' : ''}${fmt(quote.change)}`)
  }
  if (quote.changePct !== null) {
    parts.push(`${quote.changePct > 0 ? '+' : ''}${quote.changePct.toFixed(2)}%`)
  }
  return parts
}

/**
 * 渲染 ths_market_snapshot 的终端风格工具行：状态点 + 「行情」标签 + 工具名
 * + 真实结果摘要（指数/涨跌，红涨绿跌）。
 * @param props - keyed toolview 载荷（冻结 block 的真实结果）。
 * @returns 工具行元素。
 */
export function MarketToolRow({ toolName, block }: ToolCallViewProps) {
  const model = marketToolRowModel(block)
  return (
    <div className={css.row} data-tool="ths_market_snapshot" data-state={model.state}>
      <i className={clsx(css.dot, css[model.state])} aria-hidden="true" />
      <span className={css.tag}>行情</span>
      <span className={css.name}>{toolName}</span>
      <span className={css.sep} aria-hidden="true">·</span>
      {model.quotes.length > 0 ? (
        <span className={css.summary}>
          {model.quotes.map((quote, index) => {
            const direction = directionOf(quote)
            const directionClass = direction === 1 ? css.up : direction === -1 ? css.down : css.flat
            const parts = deltaParts(quote)
            return (
              <span key={`${quote.name}:${index}`} className={css.quote}>
                <span className={css.qName}>{quote.name}</span>
                <span className={clsx(css.qValue, directionClass)}>{fmt(quote.value)}</span>
                {parts.map((part, partIndex) => (
                  <span key={partIndex} className={clsx(css.delta, directionClass)}>{part}</span>
                ))}
              </span>
            )
          })}
        </span>
      ) : model.fallback !== null ? (
        <span className={clsx(css.summary, model.state === 'error' && css.errorText)}>{model.fallback}</span>
      ) : null}
    </div>
  )
}
