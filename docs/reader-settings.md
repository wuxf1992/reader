# 阅读设置与手机面板

阅读底栏保留目录、日间/夜间、朗读和设置四个入口。取消重复的外观/工具入口及浮动侧栏，工具统一从设置进入。

设置首屏：页面亮度、字号加减、字体与间距入口、四个常用配色与全部配色。详细入口固定在底部，手机无需先滚动找到：翻页与点击、显示设置、朗读设置、阅读工具。

- 字体与间距：字号、字体、行距、对齐、全局繁简；小说/TXT 显示缩进和段间距，TXT 编码仅在适用格式显示。
- 翻页与点击：滚动/分页、动画、3×3 点击区域；保留至少一个菜单区域，漫画保留图片适配与方向。
- 显示设置：基础页边距及四边额外留白、页眉页脚信息、玻璃效果。
- 阅读工具：离线下载、自动预缓存、搜索、笔记、校对等既有能力；下载任务仍由 AppRuntime 持有，跨页面继续。
- 常用和全部配色共用全局主题偏好，不新增独立主题存储；字号、亮度和排版仍保留设备设置。

## 下拉关闭

手机底部面板的顶部抓手与标题区域支持下拉关闭。短距离拖动和取消手势回到原位；向上拖动不关闭。输入框、按钮、面板内容滚动不触发关闭；忙碌时禁止拖动关闭。桌面保持抽屉及关闭按钮/空白区域/Escape 操作。

关闭统一走 Sheet 既有焦点恢复及退出动画，不在各设置页面重复实现手势。取消短拖不会重播入场动画。浏览器模拟不等同于 iPhone 真机。

## 回归入口

- web/test/sheet-drag.test.tsx：手机长/短/取消手势、忙碌和桌面保护、输入控件。
- web/test/reader-chrome.test.ts、chapter-reader.test.ts：选项可达、实际设置生效、跨页及重开恢复。
- web/tools/ui-review/reader-settings.mjs：Chromium/WebKit × 320/390/1440，快捷控件和固定入口可见、设置持久化、30 项配色、真实触摸或指针下拉关闭。
- reader-touch、reader-unified-themes、reader-status-tint、manual-background-download、PWA 及整站回归按 UPSTREAM-SYNC.md 执行。

## 时长统计账号边界

上游新增的离线时长队列按服务器及账号隔离。ReaderScreen 停止或账号切换后，旧阅读器不会通过新账号上报。读取旧账号的队列仅在回到同一作用域时发生；无法归属账号的旧无作用域队列不导入。


## 自适应布局与续读验收

- 首页只显示最近的一本正在阅读；视频/有声书续播仍按各自进度展示，书架不受影响。
- 底栏按实际按钮数量等分可用宽度，配色按钮同样等分；详细入口按容器宽度自动排成合适列数，不为删除的按钮留空位。
- 设置中的滑块按“标签 / 弹性滑块 / 右对齐数值”排版；开关说明占剩余宽度、开关靠右；分段选项独占一行且保留 44px 触控高度。返回位于标题左侧，关闭位于右侧。
- 手机面板按内容自然增高，上限为动态可用视口的 80% 并扣除顶部安全区，超长内容在面板内滚动；标题、底部入口保持可达。桌面沿用右侧抽屉。
- 合并后必须检查实际按钮位置、所有详细页和长说明，不再仅检查按钮数量与首屏截图。现有浏览器入口覆盖 320/390/768/1440 宽度、两种引擎；故意让接口返回两本书，确认仍只显示最新一本。

参考：[Android 按可用窗口自适应](https://developer.android.com/develop/adaptive-apps/guides/support-different-display-sizes)、[Apple 底部面板与返回/关闭](https://developer.apple.com/design/human-interface-guidelines/sheets)、[Readest 设置布局](https://github.com/readest/readest/blob/main/apps/readest-app/DESIGN.md)、[CSS Grid 自适应列](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Grids)。采用现有 CSS 布局和共享组件，无新增布局框架或设备型号判断。
