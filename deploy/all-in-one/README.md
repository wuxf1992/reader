# ARM64 单容器与 JS 插件运行环境

镜像 `reader-github:plugin-js-runtime-875fec84` 提供官方 Reader 主程序、Node、Chromium 和低权限浏览器启动器。镜像不包含插件实现、Jar 或 Java。插件 1.5.0 包含 JS 书源引擎、浏览器服务和全部 Node 依赖。

JS 引擎随插件执行。浏览器规则首次调用时，插件发布浏览器服务代码并向启动器申请运行；服务实现由插件提供。停用、卸载、升级或插件进程退出后停止浏览器并清理临时文件。浏览器崩溃自动恢复，不重启主程序。

Reader/插件 UID/GID 为 100/101，浏览器为 1001/1001。所有业务进程有效 capabilities 为零；浏览器不能读取 `/data`、`/books` 或连接启动器控制接口。只向宿主机 127.0.0.1:4396 发布 Reader 5888 端口。Compose 的 `init: true` 负责回收子进程。Java 服务地址和存储挂载已移除。

## 构建插件安装包

在仓库根目录运行：

```sh
npm ci --ignore-scripts
npm test
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
```

将 `artifacts/reader-novel-web-1.5.0.tgz` 上传到 Reader 的「书源 → 插件管理」。

## 构建

先按根 README 准备官方基础镜像，然后：

```sh
docker build --network=none -t reader-github:plugin-js-runtime-875fec84 deploy/all-in-one
```

更新官方主程序时，使用 `--build-arg READER_IMAGE=<新基础镜像>` 重建。更新 JS 引擎或浏览器服务只需升级插件包；升级 Node/Chromium 运行时需重建镜像。新服务器应使用这个运行环境，官方原始镜像尚未包含本插件需要的启动器。

## 验证与升级

`service-host.test.mjs` 检查低权限启动器的边界；`runtime-connection-check.mjs` 在隔离容器检查断连后的报错和清理；`smoke.mjs` 检查实际 Chromium、私网拦截及 JS 引擎读取流程。`lifecycle-check.py` 仅允许隔离的 `reader-js-check` Compose 项目，检查浏览器崩溃、停用启用、卸载重装、上传升级和正常停止。测试账号放在 `/tmp`，不提交源码。

升级时停止 Reader 并备份 Compose、插件程序和数据；替换插件程序，保留数据库、`plugin-data`、书架和阅读进度。将 Compose 放到实际部署目录后运行：

```sh
docker compose -f /opt/reader/compose.yaml up -d
```

旧 Java 存储目录不再挂载，但保留旧插件、镜像和数据目录用于回滚。回滚时恢复旧插件程序和 Compose 即可，不覆盖账号数据库。
