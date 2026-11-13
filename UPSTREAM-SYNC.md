# Reader custom 分支维护与上游同步

## 目标与分支约定

这是基于 [hectorqin/reader](https://github.com/hectorqin/reader) 长期维护的个人定制版。定制保留在 `custom`，周期性合并原作者更新。定制分支领先主线是正常状态；主要控制同一功能的重复实现与冲突范围。

| 名称 | 用途 | 规则 |
| --- | --- | --- |
| `upstream` | 原作者仓库，只获取更新 | 本机设置了无效 push URL 防止误推；不修改原作者分支 |
| `origin` | [wuxf1992/reader](https://github.com/wuxf1992/reader) | 已接入并核对远端；custom/main 和回退/发布标签已完整备份 |
| `main` | 纯上游镜像，跟踪 `upstream/main` | 只做 fast-forward，不放个人修改 |
| `custom` | 日常开发和验证后的定制版本 | 功能分别提交，长期采用 merge，不重写已共享历史 |
| `sync/upstream-YYYYMMDD` | 一次同步的临时整合分支 | 独立 worktree 解决冲突、验证后 fast-forward 回 custom |

主工作区：`/home/ubuntu/codex/reader-main-merged-20261023`。旧 `reader-main-sync` 已归档；目录名不代表分支或上游版本。

网络小说插件在独立仓库 `../reader-novel-web-js`，GitHub 为 `wuxf1992/reader-novel-web`。插件有自己的版本、提交和安装包；Reader 的 `deploy/all-in-one/prepare.mjs` 复用插件部署文件，不复制维护第二份。

本机已启用 `rerere.enabled=true`，记住人工冲突解法；每次仍须审阅 diff 和验证行为。

## 每次同步的差异预审与定制退场

主题与桌面体验的新增约束见 [主题与桌面评估](docs/theme-desktop-assessment-20261029.md)：增强功能必须保留既有桌面/手机任务，外观验收包含跨入口状态一致与常见笔记本高度下的高频控件。截图无溢出、局部测试通过不能单独作为发布体验结论。主题状态与入口的收敛已实施，详见 [统一主题与合并验收规则](docs/reader-theme-presets.md)；后续继续扩展主题/工具前必须检查这些任务。

2026-10-29 的固定版本审计、优化排序及主线重叠判断见 [custom 与主线审计](docs/custom-upstream-audit-20261029.md)。审计基线 `d0452f2` 已包含上游 `6c274a7` 的全部提交；32 个本地独有提交不表示仍落后主线。

获取更新后、进入独立 worktree 前增加以下预审；变量每次按实际输出固定，不复用过期目标：

```sh
reader_target=$(git rev-parse upstream/main)
reader_base=$(git merge-base custom "$reader_target")
git diff --name-only "$reader_base" "$reader_target"
git diff --name-only "$reader_base" custom
git cherry -v "$reader_target" custom
git merge-tree --write-tree custom "$reader_target"
```

前两份清单的交集是重点审阅范围；merge-base 若与上次记录不符，先核对上游历史和同步点。`merge-tree` 返回 0 表示文本合并成功、1 表示冲突；它不改工作区/索引，但写入 Git 对象。不要将其返回 0 当作回归通过。

每项定制记录保留理由、验证入口与退场条件：主线已有等价行为时，优先转用主线并删除旧实现。patch-id/`git cherry` 仅识别补丁等价，不能据此自动判断功能等价。2026-10-29 已收敛书源详情封面和 React 书籍查询失效，拆分繁简选项与字典并清除旧设置读写；后续对照审计报告的实施状态和对应回归，避免再次添加相同路径。

发布继续记录源码标签、实际构建摘要和插件版本。紧急回移分支只保存发布点，后续功能仍进 custom；完成完整验证后将线上与 custom 的发布点收敛，避免同时维护两个开发版本。个人 origin 备份未接入时持续保留已验证的本地 bundle，并明确它仍是本机备份。

## 必须保留或验证的定制

| 定制 | 维护入口与验证重点 |
| --- | --- |
| 封面本地优先 | `ui/use-cover.ts` 共享入口，账号/服务隔离；持久缓存先显示、联网后台 ETag 验证；304 不闪，断网可用，重连更新，403 不保留旧图；组件释放 Blob URL |
| 离线阅读与更新 | 离线登录、书架、缓存章节、恢复进度；网络挂起有时间预算；PWA 更新先保存本地进度，禁止清缓存来解决升级问题 |
| 小说缓存开书与位置确认 | 目录及落点正文均已缓存时直接打开本机内容，后台校验不替换当前正文；服务端位置更新且不同须询问，继续当前阅读会保存本次选择；关闭书籍、换源、账号切换后丢弃迟到响应，明确拒绝访问时停止展示 |
| 手动下载跨页继续 | AppRuntime 管理任务，面板只订阅；收起工具/回书架继续、重开附着同一任务；取消/清理无迟到写入，账号/服务隔离、同账号令牌更新保留；中断范围恢复且复用已缓存章节。详见 [后台下载契约](docs/reader-background-downloads.md) |
| 首屏与共享入口 | 繁简选项不静态加载转换字典；恢复账号先显示页面、后台校验且撤销时退出；React 书籍列表刷新穿过 API 缓存；详情封面复用 useCover，远端目录请求优先。主线等价覆盖后再退掉对应补丁 |
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
node web/tools/ui-review/manual-background-download.mjs
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

## 插件更新：2026-10-29（1.6.5）

- Reader前端及容器未改，网络小说插件已于北京时间21:57:59通过官方接口从1.6.4升级1.6.5。主力绑定已审核规则指纹；未知、规则变更或已知残章/串文来源不能靠旧开关和读取检查进入主力。正式七个主力全部保留。
- 近一周68份Hermes归档复核；四成功候选经真实插件归档回放，当前只有飞卢公开免费样书及qbtr末三章可读，两项新增仅作备用。思路客、必读403验证阻碍不新增为可用；iinbqg继续备用。qbtr修正日期当章节及作者前缀。
- 新锁定安装后154测试通过、无跳过，npm audit告警0。隔离Reader官方回退/升级、偏好与业务保留、空主力不扩池、备用搜索/入架/目录/末三章实读通过。正式账号、书架、笔记、绑定、源实例及进度、插件偏好哈希一致，文件与安装包匹配，健康ok。
- 安装包SHA256 `da9e04628f79023318c1e7f63c22c899a6745de7584bd913da16cbb8800687be`；回退备份 `/opt/reader/backups/plugin-hermes-quality-20261029-135751`。插件本机标签v1.6.5指向2480917，GitHub源码通过连接器保存并逐文件核对；Github标签/Release附件未上传。插件及此Reader记录的源码提交分开保存，不能把Reader前端发布点误记为本次插件包。
- 证据、包和完整回执：`../booksource-research/2026-10-29/`；Hermes库内追加 `codex-review/2026-10-29/REVIEW.md`，未改任务状态/原始证据/模型/调度/通知。单样书不保证全站、VIP或更新时效；没有重新抓取全部主力书站。

## 质量优化与发布：2026-10-29

- 已按“高内聚、低耦合、简单、健壮”复查 custom `0e5dbeb` 相对主线 `8ec588b` 的核心定制。问题、来源和处理依据见 [质量复查](docs/custom-quality-20261029.md)，未把过往已修复问题重复列为待办。
- 修复阅读链接迟到响应写入已切换账号的离线缓存；书源后台刷新保留编辑草稿；删除失败保留确认与重试，忙碌时阻止重复确认；暂停/设默认失败提示并可重试。新增 5 个用户行为回归，修复前均复现失败（包括未处理 Promise），修复后相关 40 项通过。
- 将纯结果合并移到已有 source-results，两页面共享使用；来源/类型读取统一使用 sourceQueries；删除无调用的旧详情 Sheet 及无消费者的目录状态/回调。运行源码净减 22 行，新增依赖 0，未引入新的架构层。
- 发布源码 `76e0b09abe4ed68bee06c0056c09bab4274d168a`，标签 `custom-release-quality-20261029`；上线前 custom 为 `0e5dbeb`，回退标签 `custom-before-quality-20261029`。后续本记录仅变更文档。main 未动，仍是纯上游 `8ec588b`。
- 最终前端类型检查及生产构建通过；完整 133 文件、1270 项 Vitest 和 29 项 Node 测试通过。使用 Node 22.23.1 和原锁定依赖，未运行 Node 24/远端 CI。
- 11 套实际浏览器验收全部通过：host-source-flow、source-discovery、host-extension-page、book-cover-cache、novel-cache-open、reader-touch、reader-text-fidelity、offline-sync、react-app、pwa-smoke、pwa-startup。真实本地 HTTP/SQLite/stdio 插件安装配置、目录/换源、手机/桌面 Chromium/WebKit 缓存/翻页/正文实体、离线提示/恢复及 PWA 进程重启均通过；整站 40 张截图、页面错误/溢出检查通过，人工复核手机配置和桌面搜书截图。
- Android 桥接 shell 检查通过；iPhone 真机和完整 APK 未测。此次未重跑未变更服务端的全套测试（上次发布 483 通过、7 缺媒体输入跳过），也未逐行审查全部影音/原生实现。主题/系统栏运行源码未变，未重复运行上轮已通过的专门矩阵。
- 北京时间 2026-10-29 20:59:12 完整发布前端 57 文件，保留旧哈希资源。入口 `assets/client-W2BSit1K.js`，样式 `assets/index-qIPFf6_R.css`；全部文件 SHA-256 与 HTTP origin 一致，HTML/SW/入口/CSS/manifest 与本机 HTTPS `/reader/` 一致，健康状态 ok。本机 HTTPS 采用回环解析且未校验证书，不代表公网 TLS/CDN 测试。
- 完整回退备份：`/opt/reader/backups/web-custom-quality-20261029-125912/web`；并发变更/构建摘要保护及失败自动回滚均启用，本次未触发回滚。服务端、Android 源码、容器、正式账号/书架/进度和插件均未变，reader-novel-web 仍为 1.6.4。
- 源码、回退和发布标签保存到个人 `wuxf1992/reader`，upstream 继续禁止推送。证据、构建、日志/截图、Git bundle 与部署回执位于工作区外 `../reader-assessment-20261029/quality-optimization/`。

## 同步与发布记录：2026-10-29（上游 8ec588b）

- 状态：已完成合并和上线；北京时间 2026-10-29 18:31:35 发布至 https://wuxf.top/reader/ 。
- 合并前 custom：`01a4caa23d413e9544a2fd081775cfa7d915439e`；回退标签：`custom-before-upstream-20261029-8ec588b`。此前个人 fork 接入和同步记录是历史状态，以本节为本次最终结果。
- 固定上游：`8ec588b7742ad77f8143f690ea392775c7c9c776`，相对共同祖先 `6c274a7` 吸收 12 个提交（含 merge）；合并提交 `13c3380`。独立 worktree 验收后 fast-forward 回 custom，custom 相对本次上游遗漏 0 个提交；main 保持纯上游。
- 上游变化涉及书源配置/日志/筛选、通用菜单和 Sheet、媒体管理界面、文本清理。25 个上游变更文件中 10 个与定制重叠，实际冲突为 SourceCatalogPage、SourcesPage、reader.css 三处。保留目录结果元数据合并与排序，接入主线错误去重；使用主线共享 ActionMenu，删除旧菜单状态及失效调用；合并菜单定位和滚动区域。Sheet 紧凑高度使用主线规则，删除重复定制。
- 保留封面缓存、小说离线开书与位置确认、手机翻页及进度、主题、换源和离线同步提示去重；不增加另一套正文/缓存/保存路径。
- 回归发现并修复：HTML 实体经重复清理后丢失字面标签，改为在排版入口清理一次，流式未完成段落重新转义，离线原文和富文本图片/表格保持完整；书源保存失败保留草稿并提示；源类型选项在安装/更新/启停/卸载后立即刷新；书源页标签补齐方向键/Home/End 和窄屏选中项可见性。
- 浏览器工具适配当前独立源编辑页、安装 Sheet、操作提示、筛选菜单及 SSE 换源协议；真实 HTTP/SQLite/stdio 插件检查只使用本地独立数据，明确阻断正式站点请求，保留失败换源原正文和成功换源章节落点的断言。
- 环境：Node 22.23.1，server/web 分别新装锁定依赖；未运行 Node 24 或远端 CI。server 类型检查、构建通过；490 项中 483 通过、7 项缺少真实音视频/封面/字幕等媒体输入而跳过。web 类型检查、生产构建通过；完整 133 个文件的 1265 项 Vitest 和 29 项 Node 测试通过。
- 浏览器：12 套发布检查全部通过：reader-touch、book-cover-cache、novel-cache-open、host-source-flow、source-discovery、host-extension-page、reader-unified-themes、reader-status-tint、offline-sync、react-app、pwa-smoke、pwa-startup。覆盖 Chromium/WebKit 手机/桌面、正文与富文本、缓存重开、失败/成功换源、插件真实安装和配置、离线重试与恢复、PWA 多标签更新/挂起接口/离线进程重启。主题 120 次选择、系统栏 96 项及整站 40 张截图通过；人工查看手机/桌面设置、书库和插件配置截图。最终构建另跑 reader-text-fidelity 四组通过。
- Android 桥接 shell 检查通过；iPhone 真机和完整 APK 未测。服务端及 Android 源码未变，未重启容器、改正式数据或升级插件；reader-novel-web 仍为 1.6.4。
- 部署源码：`48397f17a9d9113a082b688fa1c48fb286d3eb0e`，发布标签 `custom-release-upstream-20261029`。后续维护记录提交只变文档；实际构建依据该标签。
- 发布完整 57 个文件，保留旧哈希资源；全部文件经 HTTP origin SHA-256 核对，HTML/SW/入口/CSS/manifest 经本机 HTTPS `/reader/` 核对，健康状态 ok。入口 `assets/client-CcBwNjrf.js`，样式 `assets/index-qIPFf6_R.css`。HTTPS 使用回环解析并忽略本机证书校验，因此不代表公网 TLS/CDN 验证。
- 上线前完整备份：`/opt/reader/backups/web-custom-upstream-merge-20261029-103135/web`。发布脚本包含并发修改保护、构建摘要保护和失败自动回滚；当前未触发回滚。回滚只恢复前端，不覆盖账号/书架/进度。
- custom/main 及本次回退标签已普通原子推送到个人 `wuxf1992/reader`；发布标签随本节维护记录推送。原作者 upstream 保持禁止推送，未创建上游 PR 或触发镜像发布。
- 预审及完整验收/构建/发布回执保存于工作区外 `../reader-assessment-20261029/merge-feasibility/` 和 `../reader-assessment-20261029/upstream-merge-release/`。下次沿用固定上游、独立 worktree 和实际浏览器任务验证；合并后优先检查文本清理次数、插件缓存失效以及已迁移组件的旧调用。

## 个人 fork 接入：2026-10-29

- 用户已创建 [wuxf1992/reader](https://github.com/wuxf1992/reader)，GitHub 连接器确认当前账号具备 push/admin 权限。
- `origin` 读取地址为 `https://github.com/wuxf1992/reader.git`，推送地址为 `git@github.com:wuxf1992/reader.git`；原作者 `upstream` 的禁止推送设置保持不变。
- 已读取 origin/main（`8ec588b7742ad77f8143f690ea392775c7c9c776`），纯主线 `main` 从 `6c274a7` 快进到该点。custom 暂未合并本次新增的 12 个主线提交；本次仅接入个人备份，不改变线上源码。
- HTTPS 推送预检因缺少 Git 认证失败；连接器权限不能自动提供给本机命令行。已生成本仓库专用 SSH 密钥，私钥在仓库之外的受限目录，未纳入 Git；仓库本地 core.sshCommand 只选用该身份，并使用已核对官方指纹的 GitHub 主机公钥。
- 用户已添加仓库专用部署公钥并允许写入，SSH 推送验证通过。北京时间 17:05 使用原子 push 上传 custom 完整历史及 5 个 custom 回退/发布标签；main 与 origin/main 保持一致，未强制覆盖远端。全部 7 个引用 SHA 已逐一核对；custom 已跟踪 origin/custom。
- 定制代码及原始提交历史已保存到 GitHub，不再只有本机备份；维护记录更新也推送至 origin/custom。今后功能提交留在 custom，验证后普通推送；main 保持纯上游，发布标签只指向实际部署源码。远端引用核验回执保存于 `../reader-assessment-20261029/origin-backup/`。

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

## 发布记录：2026-10-29 完整 custom 前端与审计优化

- 发布源码：`1719ab1d48eb0466907a2dc152697f3015d098ee`；标签 `custom-release-optimized-20261029`。北京时间 09:56 上线，前端现对应 custom 的完整发布点；`hotfix/novel-cache-20261029` 仅作历史记录，后续功能不在其上继续开发。
- 五项优化及独立提交见 [审计实施结果](docs/custom-upstream-audit-20261029.md#实施结果2026-10-29)。相对审计基线运行源码新增 64 行、删除 137 行，净减少 73 行，没有新增依赖。
- 当前入口 `assets/client-24UfHSVb.js`，806,461 B，Vite 报告 gzip 约 241 KB；字典留在阅读 chunk。完整网页 1242 项与 29 项 Node 测试通过，最后鉴权存储边界调整后相关 37 项和 29 项 Node 契约复核通过，最终类型/构建正常。
- Chromium/WebKit 手机/桌面小说缓存与位置确认、详情封面/目录、繁简/朗读/重开通过；96 项系统栏取色、40 张整站截图、PWA 更新及完整离线启动恢复通过；Android shell 契约通过。旧工具已适配默认沉浸、面板退出动画和局部主题。WebKit 重载时的两条同步请求中止警告单列在繁简检查结果，持久化与恢复通过。
- 完整旧前端备份：`/opt/reader/backups/web-custom-optimized-20261029-015655/web`。发布校验 57 个构建文件，替换/新增 50 个文件，保留旧入口与 CSS 供尚未更新的页面使用；HTTP 全量及本机 HTTPS 关键资源摘要匹配、健康接口正常，失败路径支持恢复备份。
- 服务端源码与上一前端发布点相同，本次没有部署后端、重启容器或修改正式账号/书籍/插件数据。插件源码维持 1.6.4。完整证据与 Git bundle 位于 `../reader-assessment-20261029/optimized-custom/`。
- 未测 iPhone 真机、完整 APK、远端 CI 与公网 CDN/证书链；Reader 个人 origin 仍未接入，本地 bundle 不等同于异机备份。

## 发布记录：2026-10-29 全局与阅读主题统一

- 发布源码：`83af5d4e08157934058ebd3ca19b27c41690f37b`；标签 `custom-release-unified-themes-20261029`。北京时间 10:53 发布完整前端。
- 保留 21 套自定义配色、5 种纸色和 4 套基础主题，统一放入共享目录；全局设置和阅读页共用状态、配色选择器及日间/夜间/跟随系统。旧设备阅读主题与日夜记忆一次迁移，新选择不再被旧字段覆盖。
- 主题设置移入 `shared/theme`，移除原媒体模块里的重复组件及无用卡片样式。颜色变化不重新分页；阅读外观首屏先显示字号、行距、亮度，主题目录默认折叠。字号、行距、亮度、位置和纸张纹理保留。
- 最终完整测试：129 个文件、1,241 项 Vitest 与 29 项 Node 检查通过，类型检查及构建通过。Chromium/WebKit 在 390×844 与 1440×768 下共 120 次主题选择通过，跨入口、重载、跟随系统、正文/弹窗/全局颜色一致；最终报告无页面异常、无导航取消警告。
- 96 项系统栏取色和渲染像素检查、40 张整站手机/桌面布局检查、PWA 根路径/子路径安装更新与离线检查通过。小说缓存优先开书及最新位置两种选择通过；挂起登录/目录/修订接口、离线进程重启及本地进度恢复通过；Android shell 契约通过。
- 旧前端备份：`/opt/reader/backups/web-custom-unified-themes-20261029-025332/web`。完整构建 `57` 个文件逐一匹配 HTTP，HTML/SW/入口/CSS/manifest 的本机 HTTPS `/reader/` 摘要匹配，健康接口正常。保留旧静态资源供已有页面更新；未重启容器，未修改后端、正式账号、书籍和插件数据。
- 入口：`assets/client-BVbdWtOY.js`；样式：`assets/index-CrBVdzV1.css`。源码、产物、截图、摘要与发布回执保存于 `../reader-assessment-20261029/unified-themes/`；迁移和下次合并的验收契约见 [统一主题说明](docs/reader-theme-presets.md)。
- 未验证真实 iPhone Safari/系统合成层、完整 APK、外网 CDN 与公开证书链；HTTPS 校验使用本机回环。个人 Reader fork 远端仍待接入，当前保留本机 Git 与 bundle 备份；插件维持已发布的 1.6.4。

## 发布记录：2026-10-29 离线同步提示去重

- 发布源码：`561d996ffe10d10f7c1a4241f4fad98b5afab2cd`；标签 `custom-release-offline-feedback-20261029`。北京时间 16:51 发布完整前端。
- 阅读页在同一次断网或相同同步错误期间只提示一次；提示自动消失或手动关闭后，后台重试及新增本地进度不再重开提示。成功同步后重新允许报告下一次故障；不同错误及登录失效仍按原流程处理。
- 同步前先检查系统连接状态，已知离线时保持 offline，不再切换为 syncing；进度继续持久保存在本机，联网事件触发自动补传，保留后台重试、拒绝计数与账号隔离。
- 52 项同步/阅读提示/通知回归通过，类型检查与生产构建通过；Chromium/WebKit × 390/1120 宽度验证提示过期、手动关闭、重复重试、离线进度保留与恢复补传、新一轮断网提醒，均无页面异常。PWA 根路径/子路径安装、离线重开、多标签即时更新与缓存清理检查通过。
- 旧前端完整备份：`/opt/reader/backups/web-custom-offline-feedback-20261029-085104/web`。57 个构建文件逐一匹配 HTTP 源站，HTML/SW/入口/CSS/manifest 的本机 HTTPS `/reader/` 摘要匹配，健康接口正常。发布失败路径自动恢复备份；保留旧资源供已有页面更新。
- 入口：`assets/client-DCuTYYCW.js`。证据、发布回执与源码备份位于 `../reader-assessment-20261029/offline-feedback/`。本次只发布前端，未重启容器或修改正式账号、书籍、插件数据。
- 未测 iPhone 真机、完整 APK、公网 CDN 与公开证书链；HTTPS 校验使用本机回环。

## 发布记录：2026-10-29 手动下载跨页面继续

- 发布源码：`3b7ac55af4943934c31a3ed0d950e30607a5ec5e`，标签 `custom-release-background-download-20261029`；北京时间 22:42 发布前端。开发回退点 `custom-before-background-download-20261029` 为 `4c5629a`，保留已同步主线 `8ec588b` 与插件 1.6.5。
- OfflineDownloads 由 AppRuntime 统一持有；收起阅读工具、返回书架或进入其他页面后任务继续，重开面板订阅同一任务和进度。任务仍按账号/服务隔离；切换账号或退出取消，同账号令牌更新保留。暂停、取消、清理与目录修订均等待或丢弃迟到响应，清理后不补回缓存。
- 重载或系统中断后保留章节范围，点“下载 / 继续”复用已缓存资源。WebKit 重载有时先记录网络中断错误，仍可按原范围续传；已完成任务不会因退出而变成暂停。工具文案明确浏览器锁屏/后台限制，维护与合并契约见 [后台下载说明](docs/reader-background-downloads.md)。
- 完整前端测试：135 个文件、1,285 项 Vitest 与 29 项 Node 检查通过；类型检查、生产构建及 Android shell 契约通过。新增失败→通过回归证明关闭工具不再中止下载；覆盖运行中重取、范围恢复、资源复用、账号/服务切换、取消/清理/目录修订及已完成状态保留。
- 9 组浏览器验收通过：手动后台下载、自动预缓存、翻页/取消、封面缓存、小说缓存开书和位置确认、离线同步提示、PWA 根路径/子路径更新、离线浏览器进程重启、整站 40 张截图。覆盖 Chromium/WebKit 手机及相关桌面流程；旧脚本适配默认沉浸操作，并在上下文关闭后释放迟到 fixture 响应。
- 旧前端备份：`/opt/reader/backups/web-custom-background-download-20261029-144223/web`。57 个构建文件逐一匹配 HTTP 源站，HTML/SW/入口/CSS/manifest 的本机 HTTPS `/reader/` 摘要匹配，健康接口正常；发布异常路径自动恢复。保留旧静态资源供已有页面更新。
- 入口 `assets/client-CfgJPzCn.js`；样式 `assets/index-qIPFf6_R.css`。证据、源码/产物摘要、截图、发布回执和发布源码归档位于 `../reader-assessment-20261029/background-download/`。仅替换前端，未重启容器、未修改正式账号、书籍、插件或媒体数据。
- 未做 iPhone 真机锁屏、完整 Android APK 或公网 CDN/证书链检查；HTTPS 校验使用本机回环。系统挂起网页后不能承诺继续执行，原生持续后台下载不在本次范围；服务端没有改动，未重复执行完整服务端测试。

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

## 发布记录：2026-11-03 书架手机点击被操作菜单拦截

- 发布源码 `2e7e5718832607618d84a47419c81f02dcc93cff`，标签 `custom-release-shelf-tap-20261103`。手机粗指针样式的 book-more::before 以整张卡片为定位容器，覆盖封面与标题；书架按钮已有 44px 点击区域，取消该多余透明层，保留操作菜单。
- 按要求简单验证：修复前实际手机命中测试失败；修复后 8 项相关书架测试、类型检查/生产构建、Chromium/WebKit 手机和桌面共 4 组封面/标题命中、直接阅读和标记菜单检查通过。未重复运行全量测试，未做真机验证。
- 已发布前端，57 个文件匹配 HTTP 源站，本机 HTTPS 关键资源摘要与健康检查通过。旧前端备份 `/opt/reader/backups/web-custom-shelf-tap-20261103-125335/web`；回退标签 `custom-before-shelf-tap-20261103`。证据 `../reader-assessment-20261103/shelf-open/`。

## 整合与验收：2026-11-05 上游及手机阅读设置

- 固定上游 `dc6cbf5b2adbb5114fd2fa2fe434bb213408738e`，相对上次 `8ec588b` 有 67 个提交，306 个变动文件；与定制交集 64 个文件。独立 worktree 合并，保留 custom 长期历史，main 为纯上游镜像。回退标签 `custom-before-upstream-20261105-dc6cbf5`，原始 Git bundle 在 `../reader-assessment-20261105/before-merge.bundle`。
- 阅读底栏与设置收拢，手机常用亮度、字号、配色首屏可达；四个详细入口固定底部。共享 Sheet 的标题/抓手下拉关闭，保留短拖/取消、输入/滚动、忙碌和嵌套面板保护。详情及下次合并契约见 [阅读设置](docs/reader-settings.md)。
- 上游离线时长队列补充账号/服务器作用域和迟到上报保护；保留阅读位置、封面缓存、小说缓存开书、手动后台下载、统一主题、紧凑书架和书源草稿。移除已无调用的旧 text renderer、CSS 生成器及多余入口/选择器，无新增依赖。完整审查见 [Ponytail review](docs/custom-upstream-review-20261105.md)。
- 完整前端 144 文件/1,376 项 Vitest、18 项 Node 契约通过；服务端 501 项中 494 通过、7 项缺少媒体输入跳过，随后 8 项真实 FFmpeg 补测全部通过。前后端类型检查、构建、Android shell 契约通过。
- Chromium/WebKit 设置小屏/手机/桌面、实际下拉、30 项配色和 120 次跨入口选择通过；96 项取色、正文保真、翻页、封面/小说缓存、离线同步、跨页下载及中断续传、真实后端插件书源流程、整站与 PWA 更新/离线重启通过。下载夹具在主动重载和断网时有两条 WebKit 时长请求中止，单列诊断，恢复检查通过。
- Node 24 候选容器鉴权和统计接口验收通过；正式数据库的私有一致性副本运行两次迁移，29 张既有表内容不变，新增时长/历史两表；旧镜像可打开迁移后结构。保留现有网络小说插件 1.6.6，正式上传策略维持仅管理员。
- 未验证 iPhone 真机/锁屏、完整 APK、远端 CI，未重新进行依赖漏洞审计；Vite 原有大 chunk 警告保留。正式发布的源码、镜像、备份与摘要以紧随其后的发布记录和 `../reader-assessment-20261105/publication.json` 为准。

## 发布记录：2026-11-05 上游与紧凑阅读设置已上线

- 发布源码 `23ee384aeb48ad4a0dce549f4fce0b8b9b976229`，标签 `custom-release-upstream-settings-20261105`；镜像 `reader-github:upstream-settings-20261105-23ee384`。个人 GitHub 的 custom/main 与回退、发布标签已推送。前端入口 `assets/client-BR59YRxQ.js`，样式 `assets/index-C8ZHLX1x.css`。
- 北京时间 2026-11-05 17:48 完成服务端和完整前端发布。完整停服备份 `/opt/reader/backups/upstream-settings-20261105-094650`，含 Compose、原书目录、旧前端和官方校验通过的成对数据库/签名密钥/插件/缓存；36,200 个数据文件、851,917,000 字节。第一次只读挂载备份失败，自动恢复旧服务；改用 Reader 用户及允许 SQLite 临时日志的挂载后重新完整备份、验证及发布。
- 60 个构建文件逐一匹配 HTTP 源站；公网 HTTPS 证书校验正常，HTML/SW/入口/CSS/manifest 摘要一致。保留 70 个旧资源供尚未更新的页面使用。服务健康、阅读及媒体数据库完整性/外键通过，既有账号/书籍/笔记/书源/插件身份均保留，已启用插件仍为 1.6.6。上传策略维持仅管理员。
- 发布脚本在失败时恢复旧镜像及前端，保留最新数据库，禁止用旧进度覆盖新进度。旧镜像已验证能打开新增表结构。清理本次临时运行容器和私有迁移副本；保留正式备份、Git bundle 和测试证据 `../reader-assessment-20261105/`。

## 布局修复与验收：2026-11-05

- 首页收回为最近一本续读，即使接口返回多本也只呈现第一本；媒体续播和书架保持原行为。阅读底栏和常用配色按实际按钮数量等分可用宽度，详细入口按容器宽度自动排列，不再留下被删除按钮的空位。
- 阅读设置的滑块采用标签/弹性滑块/右对齐数值，开关采用弹性说明/右侧开关，分段选项使用完整一行和至少 44px 点击高度；返回位于标题左侧。手机面板按内容自然增高并受动态视口及安全区约束，内部滚动，桌面保持抽屉。依据及维护契约见 [阅读设置](docs/reader-settings.md#自适应布局与续读验收)。
- 首页回归先证实旧实现失败；修复后 87 项首页/阅读设置/拖动/主题/朗读/样式引用测试、类型检查和构建通过。Chromium/WebKit × 320/390/768/1440 共 8 组覆盖一本续读、底栏位置等分、全部详细设置无横向溢出、触控尺寸、数值生效/重载保留及下拉关闭；PWA 根路径和子路径更新/离线检查通过。
- 本次仅更新网页。未重复运行服务端或全量网页测试，未测真机；自动布局扫描器启动时权限不足，改用浏览器几何断言和手机/桌面截图核对。证据位于 `../reader-assessment-20261105/layout-fix/`，发布回执另记实际源码与备份。

### 布局修复发布回执

- 发布源码 `c725023a37edbf4b315412ac122d7479bd86d289`，标签 `custom-release-reader-layout-20261105`；回退标签 `custom-before-reader-layout-20261105`，均已推送个人 origin。北京时间 2026-11-05 18:10 发布完整前端。
- 旧网页完整备份 `/opt/reader/backups/web-reader-layout-20261105-101040`。60 个构建文件逐一匹配 HTTP 源站，HTML/SW/入口/CSS/manifest 匹配公网 HTTPS 并校验证书；健康正常，保留旧资源供已打开页面继续使用。入口 `assets/client-CguISffI.js`，样式 `assets/index-CEMFLGL7.css`。
- 仅更新前端，未重启服务或更改数据库、账号、书籍和插件；后端镜像仍为此前验证的 `reader-github:upstream-settings-20261105-23ee384`。回执与最终截图位于 `../reader-assessment-20261105/layout-fix/`。

## iPhone PWA 面板与底栏修复：2026-11-05

- 用户真机截图暴露此前未覆盖的独立应用模式：PWA 旧规则 `inset: 20vh 0 0` 将阅读设置的顶部和底部同时固定，自动高度仍被拉长。阅读设置明确仅固定底部，内容不再撑满空闲空间，保留长内容内部滚动。
- 底栏顺序改为目录、朗读、日间/夜间、设置。两行内容自然确定高度，页码跟随真实高度；通过 `ResizeObserver` 观察包含内边距的 border-box，安全区改变时也能更新。底部间距取普通留白与系统安全区的较大值，不再相加；不删除 Home 手势安全区，不修改正文留白偏好。
- 先复现旧版失败：390×844 模拟 PWA 有 156.52px 面板多余空白、13.6px 底栏空闲高度，并额外叠加 6.4px 普通底边距。修复后面板/底栏空闲高度约为 0，PWA 底部保留 34px 安全区；动态变为 50px 后恢复，页码与底栏保持贴合。
- 144 项阅读设置/拖动/朗读/配色/阅读布局/样式引用测试通过，类型检查与构建通过。Chromium/WebKit × 普通模式及模拟 PWA 共 12 组布局/持久化/30 项配色/真实指针或触摸拖动通过；96 项系统取色（含渲染像素）、小说/EPUB 翻页与取消、PWA 根路径/子路径更新及离线通过。
- 网络依据及下一次合并约束见 [iPhone PWA 与底部安全区](docs/reader-settings.md#iphone-pwa-与底部安全区)。本次仅前端修复；未重复服务端或全量网页测试，模拟独立模式不是 iPhone 真机复验。证据 `../reader-assessment-20261105/iphone-fix/`。

### iPhone 修复发布回执

- 发布源码 `c48edb57a3c2b1a44685e48fcc75f8817c65a5db`，标签 `custom-release-reader-iphone-20261105`，回退标签 `custom-before-reader-iphone-20261105`；个人 origin 的 custom 及两标签已推送。北京时间 2026-11-05 21:20 发布前端。
- 旧网页完整备份 `/opt/reader/backups/web-reader-iphone-20261105-132046`。60 个构建文件逐一匹配 HTTP 源站，HTML/SW/入口/CSS/manifest 匹配公网 HTTPS 且证书验证正常，健康接口通过。入口 `assets/client-DdlLtYWb.js`，样式 `assets/index-Ca9wb6BO.css`；保留旧资源供现有页面更新。
- 仅更新网页，服务未重启；数据库、账号、阅读进度与插件保持原样。发布失败路径可恢复完整旧前端。完整回执、修复前后截图及检查记录在 `../reader-assessment-20261105/iphone-fix/`；尚未由真实 iPhone 复验。

## 临时技能检查与数字字号：2026-11-05

- 临时加载 Impeccable audit、官方 Playwright CLI、Webapp Testing 服务器辅助脚本和 Ponytail Review；引擎/CLI 缓存均在 `/tmp`，未安装或升级全局技能。报告见 [临时技能检查](docs/reader-skill-audit-20261105.md)。
- 用户追加要求：字号改为整数档位，默认 20，16–44，每次加减一档；快捷入口与详细滑块一致。沿用原 fontScale 存储，原字号不突变，EPUB 版式层级保留。
- 检查复现并修复四项：横屏抽屉未避开侧面安全区；悬停文字对比度仅 1.66:1；设置图标按钮 40px 小于本项目 44px 目标；32px 根字号下滑条挤窄。分别复用安全区、语义文字令牌、最小触控尺寸与容器查询修正，没有新产品依赖。
- 150 项相关单元/组件/设计契约检查、类型检查与构建通过。临时 CLI 8 条命令成功；技能流程 12 组场景与既有设置 12 组回归均通过；另以 Chromium 合成触摸及 WebKit 指针验证放大界面下的原生滑条实际生效。键盘焦点、Escape、短视口输入、PWA 根/子路径安装更新与离线均通过。
- Impeccable 仅有两条引用文字侧线告警，经上下文核对为语义标记而非卡片装饰，保留。真实 iPhone、软件键盘切换、OS 动态字号、完整无障碍审计与低端机性能仍未覆盖；缩小视口不能等同于真键盘。
- 本次为前端发布；证据与前后截图保存于 `../reader-assessment-20261105/skill-fontsize/`，实际发布源码与备份见后续回执。

### 数字字号与技能检查发布回执

- 发布源码 `fb668c4c02675e8a5923afe408caef80d36e5545`，标签 `custom-release-reader-fontsize-20261105`，回退标签 `custom-before-reader-fontsize-20261105`；个人 origin 已备份。北京时间 2026-11-05 21:56 发布完整前端。
- 旧网页完整备份 `/opt/reader/backups/web-reader-fontsize-skill-20261105-135641`。60 个构建文件逐一匹配 HTTP 源站，HTML/SW/入口/CSS/manifest 匹配公网 HTTPS 并校验证书，健康正常。入口 `assets/client-8-Wn2G9s.js`，样式 `assets/index-CJDxszAT.css`；保留旧资源供已有页面继续使用。
- 仅更新网页，未重启服务或更改账号、书籍、进度与插件数据；失败路径可恢复旧前端。临时工具和 npm 缓存已清理，全局技能未安装或升级；审计报告与证据保留。

## 朗读遮挡与正文点击修复：2026-11-05

- 发布源码 `ee5073fd1488d8d9587a42cf67e62dd8f3b6bea2`，标签 `custom-release-reader-speech-tap-20261105`；回退标签 `custom-before-reader-speech-tap-20261105`。北京时间22:21发布前端。
- 朗读栏恢复纵向两行并拉伸到可用宽度，避免播放按钮挤压到进度行。控制栏显示时，正文单击只收起并返回；隐藏后下一次单击才按点击分区翻页/跳章，保留设置/目录阻断、滑动与硬件按键导航。
- 两项修复前回归均先失败：手机朗读控制挤在进度行同一高度；右侧点击收起后仍执行next。修复后149项相关测试、类型检查/构建通过；Chromium/WebKit手机模拟PWA与桌面共4组验证朗读开始/暂停/继续/停止、按钮几何与首次收起后不翻页。既有小说/EPUB真实触摸或指针跟手、取消、对话框阻断及PWA根/子路径更新与离线检查通过。
- 旧前端备份 `/opt/reader/backups/web-reader-speech-tap-20261105-142103/web`；60个产物匹配HTTP源站，HTML/SW/入口/CSS/manifest匹配公网HTTPS并校验证书，健康正常。入口 `assets/client-D2b2Uxiu.js`，样式 `assets/index-C8KYplhA.css`。保留旧静态资源供已有页面升级；仅前端，未重启服务或修改账号/书籍/进度/插件数据。
- 证据 `../reader-assessment-20261105/speech-tap/`；语音使用浏览器测试替身，未测真实iPhone或系统/HTTP/Android音频引擎，未重跑全量网页或服务端测试。

## 设置滚动穿透修复：2026-11-05

- 发布源码 `7831e5cecd297a80efd535e3811875e1ec7371ed`，标签 `custom-release-reader-sheet-scroll-20261105`；北京时间22:52上线。共享Sheet拦截无可滚动内容或已到边界的纵向触摸/滚轮；保留内部/嵌套滚动、水平滑块、轻微抖动点击及缩放。正文拉章同时检查模态状态，已开始手势也不能在面板后触发翻章。
- 按要求简单测试：133项相关测试、字体/朗读设置的Chromium/WebKit手机/桌面共8场景、PWA根/子路径更新与离线通过。Chromium手机使用原生触摸，其他环境补事件或桌面滚轮；WebKit调整字号时既有ResizeObserver通知单列处理，其他页面错误仍失败。未做真机或全量测试。
- 60个构建文件匹配HTTP源站，关键资源匹配公网HTTPS且证书/健康正常；旧前端备份 `/opt/reader/backups/web-reader-sheet-scroll-20261105-145235/web`，回退标签 `custom-before-reader-sheet-scroll-20261105`。仅前端，未重启服务或修改正式数据。证据 `../reader-assessment-20261105/sheet-scroll/`。

## 源码同步与验收：2026-11-11（上游 67c4fbb）

- 本次范围为源码合并及个人 GitHub 备份，**未部署线上**。固定上游 `67c4fbb2abe2a71fc70d9361d69608b8b1dd42b8`，合并提交 `a748fd808ae7e784524e86d2e5d9140e1af3e761`；共同祖先 `dc6cbf5`，吸收 17 个上游提交、168 个变动文件，与定制交集 37 个文件，解决 21 个冲突文件。独立 worktree 整合并保留双方历史，main 保持纯上游镜像。
- 合并前 custom 为 `727c3864e0e14ea518d8c942f459b32d67c58746`；回退标签 `custom-before-upstream-20261111-67c4fbb`。已验证 Git bundle、差异预审、构建摘要、完整日志及浏览器回执位于 `../reader-assessment-20261111/`，整合候选在 `../reader-sync-20261111/`。
- 按用户要求以上游为基础，重叠处在共享实现上补回定制：接入扫描流式读取、PDF.js/Range、资源令牌、同步分页、媒体开关、全局搜索、错误提示、懒加载和滚动记忆；不恢复两套主题、设置、缓存或账号发布路径。
- CORS 同时保留封面 ETag/If-None-Match 与 PDF HEAD/Range/字节范围头；认证使用上游能力刷新和播放器按需初始化，补回缓存启动、3 秒验证预算、账号/服务边界和卸载取消。离线作用域仍只由登录路径选择；同步分页保留本地重读进度及待发送更新保护。
- 保留小说缓存优先开书和远端位置确认、迟到响应保护、手动下载跨路由继续、封面本地优先、统一主题/纸纹/亮度、整数 16–44 字号、紧凑设置与详细子页、PWA 安全区、下拉关闭、朗读两行和正文首次点击收起控制栏、书架分组/排序动画与离线镜像、主力/备用书源及草稿保护。额外的配色、预缓存数量和排序下拉框改用上游 Select；上游旧设置屏的折叠区由定制子页承担，不恢复旧面板。无调用的 SourceBookDetailSheet 继续删除。
- 浏览器验收发现并修复：登录验证后清理查询缓存会取消刚挂载页面的首批请求，改为显示新账号前清理，新增回归先复现失败再通过；定制 EPUB 列分页误用于固定布局 PDF，增加格式保护及 PDF paged 回归；旧原生排序样式叠加到 Select 外壳使手机书架过高，转用上游控件样式并保留首屏封面高度断言。
- server 类型检查、构建通过；538 项中 531 通过，7 项缺少真实媒体输入跳过，随后真实 FFmpeg 补跑 8 项全部通过，覆盖这些跳过项。web 类型检查、生产构建通过；完整 155 文件、1,450 项 Vitest 和 22 项 Node 检查全部通过。Android shell 契约通过。
- 最终 19 套浏览器验收均有正常退出回执：reader-touch、book-cover-cache、novel-cache-open、manual-background-download、reader-settings、reader-sheet-scroll、reader-speech-tap、reader-unified-themes、reader-status-tint、pwa-smoke、pwa-startup、react-app、pdf-layout、media-features、offline-sync、reader-text-fidelity、host-source-flow、host-extension-page、source-discovery。覆盖 Chromium/WebKit 手机/桌面、12 组设置与模拟 PWA、120 次统一配色选择、96 项系统取色、真实 HTTP/SQLite/stdio 插件流程；整站 60 张截图，无页面错误或横向溢出，并人工查看手机/桌面书架及手机 PWA 设置截图。
- PDF 首屏读取 66,729 / 8,389,801 字节；12 种布局、文本、跳页、离线字节、取消和生产 Worker 释放通过。310 个完整网页构建文件及 276 个服务端文件均记录 SHA-256，尚未发布到源站。
- 并行负载下曾触发 WebKit 缓存时间断言及一次离线导航等待失败；固定构建串行复验封面 189/455ms、缓存小说 124–486ms，原有 1 秒阈值未放宽，PWA 挂起请求/离线进程重启/刷新令牌异常/进度恢复通过。夹具适配上游 Select；主题导航等待请求稳定，设置夹具复用既有的“主动重载时、指定统计接口、WebKit”中止诊断规则，其他错误仍判失败。完整最终回执为 `final-verification.json`，初轮失败证据保留。
- 使用 Node 22.23.1 与锁定依赖；仅引入上游 pdfjs-dist 及传递依赖，保留 opencc-js。独立网络小说插件仍为 1.6.8（`69183cb`），未改容器、正式账号、书架、进度或插件数据。
- 限制：未验证真实 iPhone/锁屏、完整 Android APK、Node 24 或远端 CI；保留 Vite 大 chunk 警告。`npm audit --omit=dev` 仍报告 Web 6 项（5 high、1 critical）、server 6 项（1 high、4 moderate、1 low），涉及版本全部与合并前相同，本次未额外升级或判断实际可利用性。依赖审计与基线比对在验收目录保存。
- 个人 origin 备份范围为 custom/main 和本次非 `v*` 回退标签，不触发镜像发布。后续部署需另按本文核对生产配置、备份与数据库/插件兼容性，并发布包含 PDF.js 资源的完整构建。


## Ponytail 审查与正式发布：2026-11-11

- 用户授权在 Ponytail code review 通过后上线并上传 GitHub；继续以上游 `67c4fbb` 为基础保留个人定制。完整审查见 [Ponytail review](docs/custom-upstream-review-20261111.md)，结论 **Ship**。审查范围为 `727c386..a748fd8` 及发布修复，按现有个人实例、多账号/多标签及 SQLite/影音工作进程评估。
- 修复提交 `59f8d4d1cea94ab6f41530a851b100e2438fe026`：后台 flush 保存服务端返回的远端记录，只有记录持久化成功后才推进增量游标；发送确认保留旧下载游标，响应落盘失败后仍可重拉。另修复可选用户资料缓存写满时误退出有效账号，保留凭据并应用当前权限。共新增三个能在修复前复现失败的测试；未新增依赖。媒体浏览器 fixture 明确选择本地服务并阻断生产域名。
- 修复后网页全量 155 个测试文件、1,453 项 Vitest 测试和 22 项 Node 检查通过；关联 5 个文件 86 项回归、typecheck、生产配置 build 通过。修复未改变后端源码，沿用本次合并已通过的后端 typecheck/build、531 项默认测试及补齐七个依赖样本跳过项的八项真实 FFmpeg 检查；Android shell 检查通过。
- 当前发布包九项浏览器验收全部通过：offline-sync、media-features、react-app、manual-background-download、reader-touch、pwa/smoke、book-cover-cache、novel-cache-open、pwa/startup。Chromium/WebKit 均通过离线重启、挂起网络时开书和本地位置保留；未放宽原断言。早先合并的其余浏览器/排版验收记录仍有效。
- 实际候选镜像 Node v24.21.0 完成隔离注册/鉴权、资源令牌及 Range、旧客户端时钟下的增量同步、影音权限/独立工作进程、8 MiB 请求限制验收；Reader 业务进程 uid 100、有效 capabilities 为零。验收初次只读 books fixture 被既有入口脚本的 chown 拒绝；改为与生产一致的可写 fixture 后通过，生产挂载未改。
- 对正式数据的私有 SQLite 副本两次迁移通过，原有 reader 31 表及 media 32 表旧列记录哈希一致；旧镜像能读写迁移后的副本，两库 integrity/FK 通过。副本已清理，恢复备份另按正式停服流程创建。
- 第一次发布于北京时间 20:15 自动回退：严格设置全等校验发现上游 BusinessSettings 在启动时新增 `modules` 默认行（mediaEnabled/newUserMediaEnabled 均 true、revision 1）。核对后确认原有十组设置未改；保护条件仅允许该已知新增默认行，仍拒绝任何原有设置变化。保留旧应用恢复记录及首份已验证备份 `/opt/reader/backups/upstream-20261111-20261111-121520`，回退未覆盖最新数据库/阅读进度。
- 第二次发布于北京时间 **2026-11-11 20:17:05** 完成。实际源码 `59f8d4d`，镜像 `reader-github:upstream-20261111-59f8d4d`，镜像 ID `sha256:8cf437b101380db9b063176a86b82508459f434ef79cc4ab273cbc3375579180`。仅更新编译后的后端和完整网页，复用已核对依赖的既有运行镜像，未调整 entrypoint、Chromium 校准、Compose 端口/挂载或私有环境。
- 发布前停服备份并用官方维护工具 verify：`/opt/reader/backups/upstream-20261111-20261111-121644`，包含旧 Compose/完整网页、原书及完整 DATA_DIR（6,752 文件、258,098,400 字节）。旧镜像 `reader-github:upstream-settings-20261105-23ee384` 保留；应用回退使用旧 Compose/网页并保留最新数据库，禁止覆盖之后的阅读进度。停服至新健康约 16 秒。
- 本地 HTTP 对完整 310 个构建文件逐项 SHA-256 校验，公网 HTTPS 对 index、sw、入口 JS、CSS、manifest、PDF worker、WASM 七项逐项匹配；旧哈希资源额外保留 153 个，便于已有页面继续使用。两库完整性/外键、全部既有主键、进度不回退、业务设置/插件及签名密钥保留检查通过；现有管理员只读 API 认证、书籍列表、插件 1.6.8 enabled、mediaState ready 均正常。未创建正式测试账号或刷新令牌，其他容器未重启。
- GitHub：`59f8d4d` 和源码回退标签 `custom-before-release-20261111`（`75fb5b0`）已先行推送个人 origin；正式发布标签 `custom-release-upstream-20261111` 固定实际上线源码 `59f8d4d`。本文和审查报告的最终发布记录单独提交并推送 custom，main 仍为纯上游 `67c4fbb`；不推上游，不触发 `v*` 镜像工作流。
- 构建、测试、迁移、首次回退和正式发布回执：`../reader-release-20261111/`，含 build-manifest.json、migration-verification.json、runtime-verification.json、browser-release-*.json、first-attempt-rollback.json、publication.json、live-verification.json。构建环境文件保持 ignored，不上传运行数据或凭据。
- 未验证：iPhone 真机/锁屏、完整 Android APK、远端 CI、全部外部书站。既有 npm audit 告警（web 六项、server 六项）版本与本次合并前一致；未做无关依赖升级或强制 audit fix。Vite 大包提示仍在。后续发布预检应包含 BusinessSettings 启动初始化，而非只跑 Db 迁移，避免把合法新增设置误判为数据改写。

## 自动采用追更新目录：2026-11-12

- 用户反馈定时追更正常、开书仍需手动刷新目录。确认不是任务丢失：正式九条订阅仍启用，当前每小时检查；但 `revalidateCachedNovel` 把后台取得的新 manifest 只落入本机缓存，没有采用到当前页面，导致目录与章数停留在开书时的快照。定时检查间隔内书站刚发布的章节仍要等下一次成功检查，此次修复不把定时任务改成即时推送。
- 修复源码 `c2ca052a411916f539c8e64064f235e273637aed`：在落盘成功及账号/服务/开书令牌仍匹配后，更新 manifest、目录、章数和阅读视图的章节映射；保留当前章节对象及其正文、选区、滚动位置。目录中间插章时按稳定 href 重新定位章节索引；正在加载的跳章在返回后重新按 href 定位，避免把旧索引当成新位置。手动刷新/换源/关闭及权限拒绝原有取消逻辑保留。
- 修复前新增回归复现失败：后台已返回第三章，当前目录仍只有两章。修复后关联四个文件 171 项测试通过，覆盖直接采用目录、新增章节进入、中间插章后的下一章、并发加载时的插章、分页/重排、账号与关闭后的迟到响应、离线和鉴权失败；生产 build（含 typecheck）通过。主工作区首次构建发现依赖目录旧于当前锁文件、缺少 pdfjs-dist，按原锁 `npm ci --ignore-scripts` 补齐后通过，未改依赖声明或锁文件。
- 最终生产包浏览器验收：novel-cache-open、reader-touch、pwa/smoke 均 exit 0。Chromium/WebKit 手机及相关桌面用例通过缓存先开书、位置两种选择、翻页取消与跨章、PWA 根/子路径更新和离线检查；原断言未放宽。未重复后端/FFmpeg 全量及真机检查，后端源码没有变化。
- 北京时间 **2026-11-12 18:52:33** 发布完整 310 个网页文件，入口 `assets/client-DRQzlsyM.js`，样式 `assets/index-DpTbR8pc.css`。逐项本机 HTTP SHA-256 及公网 HTTPS index/SW/入口/CSS/manifest 匹配，健康正常。完整旧网页备份 `/opt/reader/backups/web-reader-toc-sync-20261112-105233/web`；保留旧哈希资源，发布脚本校验失败自动恢复旧网页。本次只替换网页，Reader 容器 ID/StartedAt 相同，后端仍为 `reader-github:upstream-20261111-59f8d4d`，未执行数据库/插件变更。
- 已先推送修复和 `custom-before-toc-sync-20261112`（`23ede21`）；实际网页发布标签 `custom-release-toc-sync-20261112` 指向 `c2ca052`。本文及调研方案单独提交，继续只推个人 origin，不推 upstream 或 `v*` 标签。
- 新章节角标尚未实施。用户同时要求联网调研实现方式，建议、现状和参考来源见 [新章节标识方案](docs/reader-update-indicator-proposal-20261112.md)。现有 `new_chapters` 是累计检测数，不能直接写成未读章数；消除时机需区分看过目录与读到新增部分，不用无条件 acknowledge 清掉并发新增。
- 证据目录 `../reader-toc-fix-20261112/`：before.log、after.log、connected.log、build-final.log、browser-final.json、build-manifest.json、live-before.json、publication.json。构建包和线上数据/私有环境不入库；依赖告警及 Vite 大包提示沿用既有版本，未做无关升级。


## 主题数字新章节角标：2026-11-12

- 用户确认封面只显示阿拉伯数字、跟随主题颜色，授权完成后上线和上传 GitHub。实际发布源码 `32def9d71e6a64091fd8bdb729e304f37ce1eafc`（含 `3dca085` 主实现、`a77012e` 单条进度兼容修复、`32def9d` 首页独立续读入口补齐）；[完整 Ponytail 审查](docs/reader-chapter-badges-review-20261112.md) 结论 Ship。[功能规则](docs/reader-update-indicator-proposal-20261112.md) 已更新为实现状态。
- 书架、首页书架区及独立续读封面仅显示数字，零时隐藏；复用 `--color-brand` / `--color-on-brand`，无写死色值。屏幕阅读器从链接名称获知新章数量。字体/圆角用现有设计令牌。前台回到页面、联网恢复及可见页面每分钟查询 Reader；不增加对外部书站的前台抓取。
- 章节刷新事务按稳定 ID 维护新列 `chapter_subscriptions.pending_chapter_ids`，当前目录是启用基线；旧 `new_chapters` 累计字段保留用于旧版本兼容，不把已读过的历史几十章误标成新提醒。单本、书架和续读 DTO 返回 `newChapters`，按账号投影。定时订阅的启用状态与间隔保留，正式九条订阅仍为每小时检查。
- 阅读按当前位置消除之前的新增章节；当前章末页可见时，持久化进度携带可选布尔 `chapterComplete`，涵盖一页短章而不改写 locator。批量 POST 和单条 PUT 均验证并传递该信号；旧客户端依然可用结尾 locator 确认。跳到后面会把前面的新增部分视为读过，回看不重新加回。只是开书、读取目录和缓存正文不清除；离线保留已知数，完成信号随原有 outbox 同步。追加新章、旧进度和账号隔离回归通过。
- 验证覆盖：后端合计 540 项（全量及环境修正/最终定向复验，533 通过、7 项媒体样本跳过）；最终 Node 24 章节/HTTP/同步 26 项通过。网页合计 1,468 项 Vitest 加 22 项 Node 检查；全量两项 CSS 契约失败改用既有令牌后定向复验通过，最终阅读/同步/卡片 145 项、首页/卡片/设计 29 项均通过。两端类型检查和构建通过。首次 Node 24 全量使用镜像默认 WEB_DIR 与只读编译目录造成两项环境失败；修正为不存在的测试 WEB_DIR、独立可写 dist、非 root 后 51 项相关测试全部通过，含权限检查。
- 浏览器：Chromium/WebKit × 手机/桌面共 120 次主题选择通过，最小数字对比度 5.44:1；数字正数/零转换、离线保留、恢复联网、首页续读封面及溢出检查通过。人工检查日夜与桌面截图；缓存开书、offline-sync、PWA 回归通过，正式最终 bundle 另跑 PWA smoke 通过。实际候选容器 HTTP 计数与两类进度消除、媒体权限及进程低权限检查通过。
- 生产数据私有副本两次迁移幂等，reader/media 各 32 表所有既有列记录哈希保留；旧镜像读写探针在事务内回滚，避免无意义更新触发同步游标。副本已清理。无新运行依赖；没有变更 upstream、锁文件、入口脚本、Chromium 校准、私有环境或 Compose 的端口/挂载。
- 北京时间 **2026-11-12 22:43:16** 正式发布完成。镜像 `reader-github:chapter-badges-20261112-32def9d`，ID `sha256:0ad5ce95ee24409cb68a801e506b2c08485701e30da0b029f9d72394dc5b4cf6`；入口 `assets/client-BQ1Ha9eZ.js`，样式 `assets/index-BqS_HE-H.css`。完整 310 文件本地 HTTP SHA-256 校验及公网 HTTPS 七项（index/SW/入口/CSS/manifest/PDF worker/WASM）匹配；额外保留 210 个旧哈希资源。
- 停服备份 `/opt/reader/backups/chapter-badges-20261112-20261112-144249`，包含旧 Compose/网页、原书及 DATA_DIR；官方 backup/verify 校验 6,752 文件、260,190,402 字节通过。停服到新健康约 23 秒；旧应用镜像保留。失败回退只还原应用与网页，保留最新数据库和进度。发布后两库完整性/外键、全部原主键、进度不回退、设置/插件/签名密钥保留检查通过，其他容器未重启。现有管理员只读 API、书籍、真实新章字段、插件 1.6.8 和 mediaState ready 检查通过，未创建正式测试账号或刷新令牌。
- GitHub：代码与源码回退标签 `custom-before-chapter-badges-20261112`（`48f127d`）已上传；正式发布标签 `custom-release-chapter-badges-20261112` 固定实际发布源码 `32def9d`。本记录、API 文档和审查报告单独提交上传 custom；不使用 v* 标签，不推 upstream。
- 证据目录 `../reader-update-badge-release-20261112/`：完整/定向测试日志、120 主题检查与截图、build-manifest.json、migration-verification.json、runtime-verification.json、publication.json、live-verification.json。未做 iPhone 真机/完整 Android APK/远端 CI/全部书站复验；继承的 npm 告警和 Vite 大包提示保留，未做无关强制升级。


## 发布后清理：2026-11-12

- 按用户要求清理垃圾，沿用完整部署、网页、插件各保留最近一份备份的规则。已验证并保留 `/opt/reader/backups/chapter-badges-20261112-20261112-144249`、`web-reader-toc-sync-20261112-105233`、`plugin-shuqi-20261106-060905`；此前记录中的其他七份历史备份已删除，历史发布记录仍保留用于追溯。
- 当前镜像 `reader-github:chapter-badges-20261112-32def9d` 与最近回退镜像 `reader-github:upstream-20261111-59f8d4d` 保留；删除四个闲置 Reader 镜像及闲置构建缓存。删除五个已合入 custom 的临时工作树/本地分支及八处生成副本，实际回收 3.27 GiB。保留主源码、插件源码、效果图和测试/发布回执。
- 工作树的非构建类 ignored 文件先逐文件校验归档，私有清理凭据与恢复索引见 `../reader-cleanup-20261112/`，不上传环境文件或数据。旧发布脚本引用的临时工作树已移除，复用时改用当前源码与私有配置；Git 历史和发布标签不变。
- 清理期间五个生产容器的 ID、镜像、启动时间、重启次数、挂载未变；数据库、书籍、Docker 卷未清理，Compose/签名密钥/当前网页入口哈希不变。完整备份官方 verify、网页清单及插件包/数据库校验通过；清理后现有账号只读 API、书籍新章字段、插件 1.6.8、mediaState ready 和健康复验通过。本提交仅更新文档，不重新部署。


## 我的页面固定更新入口：2026-11-13

- 按用户最终位置要求，独立「立即更新」卡片放在「账号」区域正下方，与账号在同一列，按正常页面顺序滚动；手机使用现有分组排序，桌面跟随账号列。没有新增悬浮或吸底控件，原有自动更新浮层按用户要求保留。管理员和成员均可操作；主题、焦点和 54px 行高复用现有样式。
- 源码 `e475d635511a386b620824524c58a785d4b7c21e`（`42bd8a9` 功能与 `e475d63` 最终位置），[Ponytail 审查](docs/reader-manual-update-review-20261113.md) 结论 Ship。手动和自动入口共用保存/激活流程；先检查及下载，再保存本地阅读/播放进度，成功后启用并刷新。已是最新版、离线、环境不支持或未准备好均在卡片提示；失败保留页面并允许重试。检查/下载各 60 秒预算，激活沿用 15 秒预算；不清除书籍缓存、登录信息或数据库。
- 61 项更新、Mine、保存钩子、账号隔离及设置测试通过，类型检查和生产构建通过。最终 Chromium/WebKit × 手机/桌面四组验证账号下方的正常排布、最新/离线提示、保存失败重试、先保存后激活、多窗口逐个确认、登录保留及点击区域；PWA 根与子路径离线升级回归通过，日夜截图检查和界面检测通过。
- 同时修复自托管 CDN 对固定 `sw.js` 的数小时缓存：nginx 单独返回 `private, no-store, no-cache, must-revalidate`。公网脚本和源站哈希匹配，Cloudflare BYPASS；nginx 检查配置后平滑重载，私有原配置在证据目录。此发现不能证明是用户设备未见按钮的唯一原因。
- 北京时间 **2026-11-13 07:17:18** 发布完整 310 个网页文件，入口 `assets/client-CntFGcNC.js`，样式 `assets/index-9BqJTB8q.css`。全部文件本机 HTTP 哈希匹配，公网 index/SW/入口/CSS/manifest 匹配，健康及现有账号只读书籍/新章计数/插件 1.6.8/mediaState ready 复验通过。五个生产容器的 ID、镜像、启动时间、重启次数和挂载不变；后端仍为 `reader-github:chapter-badges-20261112-32def9d`。未更改数据库、书籍、插件、Compose 或签名密钥。
- 发布前完整网页备份 `/opt/reader/backups/web-reader-mine-update-20261112-231715/web` 逐文件校验通过，失败路径只恢复网页；保留 239 个旧静态文件供已有页面继续加载。按原清理规则移除过期网页备份 `web-reader-toc-sync-20261112-105233` 与任务临时脚本，最新完整部署、网页、插件备份各一份保留，两份应用镜像保留。测试、截图、配置回退和发布凭据在 `../reader-pwa-diagnosis-20261113/`，不上传私有环境与数据。
- 源码及回退标签 `custom-before-mine-update-20261113`（`4848128`）已推个人 origin；正式发布标签 `custom-release-mine-update-20261113` 固定 `e475d63`，发布记录另提交 custom，不推 upstream 或 v* 标签。首次使用新卡片须让旧页面更新一次；可先用原自动更新提示，或关闭 Reader 页面和独立窗口后重新打开，不需要清站点数据。未做 iPhone 真机、Android APK、远端 CI 或无关后端全量测试；既有 Vite 大包提示保留。


## 首页新章书可见性修复：2026-11-13

- 用户确认在首页看不到数字提醒。只读任务状态确认已有待提醒章节，但对应书排第九，首页只取最近八本；并非该数字没有生成。修复源码 `551ed1bbb4c8b5ac195f252081962d231483c6f7`：在首页已取回的书架数据中将待提醒书稳定排在前面，再取八本；同组原顺序保留，不修改共享查询数组。归零后回到原最近阅读顺序，「继续阅读」仍是最近那本，完整书架排序保持原规则。首页沿用原有首批 60 本数据范围。
- 新增第九本新章书的回归在修复前失败，修复后首页/书架/PWA/Mine 共 52 项通过；覆盖数字、归零回序、继续阅读与缓存数组不变。类型检查及构建通过。最终 Chromium/WebKit × 手机/桌面四组验证数字直接可见、归零恢复顺序、离线保留数字及续读不变；PWA 根/子路径回归和界面检测通过。[Ponytail 审查](docs/reader-home-updates-review-20261113.md) 结论 Ship。没有新接口、依赖、样式或后台抓取。
- 北京时间 **2026-11-13 14:49:41** 发布完整 310 个网页文件，入口 `assets/client-CDOfDStC.js`，样式 `assets/index-9BqJTB8q.css`。全部本机 HTTP 哈希、公网 index/SW/入口/CSS/manifest 匹配；公网真实浏览器安装新版离线资源通过，健康正常。五个生产容器及 Compose/签名密钥不变，后端仍为 `reader-github:chapter-badges-20261112-32def9d`，没有写入正式账号、阅读进度或书籍数据。
- 网页回退备份 `/opt/reader/backups/web-reader-home-updates-20261113-064938/web` 已逐文件验证；保留 267 个旧静态文件供已有页面加载。按原保留规则删除被替代的 `web-reader-mine-update-20261112-231715`，完整部署/网页/插件备份各最近一份及当前/最近应用回退镜像保留。证据 `../reader-chapter-badge-diagnosis-20261113/` 含修复前失败、测试、浏览器截图、构建/发布/清理凭据，不上传正式私有数据。
- 源码及回退标签 `custom-before-home-updates-20261113`（`c6396c5`）已推个人 origin；发布标签 `custom-release-home-updates-20261113` 固定 `551ed1b`，本记录另提交 custom，不推 upstream 或 v* 标签。未做 iPhone 真机、远端 CI、无关后端全量或所有书源修复；诊断时七条订阅最近检查失败，会影响后续发现新章，本次不伪造数字或回填旧累计数。
