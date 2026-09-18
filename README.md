# DeepSeek Harness 同花顺皮肤

标准 Harness 插件，包含主题、项目 K 线和持久统计。兼容目标为 DSH Desktop 2.0.5 内置的 Harness 0.1.2-rc.1，以及同版网页客户端。

K 线位于可收起的右侧栏，默认宽 360px、高 260px，逐步修改与 Token 账本纵向排列。宽屏采用宿主详情栏并支持宿主拖动调宽；窄屏默认收起，顶栏按钮打开右侧抽屉。行情内可切回工具详情，选择新的工具记录也会归还宿主详情栏。

宿主头部的行情条按可用宽度分级收缩：始终保留代码总量与状态点，「最近修改」「Token 累计」与品牌依次让位，插件自身内容上限为 42vw。宿主的 `headerUtilities` 是 `flex:none`、不会为插件收缩，插件只能压缩自己的内容，以免把宿主标题挤到文字重叠。

## K 线口径

- **连续柱流**：逐笔记录、外部校准与「当前状态」锚点按时间排序后首尾相接，每根的 `open` 严格等于上一根的 `close`。因此所有代码行数变化要么归属 Agent（红绿柱），要么显式画成灰色「未归属」柱，不存在图上无解释的断口。末根是零高度的当前状态柱，收盘永远等于顶栏的「项目代码总量」。
- **逐步**：每一笔变化各占一根，等距排列，同一秒内的多笔也不会互相覆盖，逐笔可数（横轴是序号，刻度文字与详情显示该笔的真实时间）。页脚标注「每笔一根」。
- **分时**：横轴是真实时间。槽位宽度取「事件间隔中位数」与「跨度 / 目标点数」中较粗的一个（1s、2s、…、10min），空槽用空白点补齐，柱子的横向位置因此严格对应真实时间——不再把 4.4 天的跨度压成 38 个等距刻度。同一槽位内的记录合并成一根，均线在空槽承接上一根收盘。默认展示最近 240 个槽位，可拖动或点「显示全部」；末尾长时间空闲折叠成固定几个槽位，页脚标注「空闲已折叠」。
- **日 / 周 / 月**：按 UTC 日历聚合，周从周一开始。每根的高低取组内所有柱（含未归属柱）的极值，并保证 `低 ≤ min(开,收) ≤ max(开,收) ≤ 高`，与相邻柱首尾相接。
- **纵轴**：三档口径，页脚始终显示当前用的是哪一档。
  - **绝对行数**：项目真实总量。
  - **相对基线**：总量减去基线，只去掉固定锚点。
  - **每笔变化**：每根柱自己的净变化，0 居中。**总量漂移几百万行时，前两档会把几十行的真实改动压成 0 像素**——因为纵轴画的是「总量」而不是「这次改了多少」；这一档让改动量本身决定高度。
- **仅 Agent 筛选**：勾选后只画 Agent 归属柱。外部校准（漂移）动辄几百万行，会把小改动一起压扁；筛选后纵轴只按 Agent 柱计算。实测 `C:/Users/Calx` 的默认视口里，一笔 20 行改动从 **0.00 px** 变成 **36.50 px**（轴跨度 2,318,065 → 137 行）。这是筛选，不是缩放，被隐藏的柱不参与纵轴。
- **空 / 满**：颜色表涨跌方向，空/满表归属。**实心 = Agent 归属改动**（红涨绿跌），**空心 = 未归属**（外部校准、补齐的漂移）与**当前状态锚点**（灰/金）。实现上靠轻量图表的逐根 `color`：不透明即实心，`transparent` 只留边框即空心；边框由 `borderVisible: true` 打开（系列级开关，不能逐根控制）。注意空心内腔 ≈ `0.8 × 柱间距 − 2px`，所以初始可见根数按每根 8px 折算；缩放到柱宽 ≤ 4px 时空/满这层信息会消失，此时柱体会退化为纯描边。
- **标注**：大额变动（≥1000 行）的标记符号始终保留；文字只在屏幕空间里互不重叠时才画——同一侧从最新一根开始贪心让位，面板窄于 220px 时只留符号，完整数字仍可在悬停详情行读到。缩放、平移、改变尺寸都会重排。
- 成功 `write` / `edit` 结果中的实际前后内容形成一笔记录；`str_replace_editor` 按明确编辑参数和磁盘核验采集。新增红、删除绿；删除 10,000 行显示长绿柱与数值标注。恢复旧内容保留为新记录。
- 修改量等于新增加删除；净零编辑仍有成交量。
- 统计常见源码、文档、`.txt` 与配置文本；排除依赖、构建产物、锁文件、二进制、链接目录及不支持编码。纵轴采用这一文本行数口径。
- 首次打开和手动刷新扫描项目；逐笔只核对本次工具修改的文件。其他文件的外部变化在重新扫描时校准，并作为未归属柱进入图表。

## Git 忽略规则

统计以 `git ls-files --cached --others --exclude-standard` 为准：**已跟踪文件永远计入，被忽略的未跟踪文件不计入**。

- 未跟踪文件被写进 `.gitignore` → 立刻退出统计，总量变化记为一次外部校准，并作为灰色未归属柱画出来；此前的 K 线保持历史不变。
- 已跟踪文件被写进 `.gitignore` → 没有任何影响，`gitignore` 不会取消跟踪，需要 `git rm --cached` 才退出。
- 内层项目即使自己没有 `.gitignore`，也会受上层仓库、`.git/info/exclude` 和全局 `core.excludesFile` 的规则影响。
- 修改一个已被忽略的文件不会产生 K 线；此时「数据状态」会列出 `git-ignored-source-excluded:<文件>`，不再静默丢弃。
- git 不可用或清单超过 32 MB 时退回文件系统遍历，忽略规则不再生效，状态里标记 `gitignore-rules-not-applied`；两种口径之间的切换会单独记一次校准，原因写成 `…:scan-mode-<旧>-to-<新>`。
- 整批路径只取一次 git 清单，不再按文件重复调用 git；局部扫描在 git 不可用时失败即止，不会把被忽略文件的行数并进总量。

## Token 口径

- Token 按宿主提供者记录保存未缓存输入、缓存读取、缓存写入、输出及其中推理。推理不重复加入总量；未知字段显示 `--`，同时保留已知小计。
- 同次请求的更新替换旧样本；重试单独累计；分叉会话的继承记录不重复计费。删除会话不删除本账本中的统计。
- 清理统计需二次确认，重建基线并保存历史水位线，防止再次回填已清理的 Token。

## 边界

旧日志不足以恢复每次操作后的项目实际总代码量，因此历史 K 线从首次扫描开始。历史 Token 可从当前项目的宿主事件回填。

Shell 命令没有宿主级文件归属证据，当前不会仅凭命令成功就生成 Agent K 线；实际总量会重扫校准，并作为未归属柱显示，在数据状态中标注。人工/外部变化独立校准，不伪装成 Agent 贡献。

一个账本由一个 Host 进程写入，独占锁阻止第二个 Host 静默覆盖。网页和桌面连接同一个本机 Host 时共用数据。独立 Host 应配置不同 `dataDir`。统计路由只接受本机同源请求，不对远程网络暴露。

## 开发与预览

```sh
npm install
npm test
npm run build
npm run dev
```

默认预览地址为 `http://127.0.0.1:4317`；端口占用时自动递增。预览操作仅修改 `output/acceptance-project/src/ledger.js`，数据在 `work/preview-data`，不访问真实会话，不生成假 Token。「外部改动 250 行」直接落盘、不经过工具采集，用来演示灰色未归属柱与外部校准；「删除 / 恢复 10,000 行」走真实工具采集，用来演示 Agent K 线。

测试 `installed-host.test.mjs` 使用本机安装的实际 Cordis、主题和插槽注册器做隔离加载/卸载检查；未安装该宿主的机器上自动跳过。它同时挂载 Profile 里实际部署的那份客户端包，确保部署件本身可加载、可卸载。预览页的终端外框仅用于视觉验收，正式插件保留原宿主导航、聊天和工具详情。

## 安装到 DSH

构建后运行 `npm pack` 生成 `dsh-tonghuashun-0.3.4.tgz`。通过 DSH 官方插件命令加入目标 Profile（workspace Profile 需 `-w`）：

```sh
dsh plugin --profile desktop add -w "./dsh-tonghuashun-0.3.4.tgz"
```

本机没有全局 `dsh` 时，可使用已安装入口：

```powershell
node "work/install-profile.mjs"
```

本机安装助手使用 DSH 自带 pnpm，避免系统旧版与 Profile 依赖结构不兼容。此操作会修改目标 Profile 的依赖与插件配置；2026-09-06 已确认安装，2026-09-12 已确认升级至 0.3.4。应用重新加载后在常规设置中切换“同花顺风格皮肤”。默认启用，关闭或卸载会还原主题覆盖及附加面板，不改变宿主浅色/深色偏好。

## 包结构（dsh-plugin 规范）

`npm pack` 只收运行时产物，共 9 个文件：`dist/index.js`、`dist/client.js`、`dist/styles.css`、`dist/THIRD_PARTY_NOTICES.txt`、`cordis.patch.yml`、`dsh-plugin.json`、`package.json`、`README.md`、`LICENSE`。开发用的 `dist/preview.js` 与 sourcemap **不进包**（0.3.3 因为整目录收 `dist` 而把包撑到 865 KB，现在 106 KB）；预览仍由工作区的 `npm run dev` 直接读本地 `dist/`。

清单字段与官方插件的约定一致：

- `dsh.bundle.patch` → `./cordis.patch.yml`（loader 插入一行 `id: tonghuashun / name: dsh-tonghuashun`）；
- `dsh.client.platform` = `web`，`immediately: true`；
- `exports["./client"]` → `./dist/client.js`：`dsh-client-modules` 靠它解析客户端入口，缺了会直接报错；
- `dsh.client.inject` = 需要其服务的客户端插件行；
- `dsh.client.external` = 打包时外置、运行时由模块表提供的模块，**只列真正 `require` 的那个：`react`**（esbuild 用经典 JSX 转换，`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis` 都不出现在客户端包里）。
- `dsh-plugin.json`（`manifestVersion: 0.15`）记录 host/client 双面入口、权限与订阅。**注意：本机 DSH 里没有任何代码读它**（已全盘检索 `manifestVersion`／`facets`／`dsh-plugin.json`），它是照本机唯一一个第三方插件 `dsh-thermal-receipt` 的同名清单写的；若你手里有更权威的规范或校验器，按它调整即可。

0.2.1 修复用户主目录作为工作区时的扫描失败：排除 AppData、Agent 数据和应用缓存；不可读子目录及文件单独记为警告，可读范围仍能建立统计基线。

宿主账本默认保存在 `DSH_HOME/statistics/tonghuashun/ledger.json`，未配置 DSH_HOME 时为 `~/.dsh/statistics/tonghuashun/ledger.json`。可在插件配置中设置 `dataDir`。建议备份该目录；导出按钮提供当前项目 JSON。

## 授权与仓库沿革

MIT，Copyright (c) 2026 AdamPlatin123。仓库：<https://github.com/AdamPlatin123/dsh-tonghuashun>。

2026-08-13 的初始提交是该项目的早期实现：TypeScript monorepo，`packages/client/ui-market` + `ui-skin-ths`，清单字段用的是旧名 `dshClient`。自 **0.3.4** 起该仓库内容替换为当前的单包插件实现；早期实现仍可在仓库历史（`9f55d39`）中取回。

图表使用 Lightweight Charts，Apache-2.0；保留 TradingView 图表归属链接。Lucide 图标为 ISC。依赖许可见打包的 THIRD_PARTY_NOTICES。
