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
