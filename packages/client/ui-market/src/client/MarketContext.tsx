import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketContextInjected } from './index.ts'
import css from './MarketContext.module.css'

/** Full props of the header market button. */
export type MarketContextProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'ui-market'> & MarketContextInjected

/**
 * 页头紧凑行情按钮：展示当前投影指数标记，点击打开右侧 DS 指数面板。
 * @param props - 插槽 props。
 * @returns 按钮元素。
 */
export function MarketContextButton({ openDetails, t }: MarketContextProps) {
  return (
    <button type="button" className={css.button} data-owner="ui-market" onClick={() => { openDetails() }} title={t('header.action')}>
      <i className={css.dot} aria-hidden="true" />
      <span>DSH001</span>
      <span className={css.label}>{t('header.label')}</span>
    </button>
  )
}
