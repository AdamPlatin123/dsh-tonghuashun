/**
 * 皮肤选择行：注册进设置 General 区段 item slot 的单瓦片行。瓦片显示皮肤
 * 名称与红涨绿跌示意色块，选中态跟随“已解析的活动主题”。点击切换主题偏好。
 */
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSkinRowStore } from './settings-store.ts'
import { SKIN_ID } from './skins.ts'
import css from './SkinRow.module.css'

/** 注入的业务面：主题写入。 */
export interface SkinRowInjected {
  /** 把主题偏好切到皮肤 id。 */
  setTheme: (id: string) => void
}

/** 完整组件 props：runtime 共享 + store 共享 + locale 座位 + 注入面。 */
export type SkinRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createSkinRowStore>>
  & PropsLocale<'settings.skins'> & SkinRowInjected

/**
 * 渲染皮肤选择行。
 * @param props - 组合后的插槽 props。
 * @returns 行元素树。
 */
export function SkinRow({ t, setTheme, useStore }: SkinRowComponentProps) {
  const skinId = useStore(s => s.skinId)
  const active = skinId === SKIN_ID
  return (
    <div className={css.group}>
      <div className={css.title}>{t('skin.title')}</div>
      <button
        type="button"
        className={clsx(css.tile, active && css.selected)}
        aria-pressed={active}
        aria-label={t(active ? 'skin.enabled' : 'skin.enable')}
        onClick={() => { setTheme(SKIN_ID) }}
      >
        <span className={css.art} aria-hidden="true">
          <span className={css.up} />
          <span className={css.down} />
        </span>
        <span className={css.tileMeta}>
          <span className={css.name}>{t('skin.name.ths')}</span>
          <span className={css.state}>{t(active ? 'skin.enabled' : 'skin.enable')}</span>
        </span>
      </button>
    </div>
  )
}
