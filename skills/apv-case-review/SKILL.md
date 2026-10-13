---
name: apv-case-review
description: Review a compiled APV test batch (out/) for one build, using the circle-hub tools for the build's command tree, the function contract and ZenTao. Use when asked to 评审, review or audit APV test cases.
---

# APV 用例评审

Review a compiled test batch against the build it was written for. The scripts in `scripts/` do every check that has one right answer; you do the judgement steps and submit the findings. Nothing runs on a device here: a reviewed batch is "reviewed", never "passed".

## 输入

- 编译批次 `out/`(含 `cases/*.json`、`machine_mindmap.json`)。0.1 只收批次目录,不收 case.xlsx。
- `versionLine`(如 10.5)与 `build`(必填;评审只对绑定构建说话)。
- `--contract`:用户在 hub 登记的那份 Excel 函数契约副本(schema `ist.excel.function-contract`);`entries` 里 `e=test_env` 且 `status=enabled` 的才算启用。不给契约,客户端名只能标 `client_not_checked`。
- circle-hub 工具:`srv_buildsite_versions`、`srv_buildsite_command_check`、`srv_docs_search`、`srv_zentao_products`、`srv_zentao_bug_search`、`srv_zentao_bug_detail`、`srv_knowledge_claim_submit`。缺了就说明并停下:不凭记忆写结论。

## 1. 读取与结构检查(脚本)

```
node <skill>/scripts/prep.mjs <batch folder>
```

- 读取批次的每条用例(autoid、描述、init_commands、blocks)。
- 必填列与步骤结构:autoid 唯一且 18 位、每条用例至少一个检查点(check_point)、CONFIG/OBSERVE/CLIENT 块齐全、命令非空且单条不超 2000 字符。
- 产出 `<batch>/review_structure.json`:每例 {autoid, ok, violations:[{code, detail}]};一条不过整例标 fail。

## 2. 命令与契约核对(脚本)

```
node <skill>/scripts/check.mjs collect <batch>
node <skill>/scripts/check.mjs apply <batch> --check <hub 落盘的返回文件> --contract <契约>
```

- `collect`:输出去重的设备命令清单(每条带来源 autoid)与客户端名清单。把设备命令**原样**传给 `srv_buildsite_command_check` 对 `build` 核对;hub 落盘返回(`savedAs` 指向的路径)。
- `apply`:读 hub 落盘的返回文件(不转抄),逐命令写 status(hit/missing)、violations、evidenceId;客户端名对照 `--contract` 的启用 test_env 方法,不在契约标 `client_not_in_contract`,没给契约标 `client_not_checked`。
- 产出 `<batch>/review_commands.json`。

## 3. 覆盖与风险(判断)

由你判断,脚本不代答。每条发现写进 `<batch>/review_findings.json`,形状固定:

```
{findings:[{origin:'model', autoid, code, summary, facts, evidenceIds}]}
```

`code` 只用:`coverage_gap`(覆盖不足)、`expectation_unverifiable`(期望不可验证)、`risk_dataplane`(影响数据面)、`risk_order_dependency`(顺序依赖)、`cleanup_missing`(清理缺失)、`related_defect`(关联缺陷)。枚举外的 code,report.mjs 报错不收。

- **覆盖是否足够**:对照脑图/需求,哪些分支没测(正向/负向/边界/规格变更点)。
- **期望是否可验证**:每条 expectation 是否对应一个能判定的观察(show 输出、客户端输出、统计)。拿不准输出格式时,用 `srv_docs_search` 查该命令在手册里的输出格式再判断;不可验证的点名。
- **风险点**:会影响数据面/配置持久化的步骤、顺序依赖、清理是否完整。
- 用 `srv_zentao_products` 定位产品,`srv_zentao_bug_search` 按关键词找相关缺陷,`srv_zentao_bug_detail` 读修复说明;引用的缺陷写进发现的 facts 与 evidenceIds。

## 4. 报告与提交(脚本 + 判断)

```
node <skill>/scripts/report.mjs <batch folder>
```

- 合并三类结果,写 `<batch>/review_report.json` 与 `<batch>/review_report.md`。每条发现:{origin: script|model, autoid(可空), code, summary, facts, evidenceIds[]}。脚本结论标 `script`,模型判断标 `model`;每条发现的 evidenceId 指到 hub 落盘的原件(命令核对返回、缺陷详情、文档行)。
- 发现用 `srv_knowledge_claim_submit` 逐条提交为候选声明(subject 为用例或构建,predicate 为发现类型,value 带 facts 与 evidenceIds);不自动提升为团队知识。

## 5. 报告口径

报告 totals(用例数、fail 数、发现数)、报告路径与 SHA-256,以及每条发现的 origin 与错误码。明确说明:评审未在设备上运行任何用例。
