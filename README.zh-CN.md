<h1 align="center">circle-packs</h1>

<p align="center">装在 circle-hub 上的技能包和产品线包：有版本、按 SHA 固定、由独立审阅人批准。</p>

<p align="center">
  <a href="https://circle-platforms.github.io/circle-packs/">文档</a> ·
  <a href="modules.json">模块清单</a> ·
  <a href="docs/product-line-pack.md">APV 状态</a> ·
  <a href="docs/enterprise-packs.md">企业通用包</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="README.md">English</a>
</p>

---

装在 [circle-hub](https://github.com/circle-platforms/circle-hub) 上的技能包和产品线包。circle-hub 是 [Circle](https://github.com/circle-platforms/circle) 的团队 hub。这里的每个模块单独版本、单独发布，通过 circle-hub 自己的机制装入：技能包走推送、试跑记录和独立审批人批准。包不随 circle-hub 一起发布。

每个包要遵守的目录布局和适配单见 [产品线包典范](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md)（[英文](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/en/product-line-pack.md)）。本仓库里 APV 的状态见 [docs/product-line-pack.md](docs/product-line-pack.md)。企业通用包和 dev:stack 安装见 [docs/enterprise-packs.md](docs/enterprise-packs.md)。

技能清单是英文。中文标题写在 `SKILL.md` 文首的 `titleZh`。circle-hub 的 `SkillManifest` 是严格对象，多出来的键会被拒绝，所以 `titleZh` 不放进 `skillpack.json`，也不放进 `product-line.json`。流程文件可以同时有 `title` 和 `titleZh`。

## 里面有什么

| 目录 | 内容 | 状态 |
|---|---|---|
| [skills/apv-mindmap-compile](skills/apv-mindmap-compile/SKILL.md) | 把 APV 脑图编译成可运行的执行工作簿：重组意图、按绑定构建核对每条设备命令、出九列单表。版本 0.4.1 | 已在 main |
| [products/apv](products/apv/README.md) | APV 产品线包：`product-line.json`、`tools/`、`hooks/`、`resources/`、`sources/`、`flows/`、README 里的适配单、合成测试。版本 1.4.2 | 已在 main |
| [skills/apv-defect-claims](skills/apv-defect-claims/SKILL.md) | 把禅道缺陷记录抽成候选知识声明（origin script）：定位产品、挑缺陷是模型判断，字段到谓词的抽取是脚本、零推断，evidenceId 透传。版本 0.2.1 | 已在 main |
| [skills/apv-product-qa](skills/apv-product-qa/SKILL.md) | 只凭手册回答 APV 产品问题：先用 docs.list 钉住手册版本、按 anchor 直取小节，作答是模型判断、每段带证据标记，引文由脚本对 hub 落盘的章节逐字校验，no_evidence 必须有一次真实的小节未命中。版本 0.2.1 | 已在 main |
| [skills/apv-case-review](skills/apv-case-review/SKILL.md) | 对编译批次按绑定构建做评审：结构、命令树、函数契约核对是脚本，覆盖与风险是模型判断；报告带 evidenceId，发现以候选声明提交。版本 0.2.1 | 已在 main |
| [products/enterprise](products/enterprise/README.md) | 通用产品线：钉死的策略表、原始 CSV 汇总、模型判定的工单严重度、司龄与降权规则、以及按标签计算的 MTTR。版本 1.2.0 | 草案 |
| [skills/contract-review](skills/contract-review/SKILL.md) | 模型抽取允许或禁止条款（含「第N条」）并给出极性片段。脚本按钉死的策略表给风险分。版本 1.2.0 | 草案 |
| [skills/monthly-business-report](skills/monthly-business-report/SKILL.md) | 读取原始 CSV。模型只映射表头。合计来自人工批准的 `metrics.yaml`。版本 1.2.0 | 草案 |
| [skills/support-triage](skills/support-triage/SKILL.md) | 模型给出意图、严重度并覆盖每一张工单。脚本按钉死的策略表映射 SLA 和队列。版本 1.2.0 | 草案 |
| [skills/employee-onboarding](skills/employee-onboarding/SKILL.md) | 模型抽取允许、禁止、司龄和降权规则。脚本评估申请。版本 1.2.0 | 草案 |
| [skills/incident-postmortem](skills/incident-postmortem/SKILL.md) | 模型给日志行打标签，含混合时区。脚本按标签计算 MTTR，缺了均值则门禁失败。版本 1.2.0 | 草案 |
| [skills/local-script](skills/local-script/SKILL.md) | 用本地脚本统计行数和词数。说明清单、声明的工具、输出路径和一份试跑记录样本。版本 1.0.0 | 草案 |

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
node --test tools/*.test.ts skills/*/tests/*.test.mjs templates/judgement-gate/scaffold/tests/*.test.mjs
```

产品线包测试使用 circle-hub 提交 `dc93c69826f73f16d2f20f7520ba4c6663d014ac` 的依赖集，与 `.github/workflows/checks.yml` 固定的提交一致。先检出该提交并在其中运行 `npm ci --ignore-scripts`，再把它的 `node_modules` 软链到本仓库后运行。这只固定测试环境，不代表已支持该 hub 的生产版本：

```sh
ln -s <circle-hub-checkout>/node_modules node_modules
node --experimental-strip-types --test 'products/*/tests/*.test.mjs'
HUB_ROOT=<circle-hub-checkout> node --experimental-strip-types tools/validate-with-hub.mjs
```

`tools/validate-with-hub.mjs` 用 circle-hub 的 `SkillManifest` 解析每个 `skillpack.json`，并用 `ProductLineManifest` 与 `verifyProductLine` 解析每个 `product-line.json`。未设置 `HUB_ROOT` 且不存在 `../circle-hub` 时跳过并退出 0。`HUB_ROOT` 要指向含 `packages/methods/src/product-modules.ts` 的检出。上面的依赖提交只提供测试库；那份较旧的产品线 schema 不接受 `tools` 或 `hooks`。

冻结的产品线 Tool 只在 circle-hub 有进程隔离适配器的主机上执行。目前该适配器只有 macOS。Linux 主机会报 `SANDBOX_UNAVAILABLE`（`This execution host has no supported process isolation adapter`）。Linux 上的 dev:stack 仍可检查并安装模块。Linux 适配器计划在 circle-hub，不在本仓库。见 [docs/sandbox.md](docs/sandbox.md)。

测试只用合成样本，证明脚本行为，不证明真实产品或设备上的结果。

## 状态

circle-packs 在开发中，不是受支持的生产发行。用到要紧的地方之前先读 [SECURITY.md](SECURITY.md)。

## 参与与安全

参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)，编程助手见 [AGENTS.md](AGENTS.md)，三个仓库彼此的要求见 circle-hub 的[兼容矩阵](https://github.com/circle-platforms/circle-hub/blob/main/docs/compatibility.md)。安全问题按 [SECURITY.md](SECURITY.md) 报告。参与的每个人都遵守[行为准则](CODE_OF_CONDUCT.md)。

circle-packs 是三个仓库之一：[circle](https://github.com/circle-platforms/circle) 是 agent，[circle-hub](https://github.com/circle-platforms/circle-hub) 是它登录的 hub，circle-packs 是装在 hub 上的包。

## 许可

circle-packs 以 [Apache License 2.0](LICENSE) 发布。[NOTICE](NOTICE) 写明著作权人，并保留商标：本开源许可仅授予代码与相关文档的使用权，未经明确书面许可，不授予任何使用 Circle、Circle Hub 或相关商标、Logo 及图标的权利。2026-10-13 之前本仓库以 MIT 许可证发布。本仓库不捆绑第三方组件；包里的 Tool 只能 import circle-hub 的依赖集，见那个仓库的 THIRD_PARTY_NOTICES.md。贡献按 [CONTRIBUTING.md](CONTRIBUTING.md#contributor-terms) 的贡献者条款接受。
