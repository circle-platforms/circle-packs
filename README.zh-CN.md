# circle-packs

[English](README.md)

装在 [circle-hub](https://github.com/qingshanfeihu/circle-hub) 上的技能包和产品线包。circle-hub 是 [Circle](https://github.com/qingshanfeihu/circle) 的团队 hub。这里的每个模块单独版本、单独发布，通过 circle-hub 自己的机制装入：技能包走推送、试跑记录和独立审批人批准。包不随 circle-hub 一起发布。

每个包要遵守的目录布局和适配单见 [产品线包典范](https://github.com/qingshanfeihu/circle-hub/blob/main/docs/design/product-line-pack.md)（[英文](https://github.com/qingshanfeihu/circle-hub/blob/main/docs/design/en/product-line-pack.md)）。本仓库里 APV 的状态见 [docs/product-line-pack.md](docs/product-line-pack.md)。

## 里面有什么

| 目录 | 内容 | 状态 |
|---|---|---|
| [skills/apv-mindmap-compile](skills/apv-mindmap-compile/SKILL.md) | 把 APV 脑图编译成可运行的执行工作簿：重组意图、按绑定构建核对每条设备命令、出九列单表。版本 0.2.7 | 已在 main |
| [products/apv](products/apv/README.md) | APV 产品线包：`product-line.json`、`tools/`、`hooks/`、`resources/`、`sources/`、`flows/`、README 里的适配单、18 个合成测试。版本 1.0.0 | 已在 main |
| [skills/apv-case-review](skills/apv-case-review/SKILL.md) | 对编译批次按绑定构建做评审：结构、命令树、函数契约核对是脚本，覆盖与风险是模型判断；报告带 evidenceId，发现以候选声明提交。版本 0.1.3 | 已在 main |

## 不放什么

命令树、Excel 函数契约、床配置、脑图原件、设备返回不进 Git。运行时由人作为原件上传到 circle-hub，带 SHA 登记，经独立审批人批准后工具才读。仓库里只有过程、脚本和合成测试。

## 模块清单

[modules.json](modules.json) 是 circle-hub 的安装器读取的清单（schema `circle-packs/modules/1`）。每个模块一项：

| 字段 | 含义 |
|---|---|
| `id` | 模块 id，与目录名、自身清单里的 id 一致 |
| `kind` | `skill-pack`（`skills/<id>/skillpack.json`）或 `product-line`（`products/<id>/product-line.json`） |
| `root` / `manifestPath` | 模块目录和自身清单的相对路径 |
| `version` | 取自自身清单 |
| `files` | 模块目录下全部文件（隐藏文件除外）的相对路径和 SHA-256，按路径排序 |
| `digest` | 把 `files` 按 `sha256sum` 的输出格式（每行 `<sha256>  <path>`）拼成文本后的 SHA-256，可用命令行工具复算 |

安装器只按这份清单冻结字节，再走 circle-hub 自己的登记、试跑记录和独立审批。清单本身不批准任何东西。改了模块文件后运行 `node tools/modules.ts write` 重写清单。

## 检查

使用 Node.js 24。前两条不需要安装依赖：

```sh
node tools/modules.ts check
node --test tools/*.test.ts skills/*/tests/*.test.mjs
```

产品线包测试需要 circle-hub 的依赖集。把它的 `node_modules` 软链到本仓库后运行：

```sh
ln -s <circle-hub-checkout>/node_modules node_modules
node --experimental-strip-types --test 'products/apv/tests/*.test.mjs'
```

测试只用合成样本，证明脚本行为，不证明真实产品或设备上的结果。

## 状态

circle-packs 在开发中，不是受支持的生产发行。用到要紧的地方之前先读 [SECURITY.md](SECURITY.md)。

## 参与与安全

[CONTRIBUTING.md](CONTRIBUTING.md) 说明改动怎么做、怎么验。[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 适用于所有互动。安全问题通过仓库的私密漏洞报告入口提交，见 [SECURITY.md](SECURITY.md)。

## 许可

[MIT](LICENSE)。
