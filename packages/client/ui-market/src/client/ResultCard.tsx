/**
 * 行情工具详情 Result 卡（conversation.details.tool keyed / ths_market_snapshot）：
 * 终端风格结果卡 —— 工具名 + 真实 Result JSON 的结构化展示（指数/涨跌/变更行，
 * 红涨绿跌）+ 表格化字段。数据完全来自冻结的 tool block（Result 内容），无任何
 * mock：指数/涨跌沿用 ToolRow 的尽力解析（quotesFromJson），变更行与剩余标量
 * 字段来自同一解析结果；解析不到时回退到结果首行文本，真实记录缺失则留空。
 * 运行中/成功/失败状态仅由冻结的 call/result 切片推导。
 */
import { clsx } from 'clsx'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CHANGE_KEYS,
  CHANGE_PCT_KEYS,
  COLLECTION_KEYS,
  NAME_KEYS,
  VALUE_KEYS,
  deltaParts,
  directionOf,
  firstLine,
  firstNumber,
  quoteFrom,
  quotesFromJson,
  resultText,
  type MarketQuote,
} from './ToolRow.tsx'
import { fmt } from './market-fmt.ts'
import css from './ResultCard.module.css'

/** 详情卡生命周期，仅由冻结的 call/result 切片推导。 */
type ResultState = 'running' | 'ok' | 'error'

/** 变更行数的候选键（repo-stats 契约与常见中文键）。 */
const CHANGED_LINES_KEYS = ['changedLines', '变更行', 'changed', 'delta'] as const

/** 详情卡视图模型：状态 + 行情条目 + 变更行数 + 剩余标量字段 + 回退文本。 */
interface ResultCardModel {
  state: ResultState
  quotes: readonly MarketQuote[]
  changedLines: number | null
  fields: ReadonlyArray<{ key: string; value: string }>
  fallback: string | null
}

/** 取根记录的变更行数；没有可识别的键返回 null。 */
function changedLinesFrom(root: Record<string, unknown>): number | null {
  return firstNumber(root, CHANGED_LINES_KEYS)
}

/** 将候选键数组转为静态成员查找表（避免每次调用重建集合）。 */
function keyTable(keys: readonly string[]): Record<string, true> {
  const table: Record<string, true> = {}
  for (const key of keys) table[key] = true
  return table
}

/** 单条行情记录已被报价行消费的键。 */
const QUOTE_KEYS: Record<string, true> = keyTable([
  ...NAME_KEYS, ...VALUE_KEYS, ...CHANGE_KEYS, ...CHANGE_PCT_KEYS,
])

/** 集合根里承载行情数组的键。 */
const COLLECTION_KEYS_TABLE: Record<string, true> = keyTable(COLLECTION_KEYS)

/**
 * 根记录中未被行情条目消费的标量字段（表格化展示）。单条行情记录时跳过
 * 已被报价行消费的行情键；其余对象/数组值不进表格。
 * @param root - 解析后的根记录。
 * @param singleQuote - 根记录自身被识别为单条行情（其行情键已展示）。
 * @returns 标量字段列表（原样保留键名与字符串，数值千分位）。
 */
function scalarFields(root: Record<string, unknown>, singleQuote: boolean): ReadonlyArray<{ key: string; value: string }> {
  const skip = singleQuote ? QUOTE_KEYS : COLLECTION_KEYS_TABLE
  const out: Array<{ key: string; value: string }> = []
  for (const [key, value] of Object.entries(root)) {
    if (skip[key] === true) continue
    if (value === null || typeof value === 'object') continue
    const text = typeof value === 'string' ? value.trim()
      : typeof value === 'number' ? fmt(value)
        : JSON.stringify(value)
    if (text !== '') out.push({ key, value: text })
  }
  return out
}

/**
 * 从冻结的 call/result 切片推导详情卡视图模型。
 * @param block - 冻结的运行中调用或已结算结果节点。
 * @returns 状态 + 行情条目/变更行/字段（无识别内容时用回退文本，再无则留空）。
 */
function resultCardModel(block: ToolCallBlock): ResultCardModel {
  if (!('kind' in block)) return { state: 'running', quotes: [], changedLines: null, fields: [], fallback: null }
  const text = resultText(block)
  if (block.isError) {
    return { state: 'error', quotes: [], changedLines: null, fields: [], fallback: text !== null ? firstLine(text) : null }
  }
  if (text === null) return { state: 'ok', quotes: [], changedLines: null, fields: [], fallback: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    parsed = undefined
  }
  if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
    const quotes = quotesFromJson(parsed) ?? []
    if (Array.isArray(parsed)) {
      // 数组根：条目已全部视为行情行，无变更行/字段。
      return { state: 'ok', quotes, changedLines: null, fields: [], fallback: null }
    }
    const root = parsed as Record<string, unknown>
    // 根记录自身被识别为单条行情时，其行情键已由报价行消费，字段表跳过它们。
    const singleQuote = quoteFrom(root) !== null
    return {
      state: 'ok',
      quotes,
      changedLines: changedLinesFrom(root),
      fields: scalarFields(root, singleQuote),
      fallback: null,
    }
  }
  const trimmed = text.trim()
  return { state: 'ok', quotes: [], changedLines: null, fields: [], fallback: trimmed !== '' ? firstLine(trimmed) : null }
}

/** 详情卡组件完整 props（keyed details.tool 运行时载荷 + ui-market 文案席位）。 */
export type ResultCardProps = PropsRuntime<'conversation.details.tool'> & PropsLocale<'ui-market'>

/**
 * 渲染 ths_market_snapshot 的终端风格详情 Result 卡：工具名 + 真实结果
 * 结构化展示（指数/涨跌/变更行，红涨绿跌）+ 表格化字段。
 * @param props - keyed details.tool 载荷（冻结 block 的真实结果）+ 文案席位。
 * @returns 详情卡元素。
 */
export function MarketResultCard({ block, t }: ResultCardProps) {
  const model = resultCardModel(block)
  const toolName = 'kind' in block ? (block.call?.name ?? block.callId) : block.name
  return (
    <div className={css.card} data-tool="ths_market_snapshot" data-state={model.state}>
      <div className={css.head}>
        <i className={clsx(css.dot, css[model.state])} aria-hidden="true" />
        <span className={css.tag}>行情</span>
        <span className={css.name}>{toolName}</span>
        {model.state === 'running' ? <span className={css.running}>{t('result.running')}</span> : null}
      </div>
      {model.quotes.length > 0 ? (
        <section className={css.section} aria-label={t('result.quotes')}>
          {model.quotes.map((quote, index) => {
            const direction = directionOf(quote)
            const directionClass = direction === 1 ? css.up : direction === -1 ? css.down : css.flat
            const parts = deltaParts(quote)
            return (
              <div key={`${quote.name}:${index}`} className={css.quoteRow}>
                <span className={css.qName}>{quote.name}</span>
                <span className={clsx(css.qValue, directionClass)}>{fmt(quote.value)}</span>
                {parts.map((part, partIndex) => (
                  <span key={partIndex} className={clsx(css.delta, directionClass)}>{part}</span>
                ))}
              </div>
            )
          })}
        </section>
      ) : null}
      {model.changedLines !== null ? (
        <div className={css.statRow}>
          <span className={css.statKey}>{t('result.changedLines')}</span>
          <span className={css.statValue}>{fmt(model.changedLines)}</span>
        </div>
      ) : null}
      {model.fields.length > 0 ? (
        <section className={css.section} aria-label={t('result.fields')}>
          <table className={css.table}>
            <tbody>
              {model.fields.map(field => (
                <tr key={field.key}>
                  <th className={css.fieldKey} scope="row">{field.key}</th>
                  <td className={css.fieldValue}>{field.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {model.quotes.length === 0 && model.changedLines === null && model.fields.length === 0 ? (
        model.fallback !== null ? (
          <pre className={clsx(css.code, model.state === 'error' && css.errorText)}>{model.fallback}</pre>
        ) : model.state === 'ok' ? (
          <div className={css.empty}>{t('result.empty')}</div>
        ) : null
      ) : null}
    </div>
  )
}
