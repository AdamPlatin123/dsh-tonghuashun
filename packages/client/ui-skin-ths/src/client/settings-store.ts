/**
 * 皮肤行 slot store：主题服务快照中已解析活动主题的镜像。插件的 apply 世界
 * 变更监听是唯一写入者；行组件通过 props.useStore 读取。选中态镜像“当前
 * 屏幕上的”皮肤，因此系统偏好解析到内建主题（light/dark）时无瓦片选中。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** 从主题快照镜像的 store 状态。 */
export interface SkinRowState {
  /** 已解析的活动皮肤 id；活动主题为内建主题时为空串。 */
  skinId: string
  /** 服务修订号；首次同步前为 -1，使修订 0 也能落地为一次变更。 */
  revision: number
}

/** 给导出工厂稳定返回类型的声明动作形状。 */
type SkinRowActions = {
  sync: (draft: SkinRowState, skinId: string, revision: number) => void
}

/**
 * 声明皮肤行状态与写入面。
 * @returns store 句柄。
 */
export function createSkinRowStore(): EngineStoreHandle<SkinRowState, SkinRowActions> {
  return defineStore({
    init: (): SkinRowState => ({ skinId: '', revision: -1 }),
    actions: {
      sync: (d, skinId: string, revision: number) => {
        if (revision <= d.revision) { return }
        d.skinId = skinId
        d.revision = revision
      },
    },
  })
}
