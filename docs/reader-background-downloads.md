# 手动下载跨页面继续（2026-10-29）

原实现由 ReadingTools 创建 OfflineDownload，工具面板卸载时主动暂停。手动下载改由 AppRuntime 持有的 OfflineDownloads 管理，同一本书重开面板时订阅已有任务，面板只负责展示和操作。

## 用户行为与维护契约

- 收起工具、继续阅读、返回书架或进入其他页面时，下载继续；再次打开本书工具显示当前状态。任务运行时重开面板不得重复恢复磁盘状态、变成暂停或发起第二个下载。
- 保留手动暂停、取消和章节范围。每章完成后保存缓存与任务；页面被系统中断后恢复已保存范围；残留的“运行中”标记转为“已暂停”，网络错误也允许续传。点“下载 / 继续”复用已缓存章节。完成或取消的旧范围不覆盖下一次从当前阅读章节开始的新选择。
- 手动任务与自动预缓存协调：当前书有手动任务时暂停其预缓存，结束后恢复。清理本书缓存先停止任务和预缓存，等待在途写入结束，再删除缓存，禁止迟到响应补回已删除内容。
- 任务、缓存和请求按账号与服务地址隔离；退出账号或换账号时取消任务，同账号令牌更新不取消。所有网络与二进制转换返回后检查任务身份和取消信号，旧账号结果不能写入新账号缓存。
- 本次只改变网页任务生命周期，使用现有缓存、配额与 API，没有新增依赖、服务端任务或数据库格式。

## 浏览器限制

普通网页可能被系统在锁屏、切换 App 或退出浏览器后挂起。当前方案保证应用仍执行时跨面板、跨路由继续，并保留断点；不承诺系统挂起后仍运行。长期锁屏后台下载需要原生下载服务或另行评估兼容性有限的 Background Fetch，不能靠定时器或普通 Service Worker 解决。

参考：[MDN Background Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API)。

## 合并与验证入口

上游如果提供等价任务管理，应先验证下列契约，再删除此模块；不能恢复组件卸载时暂停的旧行为。

```sh
npm test --prefix web
npm run build --prefix web
node web/tools/ui-review/manual-background-download.mjs
node web/tools/ui-review/cache-features.mjs
node web/tools/ui-review/novel-cache-open.mjs
node web/tools/ui-review/offline-sync.mjs
node web/tools/pwa/smoke.mjs
node web/tools/pwa/startup.mjs
```

回归包括工具卸载前后、运行中重取任务、账号/服务切换、取消/清理/修订变化的迟到响应、进程中断范围恢复、缓存复用及已完成状态保留。浏览器流程使用隔离本地 fixture，阻断正式域名；Chromium 与 WebKit 覆盖手机下载、回书架、重开面板、刷新后继续及离线阅读。发布结果见 UPSTREAM-SYNC.md。
