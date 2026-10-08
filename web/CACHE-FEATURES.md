# 目录缓存、预缓存与阅读工具

目录在已成功写入当前设备、当前账号缓存的章节右侧显示低对比度「已缓存」，没有额外边框。阅读载入、自动预缓存完成时，已打开的目录也会更新；清理后再次打开目录重新核对缓存。章节采用现有 renditionRef 和目录版本映射，旧版本或其他账号的资源不算当前章节缓存。

「工具 → 缓存」增加自动预缓存开关和后续章节数，默认开启 3 章，可选 1、3、5、10、20、50 章，按设备保存。针对远程小说及按章加载的 TXT；旧服务端的整文件模式继续提供手动下载。

自动任务由阅读页持有，关闭工具面板后继续，逐章下载，跳过已缓存内容。手动下载优先；关闭开关、跳章、离开阅读、换源及刷新时取消旧请求。断网、浏览器省流量或 2G 网络暂停，重新联网或进入新章节重试。缓存写入失败时停止并在缓存页显示原因，当前正文保留。沿用现有账号隔离与设备账号配额，不自动删除原书、笔记或进度。清理当前书籍缓存前取消待完成的预缓存请求。

工具面板支持点击外部收起，关闭图标与目录、朗读采用同一图标及尺寸；原生对话框的焦点管理保留。保存编辑期间阻止误关闭；从内部开始拖动至外部不会误关闭。手动下载仍会在关闭面板后暂停，配置页明确说明。

验证：66 项相关 Vitest 测试、29 项 API/分页 Node 测试、TypeScript 检查及生产构建通过。Chromium/WebKit 手机和桌面共 8 组场景验证目录标记、加载更新、目录动画与定位、外部关闭、后台继续、配置刷新恢复及窄屏布局。浏览器 API 使用模拟数据；WebKit 的被故意阻断的初始实例探测及刷新时同步取消可能产生导航警告，检查仅放行这两种已知请求，其他页面错误仍失败。未测试手机真机或系统软键盘；浏览器休眠、关闭网页后的继续下载不保证。

全库回归：1047 项通过、15 项失败，另有 1 个套件因缺少服务端源码未加载，6 个已有 jsdom 异常。对部署前源码重跑全部失败文件，失败项集合与本次相同，未将它们计为本次通过。详情见 CACHE-BASELINE-COMPARISON.json。

回归命令：

```sh
npx vitest run test/chapter-reader.test.ts test/reader-chrome.test.ts test/reading-tools-core.test.ts test/book-offline-link.test.ts test/cache-settings.test.ts test/modal-dismiss.test.tsx
npm run build
node tools/ui-review/cache-features.mjs
node tools/ui-review/toc-sheet.mjs
```

本环境浏览器路径为 /tmp/reader-browser-check/browsers，可设置 PLAYWRIGHT_BROWSERS_PATH 使用。
