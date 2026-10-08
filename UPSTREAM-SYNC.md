# Reader 上游同步

当前本地分支 `custom-reader` 跟踪 `origin/main`（https://github.com/hectorqin/reader）。
从 `5c59cae0b0ec410207054c816c69d394ae132cc7` 合并至 `875fec84ddff0f76ab55d495cc428c658b80aeab`，完整保留上游 20 个提交及本地修改历史。

## 后续更新

```sh
cd /home/ubuntu/codex/reader-main-sync
git pull --no-rebase
```

`pull.rebase=false` 已在该仓库配置，因此直接 `git pull` 也会按合并方式更新。遇到冲突后解决、运行检查，再完成合并提交。不要重新下载源码覆盖该目录。

更新代码之后需要重新构建、验证并部署，`git pull` 不会自动更换线上容器或网页。

```sh
cd web
npm ci
npm run build
npm test
cd ../server
npm ci
npm run build
npm test
```

生产网页继续使用 `web/.env.production` 中的 `VITE_SERVER_URL=https://wuxf.top/reader`；环境配置不纳入 Git。

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

网页：110 个测试文件、888 项 Vitest 测试及 29 项 Node 测试通过。服务端：474 项通过，0 失败；7 项真实媒体文件测试因宿主机没有 ffmpeg 条件跳过，运行镜像含 ffmpeg。

Chromium / WebKit 的手机与桌面预缓存、目录回归通过。真机 iPhone 尚未验证。上游生产依赖审计仍报告 4 个高危及 1 个严重项目，本次保留上游锁文件，未做跨主要版本的依赖升级。
