# Reader 主线整合与发布 — 2026-11-27

北京时间 **2026-11-27 16:18:10** 已上线。上游固定 `1e2bf3d567d770fd9c88b4f9d9145c6760bf25e4`，实际源码 `306948a2d8574103b3ddb53c2a8fbb7a03b234c3`，镜像 `reader-github:upstream-20261127-306948a`。书源插件保持 **1.6.11**。

## 整合

- 在 11 月 25 日版本基础上正常合并上游 12 个提交。原 custom 为 `508df4e`，5 个文本冲突逐项整合；合并保留 custom/upstream 两条历史。数据库 schema 与依赖锁文件未变化。
- 修复旧比例 locator 在四位小数和浏览器像素舍入后重开书页码回退的问题；保留 `@文字偏移`、文字锚点优先、现有逐行分页与 EPUB 列分页。只有无文字锚点的滚动比例恢复会吸附接近的页边界，自由滚动仍保留位置。
- 搜书及原生媒体队列复用既有 `newId()`，兼容非安全 HTTP 中没有 `crypto.randomUUID` 的环境；初始化进入异常清理流程。保留停止/继续搜索、迟到响应保护、函数式流式合并与共享书源详情。批注检查 `clipboard.writeText` 是否可用，并继续复制繁简转换后的显示文字。
- OPDS 下载链接包含原始文件名，响应保留 ASCII 与 UTF-8 两种 filename；TXT 原始下载不再错误声明 UTF-8，旧下载 URL、权限及 Range 继续有效。
- 合入上游 Android 版本化 APK、空签名环境变量处理和发布说明流程。未执行密钥/secrets 脚本，未使用 `v*` 标签触发发布。既有新液态玻璃、31 项统一配色、缓存优先、离线落点、后台下载、账号及进度保护保持。

## 验证

- Node 24.22.3：server 全量 598 项，591 通过、7 项默认媒体条件跳过；web 全量 171 文件、1663 项 Vitest 和 22 项 Node 检查通过。双端类型检查/构建、变更文件格式与 Android shell 契约通过。沙箱首轮出现 Node 原生断言及未完成测试，主机环境限制两名 worker 后完整复验通过。
- 旧版本的第三页重开回归先失败，上游通过；整合后回归通过。新增滚动/分页文字锚点优先及显示文字复制检查通过。搜书单元测试夹具补齐当前封面缓存所需的账号接口。
- 最终生产构建 11 套浏览器/PWA 全通过：host-source-flow、source-discovery、reader-touch、reader-text-fidelity、book-cover-cache、novel-cache-open、manual-background-download、home-reading、smoke、startup、reader-unified-themes。各脚本沿用自身引擎配置。HTTP 搜书使用映射至本机的普通 HTTP 主机名，并断言 `isSecureContext=false` 和 `crypto.randomUUID` 不存在，再验证真实 SQLite/stdio 插件的安装、流式搜索、入架和阅读。
- 实际候选容器 Node 24.21.0，使用与原版一致的依赖锁文件复用运行依赖；以 Reader 的 uid100 验证登录、权限、同步、资源票据、插件安装/RPC、媒体 worker 和零 capabilities。额外核验中文 TXT 文件名、GBK 原字节、双 filename、旧 URL、Range、未授权拒绝与撤销凭据。外部验收脚本修正相对链接解析及执行身份后通过，未改应用以适配夹具。
- 正式 reader/media SQLite 只读备份副本重复打开一致，旧镜像事务内读写回退通过；所有原表摘要、完整性和外键保持。私有副本已移除。

## 发布与回退

- 完整停服备份 `/opt/reader/backups/upstream-20261127-20261127-081710` 已通过官方 backup/verify，保留原书、数据、旧网页、Compose 和插件包；原镜像 `reader-github:upstream-20261125-7b4a620` 保留。失败路径回退应用和网页并保留最新数据库。
- 本机 HTTP 核对 327 个完整构建文件，公网 HTTPS 核对 7 项关键资源；保留旧哈希资源供已打开的页面继续加载。入口 `assets/client-Bfo0zr1F.js`，样式 `assets/index-DMf947Ft.css`。
- 原主键、进度不回退、业务设置、插件身份及个人配置、签名密钥保持。插件实际安装文件与 1.6.11 包核对 1984 项；其他容器未重启，维护会话已退出。
- `main` 只快进至上游 `1e2bf3d`；回退标签 `custom-before-upstream-20261127` 固定原 custom，发布标签 `custom-release-upstream-20261127` 固定实际构建源码。按用户已有明确授权推送个人 `wuxf1992/reader`，不推上游。发布记录另提交 custom。
- 证据位于 `../reader-assessment-20261127/` 与 `../reader-release-20261127/`；私有环境、凭据、数据库和安装包未入库。历史备份与镜像未清理。

已有 PWA 使用“我的 → 立即更新”。未测 iPhone 真机、完整 Android APK、全部外部书源和远端 CI；本轮未另跑默认跳过的媒体实文件测试。
