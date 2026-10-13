# 怎样参与 circle-packs

先读 [README](README.zh-CN.md) 和 [APV 状态](docs/product-line-pack.md)。目录布局和适配单以 circle-hub 的[产品线包典范](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md)为准（[英文](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/en/product-line-pack.md)）。

典范是约束：产品线包从扩展点插进去；插进去的都是资产；生效走变更集；运行走执行链；平台不是审批人；产品内容不进 circle-hub 核心。一项改动如果要绕过其中一条，先改 circle-hub 里的典范，再改这里的包。

## 开始之前

- 一般问题和建议写 Issue，说明输入、预期、实际观察和提交号。
- 可能涉及安全或敏感信息的问题按 [SECURITY](SECURITY.md) 处理。
- Circle 的客户端在 [Circle 仓库](https://github.com/circle-platforms/circle)维护；平台在 [circle-hub](https://github.com/circle-platforms/circle-hub)。本仓库只放技能包和产品线包。

## 环境

Node.js 24。本仓库没有自己的依赖清单。

清单检查和技能测试直接运行。产品线包测试需要 circle-hub 的依赖集，把它的 `node_modules` 软链到本仓库：

```sh
ln -s <circle-hub-checkout>/node_modules node_modules
```

`<circle-hub-checkout>` 是 circle-hub 的检出目录，不要把本机绝对路径写进仓库。

## 测试

```sh
node tools/modules.ts check
node --test tools/*.test.ts skills/*/tests/*.test.mjs
node --experimental-strip-types --test 'products/apv/tests/*.test.mjs'
```

- 每项行为改变需要能复现原问题的合成样本。不要把旧测试记录或真实返回当成当前功能通过。
- 验收只用合成来源和合成样本。不连真实系统，不调付费模型，不碰真实设备。
- 不提交口令、令牌、内网地址、真实业务原件、用户会话或本机绝对路径。

## 改动怎么做

- 命令树、函数契约、床配置、脑图原件和设备返回不进 Git。它们在运行时上传到 circle-hub。
- 改了模块里的文件后，运行 `node tools/modules.ts write` 重写 [modules.json](modules.json)，再运行 `node tools/modules.ts check`。
- 英文 README 是主文，中文在 `README.zh-CN.md`。接口和代码标识用英文。区分已在 main 的行为、评审中的包和未验证的范围。

## 提交与 PR

- 明确 stage 要提交的路径；不用 `git add -A`、`git add .` 或 `git commit -a`。
- 提交信息是一句首字母大写的英文祈使句，没有前缀，没有句号。
- PR 说明改了什么、为何需要、哪些包受影响、实际验证范围。
- 贡献按项目 [MIT](LICENSE) 许可提供；第三方内容附来源、原许可和必要通知。
