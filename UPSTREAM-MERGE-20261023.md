# Reader 本地合并交付（2026-10-23）

本次交付位于 `/home/ubuntu/codex/reader-main-merged-20261023`，保留独立 Git 历史与对象。
原工作区 `/home/ubuntu/codex/reader-main-sync` 未替换；未部署、重启容器或操作生产数据库。

## 合并来源与处理

- 本地基线 `8b185e22a6bfba5d88986ccf9978ef19750a10ad`，另将原工作区全部定制保存为快照 `e719c2a` 后执行合并。
- 上游 `main`：`dca100425a29ed6127a86ebe1a6be848f6828726`，合入上次同步后的 27 个提交。
- 原目录保留 55 个 tracked 修改、31 个 untracked 文件；原 `git diff HEAD --binary` 的 SHA256 为 `784ca374e210fa651b56f2a571fa360e5bfe0e7329415b810546f9a67f5bbe8e`。
- 采用上游 V3 的导航、首页、MinePage、应用主题、原生 Sheet 与插件管理；删除 Mantine、sweetalert、旧 Modal 调用，锁文件保留本地 `opencc-js@1.4.2`。
- 本地全部 21 项阅读配色作为 `local-*` 阅读纸色保留，包括日夜记忆、纸张纹理、亮度与浏览器状态色。应用根元素仍由 V3 主题控制，本地配色只写阅读容器。
- 保留页面独立边距、设置折叠记忆、正文分页/定位及翻页队列、繁简转换与原文锚点、自动预缓存/目录缓存标记、账户与服务器隔离的离线书架、封面条件请求与离线缓存。
- 书架读取状态、series/tag 分组与离线筛选共存；recent 继续使用本地服务端最近阅读排序。缓存响应按 ID 合并，筛选页不会替换完整缓存；状态来自服务端派生结果。
- 本地书源详情与 205 章目录预览迁至原生 Sheet，保留按需读取、排序、取消、已入书架状态、封面与长简介。嵌套 Sheet 的 cancel 不向父 Sheet 冒泡。

## 实际验证

- `npm --prefix web run build`：通过（含 TypeScript）；构建仍按项目既有方式输出单包，Vite 提示单包超过 500 KB。
- `npm --prefix web test`：121 个 Vitest 文件、1121 项通过；另 29 项 Node 测试通过，0 失败。
- `npm --prefix server run build`、`npm --prefix server run typecheck`：通过。
- `npm --prefix server test`：489 项中 482 项通过，7 项未配置真实媒体工具时跳过，0 失败。主代理随后用宿主机 FFmpeg/FFprobe 补跑相关 3 文件，8/8 通过、0 跳过。
- `server/test/media-scanner.test.ts`：9/9 通过，额外覆盖旧 media_scan_jobs 无 total/diagnostics 列且保留历史记录的升级与二次打开。
- 主代理另用旧 Db 创建合成用户与书架数据，再用新版 Db 打开两次：reading_status 追加为 NULL，原关系保留。
- Chromium/WebKit，390/1280：繁简转换、分页位置、TTS、离线恢复和全局设置，4 场景通过。
- Chromium/WebKit，手机/桌面：自动预缓存、关闭工具后继续、目录实时标记、重载设置、未缓存章节不标记、视口适配，4 场景通过。
- Chromium/WebKit，390/1280：书海按需加载 200 项导航；目录详情的 205 章排序、已加入书架、简介、按需请求、二次缓存和 Escape 保留父 Sheet，4 场景通过。
- Chromium/WebKit，手机/桌面：目录进入动画、无外层滚动、当前章节居中、已缓存标记，4 场景通过。
- Chromium/WebKit：封面首次 200、关闭重开 304、封面变化 200、离线本地图像通过。
- Chromium/WebKit，390/1280：8 个旧服务端进度恢复场景及后续前进/后退保存通过。
- Chromium，390/1366：前后翻页与短末页无视觉反向跳动通过。
- 主代理独立复跑 5 个关键前端文件：96/96 通过。
- 主题矩阵：Chromium/WebKit × 320/390/1280 × 21 项配色，共 126 场景通过；另补验 Chromium 启动屏恢复颜色通过。Chromium 日志尾部旧断言失败保留为过程证据，修正后的启动屏补验及 WebKit 完整报告一并交付。

## 上线前需要知道的变化

- 服务端增加 `user_books.reading_status`；MediaScanner 初始化会追加 `media_scan_jobs.total`，保留旧历史。
- 上游媒体自动扫描默认为开启、每小时运行。上游 `mediaHidden=false` 会在后续扫描中将隐藏路径当作不存在；本次保留上游默认与行为。
- V3 登录后的入口是首页；旧设置路由转入 MinePage。阅读纸色与应用主题独立保存。
- 一次旧 page-turn 脚本未先覆盖构建默认服务地址，曾使用 fixture 的假账号密码尝试登录；未提供真实账号凭据或获得真实会话。发现后立即终止，补生产域阻断及显式本地 origin 后通过。未查看线上审计日志，失败请求可能被记录。
- 未部署，未做真实 iPhone/Android 设备或 Docker 镜像运行验证；浏览器均使用隔离临时服务与合成数据。

## 构建产物与证据

浏览器验证期间最终 bundle 已冻结，交付时再次核对哈希。日志与截图位于 `artifacts/merge-verification-20261023/`，该目录按项目规则不纳入 Git。

| 产物 | SHA256 |
| --- | --- |
| web/dist/assets/client.js | 2aaaf40114ba93a25e3c78bd9c455c92c19d2ca79c37e2ec0ae60ee1bcbcb3d9 |
| web/dist/assets/index.css | fb48fca7fa12137ad7347db1738f6baadc0c4f47e50804aea2555ae547cc4fef |
| web/dist/index.html | e9b033c4136a952b60409cb444239240b1b8bd24c938ea8c4fc68c722719dfc2 |
| web/dist/sw.js | e7d210b8991d9379c2ec22b625dbb1e298e5c98cc950b293c4a043ae620f2c59 |

## 主代理验收

已独立审阅主题迁移、离线账户隔离、最近阅读排序、书源详情与嵌套弹层，以及封面权限和缓存补丁；独立复跑 96 项前端关键回归、8 项真实媒体检查及旧数据库追加迁移。未发现阻止本地合并交付的问题。原工作区 805 个文件的 SHA256 与任务开始记录一致；最终构建产物与浏览器验证记录一致。验收范围为本地合并，未验收生产部署。
