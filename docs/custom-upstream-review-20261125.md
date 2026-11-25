# Reader 主线整合与发布 — 2026-11-25

北京时间 **2026-11-25 16:40:04** 已上线。上游固定 `f72fe421898d176a7074fcbf29dcdf61957c8eef`，实际构建源码 `7b4a6200a35c1e7356cd752245fbfdbd8127b78c`，镜像 `reader-github:upstream-20261125-7b4a620`。发布源码与后续测试脚本/发布文档分别提交，不重写已共享历史。

## 整合与定制退场

- 共同祖先 `4d827c2`，原 custom `0c697c1`；主线新增 35 个提交，700 个变更文件，131 个与 custom 重叠。标准 merge-tree 涉及 92 个冲突文件。用上游锁定的 Prettier 3.10.1 归一化临时比较副本后，人工处理 20 个文件；最终 merge 仍以正常 custom/upstream 为父提交，未改写主线或既有共享历史。排除 Merge/style/docs/chore 提交后，功能变化涉及 111 个文件，37 个与定制重叠。
- 原工作区 16 个已修改文件和一个新文件已逐字节备份，独立提交 `2fc87e2` 后合入；包含 IANA 历史时区统计、删除重复书籍后的扫描重试、书库详情元数据和离线章节后台刷新竞态修复。原始 patch、新文件、安全 stash 与 Git bundle 均保留在私有评估目录，未丢弃其他工作。
- 按用户要求，新的 Liquid Glass 完整替换旧玻璃实现。删除旧开关、AppSettings 字段、根节点材质状态、旧 CSS 和旧浏览器脚本；读旧设备设置时只移除退役字段，配色、亮度、字号和位置保持。上游 `glass` 融入现有唯一主题存储与选择器，共 31 项配色；不恢复重复主题层或 SourceBookDetailSheet。
- 保留缓存优先书架/续读、共享封面缓存、离线小说落点确认、AppRuntime 后台下载、账号边界、取消与迟到响应保护、新章角标、主题迁移、阅读手势与 PWA 更新前保存。PDF 增强解析复用原下载任务与缓存版本；按章下载仍同时保存原 PDF 供插图离线渲染。
- 接入先净化后挂载的正文安全处理、书籍资源响应隔离、依赖修复、PDF 双模式、Artplayer 和朗读/音频界面。上传采用主线新规则：默认只进入书库，手动加入书架；autoShelf 开启时仍自动入架。独立书源插件保持 1.6.11。

## 复现并修复的问题

1. PDF 切到普通书后遗留 PDF 控件：每次开书重置模式状态，迟到的 manifest 先核对加载代次。
2. PDF 模式保存的迟到响应重新打开已离开的书：保存/进度写入后核对书籍、代次和销毁状态。
3. 保存进度失败仍重新开书：保留当前页面、清理忙碌状态并提示错误，不吞掉失败。
4. Artplayer 在触摸设备不初始化桌面快捷键，外接键盘的 Space 失效：共享适配层处理 Space，保留编辑框、修饰键、锁屏和销毁边界，避免重复切换。

上述新行为回归均先失败、修复后通过。测试脚本另修正旧不透明面板假设、npm CLI 路径环境、统一主题入口和冷启动夹具；WebKit 仅将主动 reload 期间的本机请求取消单独记录，其余页面错误仍失败。重连恢复挂起请求，避免用主动断开连接制造伪 CORS 错误。

## 验证

- 构建/单元环境 Node 24.22.3；候选实际运行 Node 24.21.0，fresh locked production dependencies，省略可选原生包。server/web 类型检查与构建、Android shell 通过。生产依赖 npm audit 为 0；未做无关开发依赖升级。
- server 全量 598 项：591 通过，7 项默认媒体条件跳过；另跑真实 FFmpeg/字幕 11 项全部通过。web 最终全量 170 文件、1646 项 Vitest + 22 项 Node 检查全部通过。
- 最终生产构建 15 套浏览器/PWA 全通过：reader-touch、book-cover-cache、novel-cache-open、manual-background-download、reader-unified-themes、reader-status-tint、reader-text-fidelity、home-reading、smoke、startup、host-source-flow、react-app、pdf-layout、media-features、source-discovery。各脚本引擎范围沿用本身配置，不称全部场景都双引擎。
- 统一主题 Chromium/WebKit × 手机/桌面四场景，124 次选择通过；新玻璃材质、旧配置迁移、跨入口一致、刷新/系统明暗和截图检查通过。整站 68 张截图；人工查看手机 Chromium 与桌面 WebKit 的新玻璃截图。
- 两核 VPS 并行负载曾导致缓存时间断言失败；保持原门槛、释放测试负载后单独复测通过。封面显示 Chromium 89ms / WebKit 253ms；所有 API 挂起的缓存首页冷启动 280ms / 243ms。无缓存错误/重试仍通过。
- PDF 浏览器真实 8MiB 夹具首屏 Range 66729 字节，12 种布局、文字层、搜索/跳转、离线字节和 worker 释放通过；实际候选容器另验证无原生 canvas 时的 PDF 提取。候选隔离容器验证登录、权限、资源票据、同步、插件安装/RPC、书架默认、媒体 worker 和 Reader uid100/零 capabilities。
- 正式 reader/media SQLite 只读备份副本迁移两次一致，再用旧镜像事务内读写回退；原 34/33 张表的数据摘要、完整性与外键保持。副本已移除，未用测试账号请求生产站点。

## 备份与发布

- 完整停服备份 `/opt/reader/backups/upstream-20261125-20261125-083904`，含数据、原书、网页、Compose 和插件包；官方 backup/verify 通过。原镜像 `reader-github:upstream-20261120-2bcda28` 保留，失败路径自动回退应用和网页并保留最新数据库。
- 实际发布 HTTP 328 个文件与构建 SHA-256 匹配，公网 HTTPS 7 项关键资源匹配；保留旧哈希资源供已打开页面继续加载。
- 生产两库完整性/外键、原主键、进度不回退、业务设置、插件身份与个人配置、签名密钥保持；插件 1.6.11 实际文件与包逐一匹配。其他容器未重启，维护会话已退出。
- `main` 仅快进至上游；回退标签 `custom-before-upstream-20261125` 为原 custom，发布标签 `custom-release-upstream-20261125` 固定实际构建源码。用户已明确授权推送到 `wuxf1992/reader`；不推 upstream，不用 v* 标签触发上游镜像流程。
- 私有证据 `../reader-assessment-20261125/` 与 `../reader-release-20261125/`；不上传私有环境、原始数据库、凭据或安装包。历史备份/镜像未清理。

已有 PWA 使用“我的 → 立即更新”，不清理本地缓存。新玻璃在“外观与主题 → 液态玻璃”选择。未测 iPhone 真机、完整 Android APK、全部外部书站与远端 CI 结果；浏览器模拟不替代真机。
