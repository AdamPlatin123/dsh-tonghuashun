# DSH 同花顺皮肤完成度审计

审计日期：2026-09-06。对象：AdamPlatin123/dsh-tonghuashun 的本次下载快照，以及当前目录重构后的 0.2.0。评判依据为用户确认的目标、实际源代码和本机宿主契约，原 README 的完成声明不作为验收证据。

## 结论

上游已经提供行情视觉组件和部分交互，但尚不足以作为本机可安装、以真实 Agent 文件修改驱动、独立保存 Token 的完整产品。当前重构版已经完成核心实现、构建、43 项自动检查和浏览器真实文件验收；正式安装到用户日常 DSH Profile 及全应用端到端验收仍未执行。不给出缺乏统一分母的完成百分比。

## 上游发现

以下路径相对 `work/upstream/dsh-tonghuashun-master/`。

| 严重度 | 源码证据 | 对目标的影响 |
| --- | --- | --- |
| P1 | `packages/client/ui-market/package.json:28`、`:37`，`tsconfig.json:18`、`:33` | 依赖未随仓库提供的 workspace runtime/repo-stats；下载快照缺少可独立构建的根工程。原测试依赖同一缺失 workspace，未执行。 |
| P1 | `packages/client/ui-market/src/client/index.ts:82` | 使用本机不存在的 `conversation.bottom.panel`，运行时与插件清单也使用旧契约，不能据此认定兼容现有桌面版。 |
| P1 | `packages/client/ui-market/src/client/market-data.ts:80`、`:124`、`:126`、`:184` | 固定 100,000 基线、净行数乘 12、人为推算高低点；缺统计时按节点数推算代码量，不等于项目实际行数。 |
| P1 | `packages/client/ui-market/src/client/MarketView.tsx:43`、`:56`，`InputDockStrip.tsx:45` | reasoning 与 output 一起加总；按本机提供者语义会重复计入推理。仓库中没有独立持久 Token 账本。 |
| P2 | `packages/client/ui-market/src/client/market-data.ts:135` | 只在净变化非零时生成当日记录，等量新增与删除被遗漏。 |
| P2 | `packages/client/ui-market/src/client/market-data.ts:160` | prevClose 经最后循环更新后再相减，结果是当前 open，不是真实前收。 |
| P2 | `packages/client/ui-market/src/client/MarketDock.tsx:26`、`:175` | 以 5 根、20 根切片代替日历周/月，会在缺日期时混淆周期。 |

已有价值：紧凑终端布局、行情视觉方向、K 线与均线交互、会话信息展示。此次作为设计参考保留方向，数据与宿主接入按当前目标重建。

## 重构结果

| 用户目标 | 当前状态与证据 |
| --- | --- |
| 标准 Harness 皮肤 | `dsh.client`、Cordis patch、客户端 ModuleLoader 工厂；使用当前主题和附加插槽，卸载释放样式、主题及插槽。 |
| 真实总代码量与逐笔 K 线 | 首次源码扫描建立基线；成功 write/edit 前后内容与磁盘核对后记录实际新增、删除、总代码量；不放大数值。 |
| 删除 10,000 行的大绿柱 | 浏览器实际修改验收文件，116,622 → 106,622；删除 10,000、新增 0、成交量 10,000。桌面截图已检查。 |
| 恢复与保留历史 | 实际恢复 106,622 → 116,622，新红柱独立保存，验收账本最终保留 16 笔。 |
| 日/周/月 | UTC 日历聚合，周从周一开始；净零修改仍保留成交量；同时间戳事件保留独立标识。 |
| Token 分类与总量保存 | 输入、缓存读写、输出、其中推理；不重复加推理，未知量保留未知；更新去重、重试累计、继承排除、旧事件回填。 |
| 删除会话仍留统计 | 账本不随会话删除；清理需单独确认，保留水位线避免旧 Token 再次回填。 |
| 持久化可靠性 | 串行账本写入、跨进程独占锁、损坏内容拒绝覆盖、逆序工具结果按真实链处理、保存异常可见。 |
| 网页与桌面 | 目标为本机同一个 Host 的两种客户端；真实安装的 Cordis、ThemeRuntime、SlotRegistry 隔离加载和卸载检查通过。完整 DSH 应用验收待正式安装。 |

## 验证记录

- `npm run build`：成功；Host ESM 与 DSH 客户端模块均生成。
- `npm test`：43 通过，0 失败，0 跳过；含真实安装态宿主两项检查。
- 首次查询回填回归：实时记录先创建项目时，第一次打开仍补齐旧 Token；再次查询不重复读取或累计。
- 浏览器：逐笔/日/周/月、MA、缩放、适配全部、展开/收起、项目/会话范围、Token 面板、JSON 导出和清理取消均操作通过。
- 视口：1586×992 与独立浏览器 390×844；窄屏页面和图表宽度均为 390，无横向溢出。截图工具原窗口缩放异常已通过独立浏览器复核。
- Canvas 像素检查有实际红绿像素；最新导航后控制台 0 错误。预览不伪造 Token，因此验收项目 Token 为 0。
- 安装包：`dsh-tonghuashun-0.2.0.tgz`，11 个文件，831.2 kB；含 manifest、patch、Host、client、LICENSE 和第三方许可信息，不包含验收数据、会话内容、依赖目录或上游副本。
- 包 SHA-256：`316860BF08E74B2D163F5F666A8ABFFA6BA221B55E7B08618BA573E2E2AAE516`。

## 已知边界与待验收

1. Shell 工具缺少可信的文件归属证据，当前仅重扫校准，不生成 Agent 修改柱。write/edit 路径已验证。
2. 旧会话没有每笔修改后的项目总代码量证据，不能重建历史 K 线；历史 Token 在已有日志仍可读取时回填。
3. 账本当前使用单写者 JSON 全量保存，未做百万事件规模压测。独立 Host 必须配置不同 dataDir；本机同 Host 网页与桌面共用账本。
4. 当前统计 HTTP 接口仅本机同源，远程浏览器连接、其他 Harness 版本不在本次验证范围。
5. 正在执行工具时不要热卸载插件；服务拒绝提前释放写入锁，以防两进程覆盖。
6. 皮肤正式插入现有聊天页面；独立预览的左栏和日志外框仅供视觉验收，不替换宿主导航或聊天。
7. 尚未修改用户 DSH Profile，尚未执行真实日常应用中的插件安装、重新加载和运行一次 Agent 修改。安装需要用户对具体 Profile 变更确认。

## 交付位置

- 安装包：`output/dsh-tonghuashun-0.2.0.tgz`
- 删除大绿柱：`output/playwright/delete-10000-desktop.png`
- 手机最终验收：`output/playwright/mobile-final.png`
- 导出样例：`output/acceptance-statistics.json`（删除后 15 笔快照，之后又恢复形成第 16 笔）
- 预览：<http://127.0.0.1:4317>
