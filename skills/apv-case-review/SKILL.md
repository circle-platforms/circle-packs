---
name: apv-case-review
description: Review a compiled APV test batch (out/) for one build, using the circle-hub tools for the build's command tree, the function contract and ZenTao. Use when asked to 评审, review or audit APV test cases.
---

# APV 用例评审

Review a compiled test batch against the build it was written for. The scripts in `scripts/` do every check that has one right answer; you do the judgement steps and submit the findings. Nothing runs on a device here: a reviewed batch is "reviewed", never "passed".

## 输入

- 编译批次 `out/`(含 `cases/*.json`、`machine_mindmap.json`)。0.1 只收批次目录,不收 case.xlsx。
- `versionLine`(如 10.5)与 `build`(必填;评审只对绑定构建说话)。
- `contract`:用户在 hub 登记的那份 Excel 函数契约副本路径(schema `ist.excel.function-contract`);`entries` 里 `e=test_env` 且 `status=enabled` 的才算启用。不给契约,客户端名只能标 `client_not_checked`。
- `checks`:hub 落盘的 `buildsite.command_check` 返回,或编译技能留下的 `checks/<autoid>.json` 指针 `{"savedAs": "<path>"}`,可给多份。
- circle-hub 工具:`srv_buildsite_command_check`、`srv_docs_search`、`srv_zentao_products`、`srv_zentao_bug_search`、`srv_zentao_bug_detail`、`srv_knowledge_claim_submit`。缺了就说明并停下:不凭记忆写结论。

## 绑定构建

规则照编译技能:查询都传绑定构建的 `buildId` 作为 `build`,因为同一构建名存在于多个平台;用例文件保留工具返回里的构建名。命令树是已批准的外部原件时(站点里没有条目),同样传 `sar_` id 作为 `build` 与 `sourceArtifactId`,人读的构建名写在 `machine_mindmap.json` 的 `display_build`;hub 对 `sar_` 的 command_check 回执顶层 `build`/`buildId` 就是 sar id,回执仍与绑定构建对得上。模型不猜传哪个:批次绑的是什么就传什么。

## 1. 读取与结构检查(脚本)

```
node <skill>/scripts/prep.mjs <batch folder>
```

- 读取批次的每条用例(autoid、描述、init_commands、blocks)与 `machine_mindmap.json`。
- 必填列与步骤结构:autoid 唯一且 18 位(重复出 `autoid_duplicate`)、init_commands 逐条查空/换行/长度、未知块类型出 `block_unknown`、每条用例至少一个检查点、CONFIG/OBSERVE/CLIENT 块齐全。
- 产出 `<batch>/review_structure.json`(每例 {autoid, ok, violations};同一 autoid 出现多次时各占一条键 `autoid#序号` 并都标 `autoid_duplicate`;cases/ 里的坏 JSON 报 `case_unreadable`,不影响其余用例)与 `<batch>/review_context.json`(每例 {autoid, bucket, group_path, intent, verification, expectation, expectations[], proposal[]}:bucket、契约三元组、按步 expectations、proposal 来自 machine_mindmap.json,group_path 来自 cases/*.json 的 description.group_path,形状按编译技能 references/contract.md 投影,供第 3 步对照脑图判覆盖,true_gap 用例只有 bucket 和 proposal)。

## 2. 命令与契约核对(脚本)

```
node <skill>/scripts/check.mjs collect <batch>
node <skill>/scripts/check.mjs apply <batch> --build <绑定构建> --check <hub 落盘返回或指针> [--check …] [--contract <契约>]
```

- `collect`:输出去重的设备命令清单(每条带来源 autoids,含 init_commands;结构检查已拒绝的空/换行/超长命令不送核对,它们已在结构发现里)与客户端名清单。把设备命令**原样**传给 `srv_buildsite_command_check` 对绑定构建核对;默认路径是评审自己对整批做一次核对,编译留下的 `checks/<autoid>.json` 指针也可以直接传(解析候选照编译技能的 gate.mjs:先按原路径,再相对指针所在目录的 ../..(工作区根),再相对批次目录)。
- `apply`:读各份落盘返回(不转抄),合并 result.commands:每条命令 status——hit/missing 按返回;没被任何返回覆盖的是 not_checked(不等于不在树里);多份返回对同一命令结论不一致是 inconsistent,violations 与 evidenceIds 两份都带。evidenceId 取自包含它的那份返回。`--build` 与每份返回的 `result.build`、每条用例的 `build` 字段比对,不一致出 `build_mismatch`;返回缺 `result.build` 记 `build_unverified`(带文件名)。客户端名对照 `--contract` 的启用 test_env 方法,不在契约标 `client_not_in_contract`,没给契约标 `client_not_checked`。报告侧的错误码与之对应:command_not_in_tree / command_not_checked / command_check_inconsistent / command_parameter_contract(hit 带 violations)/ command_status_unknown(返回给了未认识的 status)。
- 产出 `<batch>/review_commands.json`。

## 3. 覆盖与风险(判断)

由你判断,脚本不代答。先读 `<batch>/review_context.json` 对照脑图。每条发现写进 `<batch>/review_findings.json`,形状固定:

```
{findings:[{origin:'model', autoid, code, summary, facts, evidenceIds}]}
```

`code` 只用:`coverage_gap`(覆盖不足)、`expectation_unverifiable`(期望不可验证)、`risk_dataplane`(影响数据面)、`risk_order_dependency`(顺序依赖)、`cleanup_missing`(清理缺失)、`related_defect`(关联缺陷)。枚举外的 code,report.mjs 报错不收。

- **覆盖是否足够**:对照 review_context.json 的 intent/expectations/proposal,哪些分支没测(正向/负向/边界/规格变更点)。
- **期望是否可验证**:每条 expectation 是否对应一个能判定的观察(show 输出、客户端输出、统计)。拿不准输出格式时,用 `srv_docs_search` 查该命令在手册里的输出格式再判断;不可验证的点名。
- **风险点**:会影响数据面/配置持久化的步骤、顺序依赖、清理是否完整。
- 禅道查法照编译技能:先用 `srv_zentao_products` 从产品列表解出产品 id,再用一次带状态筛选的 `srv_zentao_bug_search` 证实它确实返回缺陷(与产品线同名的产品可能是空的,缺陷可能在家族产品下);id 不许猜,product 传名字会被拒。读完整历史用 `srv_zentao_bug_detail`,修复说明里的 Fixed Details 决定行为问题。脑图标题常带缺陷号(如 79758),直接查。「没查到」不等于「不存在」:写明查了哪些、覆盖到哪。

## 4. 报告与提交(脚本 + 判断)

```
node <skill>/scripts/report.mjs <batch folder>
```

- 合并三类结果,写 `<batch>/review_report.json`、`<batch>/review_report.md` 与 `<batch>/review_claims.json`。每条发现:{origin: script|model, autoid(可空), code, summary, facts, evidenceIds[]}。脚本结论标 `script`,模型判断标 `model`;每条发现的 evidenceId 指到 hub 落盘的原件(命令核对返回、缺陷详情、文档行)。
- `review_claims.json` 是固定映射的 `[{subject, predicate, value}]`(有用例的发现 subject 为 `case:<autoid>`,批次级发现为 `build:<绑定构建>`;predicate 为发现 code;value 带 summary/facts/origin 与 evidenceIds;绝对路径永远不进声明);用 `srv_knowledge_claim_submit` **逐条原样提交**,不自动提升为团队知识,模型不手抄映射。

## 5. 报告口径

以 `review_report.md` 为准:它带 report.json 的路径与 SHA-256、totals(用例数、结构失败数、发现数按 origin 分)与每条发现的 origin 和错误码;报告口径明确:评审未在设备上运行任何用例。
