# @deepseek-ai/dsh-client-ui-skin-ths

English | [中文](README.zh.md)

同花顺终端风格皮肤插件（THS Market Skin）。它把 `ths` 主题注册进官方 ThemeService —— 受认可的第三方主题表面：令牌层将 `--dsw-alias-*` 语义映射为深蓝灰终端底色与红涨绿跌，富 CSS 在 `body[data-ds-skin="ths"]` 作用域内做方角、细边框与数字等宽化；皮肤选择行注册进设置 General 区段，卸载时全部对称回收。

## 皮肤定义

`src/client/skins.ts` 是唯一事实来源：`THS_SKIN` 包含 ThemeDefinition（id `ths`、`colorScheme: 'dark'`、令牌覆盖）与富 CSS 载荷。令牌覆盖刻意保守 —— 未列出的别名保持 DSH 基础暗色语义，避免第三方主题破坏组件布局（见 [ui-theme 的第三方主题边界](../../ui-theme/README.md)）。

## 注册与镜像

插件主体（`src/client/index.ts`）通过 `ctx.effect()` 完成三件事：

- 向 `ctx.theme.register()` 注册 `ths` 主题（重复 id 抛错，主题 backing 活动偏好时回收会重置偏好）。
- 镜像已解析的活动主题到文档：`body[data-ds-skin="ths"]` 属性与插件拥有的 `<style>` 标签；只回收自己写入的内容，绝不触碰 ui-layout ThemePresenter 拥有的 `data-ds-dark-theme` 与内联令牌变量。
- 在 `settings.general.item` 注册皮肤选择行（store 镜像主题快照，选中态跟随已解析的活动主题）。

## 用法

在 profile 的浏览器插件行中加入：

```yaml
- id: ui-skin-ths
  name: '@deepseek-ai/dsh-client-ui-skin-ths'
```

启用后到 设置 → General → 皮肤 点击“同花顺终端”。

## Model Experience

None, as the skin manages a browser-side theme; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
