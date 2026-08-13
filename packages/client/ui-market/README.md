# @deepseek-ai/dsh-client-ui-market

English | [中文](README.zh.md)

行情功能插件（Market plugin）：把 DS 指数与代码量 K 线做成真实可用的界面组件。它占用两个上游扩展缝 —— `conversation.bottom.panel`（代码量日 K 线停靠）与 `conversation.details.panel`（右侧 DS 指数炒股界面）。所有数字来自运行时会话的确定性派生投影（`src/client/market-data.ts`）：节点数、turn 计时与会话列表是真实 DSH 数据，指数值由它们映射，并统一标注 LOCAL PROJECTION；本插件不引入任何证券数据供应商，也不伪装实时行情。

## 数据派生

`deriveMarket(sessions, facts, currentId)` 是纯函数：相同输入必得相同输出。

| 界面元素 | 真实数据源 |
|---|---|
| 指数值 | 会话数 + 当前会话节点数 + 进行中调用数 |
| 会话步数 | 当前会话真实节点数 |
| 变更行 | 节点数 × 投影刻度 |
| 分时变更 | turnTimings（真实 turn 事件与耗时） |
| 五档 | 会话列表按活跃度排序（最多 5 行） |
| 日 K | 30 根确定性序列，最后一天锚定当前指数 |

## 席位注册

- `conversation.bottom.panel` → `MarketDock`：Canvas 蜡烛、均线、十字线，周期页签（日K/分时）。
- `conversation.details.panel` → `MarketDetails`：指数卡、五档、变更明细、Token 流页签。

两个插槽均为上游 `ui-conversation` 新增的默认空单席位：无 occupant 时原生详情/布局完全不变。

## 用法

在 profile 的浏览器插件行中加入：

```yaml
- id: ui-market
  name: '@deepseek-ai/dsh-client-ui-market'
```

配合 `ui-skin-ths` 皮肤时呈现完整同花顺终端视觉。

## Model Experience

None — market data derives from the live session runtime; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
