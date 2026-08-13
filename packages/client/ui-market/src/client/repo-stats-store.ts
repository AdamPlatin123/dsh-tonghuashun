/**
 * repo-stats 快照 store：订阅 `repo/stats` 事件（宿主 git 聚合的真实代码
 * 产出），组件经 useStore 读取。无快照时保持 undefined（真实记录缺失留空）。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { RepoStatsSnapshot } from '@deepseek-ai/dsh-repo-stats'

/** Store 状态：最新一次真实 repo-stats 快照。 */
/** store 句柄类型（PropsStore 消费）。 */
/** store 实例类型（inject 面注入组件；组件经 useSyncExternalStore 订阅）。 */
export type RepoStatsInstance = ReturnType<RepoStatsStore['create']>

/** store 句柄类型（PropsStore 消费）。 */
export type RepoStatsStore = ReturnType<typeof createRepoStatsStore>

export interface RepoStatsState {
  /** 最新快照；尚未收到任何发布时为 undefined（留空，不伪造）。 */
  snapshot: RepoStatsSnapshot | undefined
  /** 已见快照计数（供组件做变更去重）。 */
  revision: number
}

/** 声明动作形状。 */
type RepoStatsActions = {
  set: (draft: RepoStatsState, snapshot: RepoStatsSnapshot) => void
}

/**
 * 声明 repo-stats 状态与写入面。
 * @returns store 句柄。
 */
export function createRepoStatsStore(): EngineStoreHandle<RepoStatsState, RepoStatsActions> {
  return defineStore({
    init: (): RepoStatsState => ({ snapshot: undefined, revision: 0 }),
    actions: {
      set: (d, snapshot: RepoStatsSnapshot) => {
        d.snapshot = snapshot
        d.revision += 1
      },
    },
  })
}
