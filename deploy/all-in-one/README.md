# 网络小说插件运行环境

启动器、进程监督、Compose 和部署验证脚本统一维护在
[网络小说插件仓库](https://github.com/wuxf1992/reader-novel-web/tree/main/deploy/all-in-one)。
此目录保留构建准备入口，生成的文件不提交，避免两份源码分别修改。

将插件仓库放在 Reader 仓库旁边，在 Reader 根目录执行：

```sh
node deploy/all-in-one/prepare.mjs
docker build --network=none -t reader-github:plugin-js-runtime-875fec84 deploy/all-in-one
```

插件位于其他位置时，传入插件仓库的路径：

```sh
node deploy/all-in-one/prepare.mjs /path/to/reader-novel-web
```

正式构建前将插件检出到已验证的提交或版本，并记录该提交；更新插件检出后重新执行准备命令。
`--build-arg READER_IMAGE=<Reader 基础镜像>` 的用法保持不变。
准备过程不访问网络、不操作容器或正式数据；源文件不完整时不会替换构建文件。

准备脚本检查：`node --test deploy/all-in-one/prepare.test.mjs`。
实际 Chromium、进程生命周期和部署步骤见插件仓库的部署说明。
