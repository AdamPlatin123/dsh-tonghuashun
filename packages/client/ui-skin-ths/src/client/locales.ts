/** `settings.skins` 命名空间字典（皮肤选择行的文案）。 */

/** 简体中文字典（key 集的事实来源）。 */
export const zh = {
  'skin.title': '皮肤',
  'skin.name.ths': '同花顺终端',
  'skin.enable': '启用同花顺终端皮肤',
  'skin.enabled': '同花顺终端已启用',
  /** 消息流空态：会话尚无任何记录（真实节点为空）。 */
  'chat.empty': '无记录，等待输入…',
} satisfies Record<string, string>

/** settings.skins 命名空间的 key 联合。 */
export type SkinKey = keyof typeof zh

/** 英文词典，键集与 zh 对齐。 */
export const en = {
  'skin.title': 'Skin',
  'skin.name.ths': 'THS Terminal',
  'skin.enable': 'Enable THS terminal skin',
  'skin.enabled': 'THS terminal skin enabled',
  'chat.empty': 'No messages yet',
} satisfies Record<SkinKey, string>
