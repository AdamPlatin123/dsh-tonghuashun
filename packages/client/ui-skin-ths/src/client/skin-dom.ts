/**
 * 皮肤 DOM 镜像：把活动主题 id 投影到文档 —— `body[data-ds-skin]` 属性与
 * 本插件拥有的 <style> 标签（携带皮肤的富 CSS）。纯 DOM 写入，无 React。
 * 只回收自己写的内容：ui-layout 的 ThemePresenter 拥有
 * `data-ds-dark-theme` 与内联令牌变量，本模块绝不触碰它们。
 */
import { THS_SKIN } from './skins.ts'

/** 皮肤作用域属性：皮肤 CSS 的挂载钩子。 */
export const SKIN_ATTRIBUTE = 'data-ds-skin'

/** 本插件拥有的样式标签固定 id。 */
export const SKIN_STYLE_ID = 'ui-skin-ths/active'

/** 皮肤 id 常量：只有本皮肤（非 ths 主题一律视为未激活）。 */
const SKIN_ID = THS_SKIN.definition.id

/**
 * 把活动皮肤 id 应用到文档：设置（或移除）皮肤属性并刷新注入的样式表。
 * 可安全重复调用。
 * @param activeId - 主题快照中的已解析活动主题 id。
 */
export function applySkinDom(activeId: string): void {
  if (typeof document === 'undefined') return
  const body = document.body
  const existing = document.getElementById(SKIN_STYLE_ID)
  const active = activeId === SKIN_ID
  if (!active) {
    body.removeAttribute(SKIN_ATTRIBUTE)
    existing?.remove()
    return
  }
  body.setAttribute(SKIN_ATTRIBUTE, SKIN_ID)
  if (existing === null) {
    const tag = document.createElement('style')
    tag.id = SKIN_STYLE_ID
    tag.dataset.plugin = 'ui-skin-ths'
    tag.textContent = THS_SKIN.css
    document.head.appendChild(tag)
  } else if (existing.textContent !== THS_SKIN.css) {
    existing.textContent = THS_SKIN.css
  }
}

/** 回收本模块写入的一切：皮肤属性与样式标签。 */
export function retractSkinDom(): void {
  if (typeof document === 'undefined') return
  document.body.removeAttribute(SKIN_ATTRIBUTE)
  document.getElementById(SKIN_STYLE_ID)?.remove()
}
