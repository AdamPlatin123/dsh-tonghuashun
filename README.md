# DSH THS Skin · 同花顺终端皮肤

[![topic](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

DeepSeek Harness（DSH）客户端插件：同花顺行情终端风格的皮肤 + 代码量 K 线行情面板。

## 包含包

| 包 | 说明 |
|---|---|
| `@deepseek-ai/dsh-client-ui-skin-ths` | 终端皮肤：红涨绿跌令牌、终端化富 CSS、设置选择行 |
| `@deepseek-ai/dsh-client-ui-market` | 行情面板：代码量日 K 线 dock、DS 指数 details、工具 Result 卡 |

## 功能

- **红涨绿跌语义令牌**：`skins.ts` 的 `THS_TOKENS` 覆盖 `--dsw-alias-*` 层，对齐同花顺行情终端视觉（红涨绿跌、品牌蓝、终端深蓝灰底、方角等宽）。
- **终端化 UI 接管**：顶栏行情条（TopChrome）、侧栏（TerminalSidebar）、消息流气泡（TerminalChat）、composer 输入卡（TerminalInput）、底部状态条（BottomChrome）。
- **可调高度 K 线面板**：`MarketDock` 内置 `market-resizer`（pointer capture 拖动 + 键盘方向键 + ARIA separator），高度 clamp 220–340px。
- **右侧详情默认展开**：`MarketDetails` 挂载即调用 `ctx.layout.openDetails()`，非空会话自动展开详情列，无需手动点开。

## 使用

这两个包是 DSH harness 的 workspace 插件，依赖 `@deepseek-ai/dsh-*` workspace 包与共享构建配置（`packages/client/tsdown.client.ts`）。

将 `packages/client/ui-skin-ths` 与 `packages/client/ui-market` 放入 DSH harness 仓库的 `packages/client/` 下，然后在产品 `cordis.patch.yml` 注册：

```yaml
 - id: ui-skin-ths
   name: '@deepseek-ai/dsh-client-ui-skin-ths'
 - id: ui-market
   name: '@deepseek-ai/dsh-client-ui-market'
```

皮肤在 General 设置区切换（`SkinRow` 注册到 `settings.general.item` 插槽）。行情面板自动挂载到 `conversation.bottom.panel`（K 线）与 `conversation.details.panel`（指数详情）。

## 开发

```sh
pnpm install          # 在 DSH harness workspace 内
pnpm run typecheck    # 类型检查
pnpm run build        # tsc emits lib/types + tsdown bundles runtime
```

单包测试：`vitest run packages/client/ui-skin-ths packages/client/ui-market`。

## 许可

MIT
