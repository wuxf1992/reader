# Reader custom 分支维护与上游同步

## 目标与分支约定

这是基于 [hectorqin/reader](https://github.com/hectorqin/reader) 长期维护的个人定制版。定制保留在 `custom`，周期性合并原作者更新。定制分支领先主线是正常状态；主要控制同一功能的重复实现与冲突范围。

| 名称 | 用途 | 规则 |
| --- | --- | --- |
| `upstream` | 原作者仓库，只获取更新 | 本机设置了无效 push URL 防止误推；不修改原作者分支 |
| `origin` | 自己的 GitHub fork | 当前待创建/接入；接入后用于备份 main、custom 和回退标签 |
| `main` | 纯上游镜像，跟踪 `upstream/main` | 只做 fast-forward，不放个人修改 |
| `custom` | 日常开发和验证后的定制版本 | 功能分别提交，长期采用 merge，不重写已共享历史 |
| `sync/upstream-YYYYMMDD` | 一次同步的临时整合分支 | 独立 worktree 解决冲突、验证后 fast-forward 回 custom |

主工作区：`/home/ubuntu/codex/reader-main-merged-20261023`。旧 `reader-main-sync` 已归档；目录名不代表分支或上游版本。

网络小说插件在独立仓库 `../reader-novel-web-js`，GitHub 为 `wuxf1992/reader-novel-web`。插件有自己的版本、提交和安装包；Reader 的 `deploy/all-in-one/prepare.mjs` 复用插件部署文件，不复制维护第二份。

本机已启用 `rerere.enabled=true`，记住人工冲突解法；每次仍须审阅 diff 和验证行为。

## 必须保留或验证的定制

| 定制 | 维护入口与验证重点 |
| --- | --- |
| 封面本地优先 | `ui/use-cover.ts` 共享入口，账号/服务隔离；持久缓存先显示、联网后台 ETag 验证；304 不闪，断网可用，重连更新，403 不保留旧图；组件释放 Blob URL |
| 离线阅读与更新 | 离线登录、书架、缓存章节、恢复进度；网络挂起有时间预算；PWA 更新先保存本地进度，禁止清缓存来解决升级问题 |
| 小说缓存开书与位置确认 | 目录及落点正文均已缓存时直接打开本机内容，后台校验不替换当前正文；服务端位置更新且不同须询问，继续当前阅读会保存本次选择；关闭书籍、换源、账号切换后丢弃迟到响应，明确拒绝访问时停止展示 |
| 手机阅读 | 默认沉浸、中间显隐工具栏、正文操作继续阅读；对话框阻断背景操作；取消/双指/失焦不翻页；连点跨章有序、拖动不提前提交进度 |
| 小说/TXT 与 EPUB 排版 | 小说逐行分页及短末页、EPUB 列分页、字体/视口变化保持位置；繁简转换、正文设置、高亮与朗读位置 |
| 外观与书架 | 个人阅读主题、纸纹、亮度和玻璃选项；紧凑书架、分组、排序、位置动画与离线移除 |
| 书源 | 主力/备用搜书与换源、目录与正文获取、插件运行环境；API 参数校验和账号隔离保留 |

上游如果已经完整覆盖某项定制，先用对应回归证明，再删除重复代码。不要用整份旧文件覆盖新版；对不再适用的上游实现，记录原因并保留相应测试。

## 同步前：保存和固定版本

每周检查一次更新，按变化量安排同步；重大修复可提前。没有配置自动合并或自动部署任务。

1. 确认工作区、分支、远端正确；未提交工作先按功能提交，私有环境、数据库和运行数据不得入库。
2. 确认当前发布点与插件版本，保存本地回退副本；有 origin 时推送已验证提交和回退标签。
3. 获取主线，更新纯镜像分支，并固定本次整合的上游 SHA：

```sh
cd /home/ubuntu/codex/reader-main-merged-20261023
git switch custom
git status --short --branch
# 下面应无输出；有输出时先整理并提交，不能继续直接 merge。
git status --porcelain
git fetch --no-tags upstream main
git switch main
git merge --ff-only upstream/main
git switch custom
git rev-list --left-right --count custom...upstream/main
git log --oneline custom..upstream/main
git rev-parse upstream/main
```

回退标签采用唯一名称，例如 `custom-before-upstream-20261028`；不得覆盖已有同名标签。

## 在独立 worktree 合并

以下日期、路径、上游 SHA 每次替换成实际值。上游 SHA 用上一步的完整输出固定，避免验证中途目标改变。

```sh
git tag custom-before-upstream-YYYYMMDD custom
git worktree add -b sync/upstream-YYYYMMDD ../reader-sync-YYYYMMDD custom
cd ../reader-sync-YYYYMMDD
git merge --no-ff --no-commit <固定的上游SHA>
git diff --name-only --diff-filter=U
```

冲突处理顺序：接口和权限 → 缓存/账号边界 → 阅读/进度 → 书架与样式 → 测试/文档。语法合并成功不代表行为正确；重点检查同一功能是否变成两套缓存、两个事件处理或两条保存路径。

逐文件解决并 `git add <文件>`；删除临时 `.rej`，检查没有残留冲突标记。需要放弃这次整合时，只在整合工作树运行 `git merge --abort`；主 custom 分支和线上仍保持原版本。

## 验证门槛

建议使用 Node 24（与主线 CI 一致）、锁文件和独立测试数据；不连接正式数据库。新 worktree 首次安装：

```sh
npm ci --prefix server
npm ci --prefix web
npm run typecheck --prefix server
npm test --prefix server
npm run build --prefix server
npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
sh android/scripts/check-shell.sh
```

需要真实媒体文件的测试若跳过，单独记录原因；测试超时先判断是资源争用还是行为问题，不通过放宽断言掩盖失败。

网页/阅读变更另跑以下本地 fixture，禁止用测试账号请求正式服务：

```sh
node web/tools/ui-review/reader-touch.mjs
node web/tools/ui-review/book-cover-cache.mjs
node web/tools/ui-review/novel-cache-open.mjs
node web/tools/pwa/smoke.mjs
node web/tools/pwa/startup.mjs
node web/tools/ui-review/react-app.mjs
```

检查手机/桌面截图、页面错误和横向溢出；覆盖 Chromium/WebKit、小说和 EPUB、翻页取消、封面缓存、离线重开、账号切换、进度及 PWA 更新。涉及安全区/旋转时另做对应检查。浏览器模拟结果须注明；iPhone 真机与完整 Android APK 未测时不可写“全部平台通过”。

## 完成同步、备份和发布

1. 在整合分支完成 merge commit，消息包含上游 SHA 和保留的主要定制。确认没有未解决冲突、工作区干净。
2. 在本文追加本次同步记录：上游版本、回退点、冲突及决策、测试结果/跳过项、插件版本、发布状态和下一次流程改进。
3. 回主工作区，只 fast-forward 到已验证整合分支：

```sh
cd /home/ubuntu/codex/reader-main-merged-20261023
git switch custom
git merge --ff-only sync/upstream-YYYYMMDD
git merge-base --is-ancestor upstream/main custom
git rev-list --left-right --count custom...upstream/main
# 最后一项为 0，表示本次已没有未吸收的上游提交。
```

4. origin 接入后执行 `git push -u origin custom`、`git push origin main` 和 `git push origin <本次回退标签>`；失败时保留本地提交，不强制覆盖远端。只有确认 origin 属于自己，才设置 `custom` 跟踪 `origin/custom`；不要跟踪 `upstream/main` 来代替个人备份。
5. GitHub 上游 Release 工作流默认目标为 `hectorqin/reader-pro`，个人 fork 未配置自己的镜像目标与凭据前，不触发镜像发布；例行同步只推送 custom/main 和非 `v*` 的回退标签。
6. 同步提交和线上部署分别记录。部署前核对本机 `web/.env.production`、当前线上版本、数据/插件兼容性并备份；包含拆包或新资源时发布完整构建，不能只替换入口 JS。验证 HTTP 健康和构建一致后再记录发布完成。
7. 线上回滚使用对应发布备份，源码共享后的撤销使用新提交（必要时 `git revert -m 1 <mergeSHA>`），不重写远端历史，不覆盖当前账号、书架或进度。
8. 整合记录和本地证据保存后，可移除干净 worktree 和已合入的临时分支。回退标签按实际保留策略处理，不在例行同步时批量删备份。

## 首次接入个人 fork

当前 GitHub 账号为 `wuxf1992`，已连接的插件仓库可写。工具尚无创建仓库/fork 能力，当前未找到 `wuxf1992/reader`；Reader 的 origin 接入与远端备份单列为待办。

通过 GitHub 创建原仓库的 fork 后，确认仓库地址和访问权限，再执行：

```sh
git remote add origin https://github.com/<自己的账号>/<Reader仓库名>.git
git remote -v
git fetch origin
git push -u origin custom
git push origin main
git push origin custom-before-upstream-20261028
```

若 origin 已存在，先核对地址再决定是否修改，不重复 add。当前机器没有 Git HTTPS 推送凭据，可使用已授权 GitHub 工具写入现有仓库；不要在文档或 remote URL 中保存 token。接入前有完整 Git bundle 本机备份，但不等同于异机备份。

## 同步记录：2026-10-28

- 同步前 HEAD：`03111b7`；新增 5 个检查点提交，保存换源、离线、手机交互、封面及已有维护记录。合并前检查点：`5930855`。
- 回退标签：`custom-before-upstream-20261028`；源码/历史备份位于工作区外 `../reader-assessment-20261028/custom-sync/`，不纳入远端源码。
- 整合 merge commit：`74f0ab708661cbe8fd12fcba14549051b5cba102`。
- 本次固定主线：`6c274a75e2375a1e079cda2d320cf1277cf6515c`，吸收 34 个上游独有提交（含 merge）。
- 10 个冲突文件。保留账号隔离的共享封面缓存，采用主线封面占位色和加载骨架；保留定制逐行分页、快照拖动和翻页队列，适配主线列对齐/高亮重绘；保留书架布局和动画，接入主线滑动状态切换；采用主线拆包、PWA/Sheet 及样式令牌改进。
- 兼容修复：旧构建为固定 JS 入口附加查询参数，与主线懒加载导入的无参数入口形成两个模块实例。JS 入口和 CSS 均改为 Vite 哈希文件名，HTML、懒加载与离线 precache 使用同一 URL；删除旧查询参数改写，恢复上游标准 PWA 构建插件，并同步 Android 资源检查与相关工具。增加构建/列边界回归，避免双 React 实例及离线漏缓存。
- 校验环境：本机 Node 22.23.1，主线 GitHub CI 配置为 Node 24；本次未运行远端 CI 或完整 APK 构建。
- 网页：标准完整测试 127 个文件、1225 项 Vitest 与 29 项 Node 测试通过；随后新增列边界回归并适配缓存构建，连同相关测试 77 项通过。最终类型检查和生产构建通过。
- 服务端：类型检查、构建通过；490 项中 483 通过、7 项真实媒体文件测试因缺少输入跳过，无失败。
- 浏览器：Chromium/WebKit 手机和桌面小说/TXT、EPUB 跟手翻页、取消、原生滚动、连续翻页及 8 组工具栏切换通过；封面在 1500ms 校验响应前显示本地缓存，更新时无占位帧；整站 40 张截图检查通过，无页面错误/横向溢出。iPhone 真机未测。
- PWA：根路径及嵌套路径安装/多标签更新/离线 API 隔离通过；Chromium/WebKit 的挂起书架/元数据/全部 API、离线事件、过期令牌/502、浏览器进程重启后恢复书架/章节/本地进度均通过，最终完整流程退出码 0。
- Android：桥接 shell 与实际哈希入口资源装载检查通过，未构建完整 APK。
- 样式：主线令牌测试通过；缺陷扫描的两条侧边框提示属于既有批注/校对定位标记，保留其语义。
- 插件配套版本：`reader-novel-web` 1.6.4，源码已推送到 `wuxf1992/reader-novel-web` 的 `3b7adc4`；145 项测试通过。本地 `.tgz` 已核验，版本标签仅在本地，GitHub Release 附件未上传。后续步骤见插件 `RELEASING.md`。
- 发布状态：本次进行源码同步与维护流程落地；线上仍为本次同步前已发布的封面缓存版本，未改正式数据。
- 下次改进：沿用功能提交；每次记录新增或删除的定制。定制代码遵循主线现有令牌和组件，减少样式冲突；共享修复在验证等价后逐项移除重复实现。

## 定制记录：2026-10-29 小说缓存开书与位置确认

- 网络小说已有目录和落点章节缓存时，直接显示本机正文与位置；目录、内容整理规则、服务端进度在后台并行校验。后台下载好新版落点正文后再保存新目录，失败保留可读缓存；不替换当前正文。
- 服务端记录更新且位置不同，复用 `ConfirmSheet` 展示本机与同步位置，确认后跳转；继续阅读、关闭或 Escape 保留当前位置并记录本次选择。不能用阅读百分比大小判断新旧，另一设备回看前文也可能是最新记录。
- 关闭书籍、换源、刷新和切换账号后中止或丢弃迟到响应；服务端明确返回访问拒绝时停止展示缓存正文。未缓存的落点仍走原有获取流程，本次不扩展其他格式的缓存开书策略。
- 修正 compact 确认面板的正文高度及手机阅读面板尺寸覆盖；弹窗出现前清除本次恢复提示，避免遮挡位置说明和选择按钮。
- 验证：相关 192 项回归通过；提示清理后再次运行章节阅读和阅读控件 104 项通过，类型检查和生产构建通过。Chromium/WebKit × 390/1120 宽度均在挂起元数据响应时约 194–384ms 显示缓存正文；继续本机、确认跳转、完整位置说明、按钮可见及面板尺寸断言通过，无页面错误。PWA 根路径/嵌套路径更新检查、Chromium/WebKit 离线启动完整流程通过。iPhone 真机未测。
- 发布策略：从当前线上对应的 `5930855` 建立 `hotfix/novel-cache-20261029`，只带入本次修复；原始基线重建产物与线上逐文件一致。完整上游整合继续留在 custom，发布结果与回退备份另行记录。
- 已于北京时间 2026-10-29 09:06 发布：custom 功能提交 `5ec0238c5b3ac94a97e475866ff3b4089706b99e`，线上对应回移提交 `28e6d4ea714c23f12218d3b30f56c74e4cdb4bd4`，回退标签 `custom-release-novel-cache-20261029`。旧基线 compact 面板已有正确尺寸，回移不引入主线专用样式修复。
- 线上版本另验：65 项章节回归、生产类型检查/构建通过；Chromium/WebKit 手机及桌面缓存开书约 102–410ms，位置确认、面板可见性通过；适配旧资源文件名的 PWA 根路径/嵌套路径安装、即时更新、离线重开检查通过。
- 仅替换 `assets/client.js`、`index.html`、`sw.js`；完整前端备份为 `/opt/reader/backups/web-novel-cache-20261029-010626/web`。HTTP 与本机 HTTPS `/reader/` 的文件摘要均匹配构建，健康接口正常；未重启容器、未改正式账号/书籍数据。本机源站 HTTPS 检查不代表公网 CDN 或证书链验证。
- 本次证据与完整 Git bundle 保存在 `../reader-assessment-20261029/novel-cache/`；个人 Reader fork/远端 Git 推送仍待接入，已有插件仓库不受本次修复影响。

## 历史：2026-10-09 同步记录

以下是当时从 `5c59cae0` 合并到 `875fec84` 的交付记录，不表示当前分支或当前依赖状态。

## 本次兼容处理

- 将阅读组件及本地交互测试接入 React，保留文字分页、翻页队列及恢复定位。
- 保留八种主题、主题分组及原有日夜配对、去边框切换按钮和设置面板样式。
- 保留自动预缓存、缓存数量配置、目录“已缓存”标记及工具面板外部点击关闭。
- 新书架页面保存离线镜像；离线时按本账户缓存展示书架，直接书籍链接也能恢复。
- 书源获取成功后清除新的 React 书架查询缓存。
- 登录先加载对应账户的离线数据，再进入阅读页面；保持当前链接及默认书架入口。
- 服务端无数据库结构、依赖锁文件和容器运行环境变更；新镜像基于现有运行镜像替换本次编译产物。

上线前备份：`/home/ubuntu/codex/reader-ui-backups/main-sync-20261009`。包含旧网页、源码包、Compose 配置及一致性 SQLite 备份；备份仅保留在本机。

## 验证结果

网页：110 个测试文件、888 项 Vitest 测试及 29 项 Node 测试通过。服务端：474 项通过，0 失败；7 项真实媒体文件测试在宿主机因未配置测试环境变量跳过，随后在实际运行镜像中设置 FFmpeg 测试环境，补跑 8 项（含其中 1 项已有测试），全部通过。

Chromium / WebKit 的手机与桌面预缓存、目录回归通过。真机 iPhone 尚未验证。上游生产依赖审计仍报告 4 个高危及 1 个严重项目，本次保留上游锁文件，未做跨主要版本的依赖升级。

主题浏览器检查：Chromium / WebKit 共 24 组场景通过（4 个新增主题 × 3 个屏幕宽度 × 2 个引擎），原生四主题一排及日夜配对均检查。WebKit 有 1 次已知 ResizeObserver 循环警告，无其他页面异常；面板动画结束后再测量标题位置。

React 全流程浏览器回归已通过，40 张手机 / 桌面截图，无页面异常；覆盖书架、书库、书源、阅读、影音浏览、收藏分页、实际视频播放、迷你播放器返回、媒体库创建编辑、成员权限和浏览器前进后退。

线上 JS、CSS、Service Worker 与本次构建字节一致，HTML 资源版本一致，API 健康正常；账号、书籍、插件和媒体索引数量与一致性备份核对无减少。
