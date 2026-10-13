---
name: apv-case-review
description: Review a compiled APV test batch (out/ or case.xlsx) for one build, using the circle-server tools for the build's command tree, the function contract and ZenTao. Use when asked to 评审, review or audit APV test cases.
---

# APV 用例评审

Review a compiled test batch against the build it was written for. The scripts in `scripts/` do every check that has one right answer; you do the judgement steps and submit the findings. Nothing runs on a device here: a reviewed batch is "reviewed", never "passed".

## 输入

- 编译批次 `out/`(含 `cases/*.json`、`machine_mindmap.json`),或一份 `case.xlsx`。
- `versionLine`(如 10.5)与 `build`(必填;评审只对绑定构建说话)。
- circle-server 工具:`srv_buildsite_versions`、`srv_buildsite_command_check`、`srv_docs_list`、`srv_docs_search`、`srv_zentao_products`、`srv_zentao_bug_search`、`srv_zentao_bug_detail`、`srv_knowledge_claim_submit`。缺了就说明并停下:不凭记忆写结论。

## 1. 读取与结构检查(脚本)

```
node <skill>/scripts/prep.mjs <batch folder>
```

- 读取批次的每条用例(autoid、描述、init_commands、blocks);输入是 case.xlsx 时用 `readExecutionWorkbook` 的结构投影成同一形状。
- 必填列与步骤结构:autoid 唯一、每条用例至少一个检查点(check_point)、CONFIG/OBSERVE/CLIENT 块齐全、命令非空且单条不超 2000 字符。
- 产出 `out/review_structure.json`:每例 {autoid, ok, violations:[{code, detail}]};一条不过整例标 fail。

## 2. 命令与契约核对(脚本)

- 收集全批次的**设备命令**(init、CONFIG、OBSERVE 的 cmd;CLIENT 不算设备命令),整批一次 `srv_buildsite_command_check` 对 `build` 核对;原始返回由 server 落盘,`checks/review-check.json` 只写指针 `{"savedAs": "<path>"}`。
- 收集全批次的 **CLIENT 客户端名**,对照函数契约(`refs/excel_contract.json` 或用户指定的原件)里 `test_env` 的启用方法;不在契约里的标 `client_not_in_contract`。
- 产出 `out/review_commands.json`:每条命令 {command, status(hit/missing), violations, evidenceId};客户端名 {client, status}。

## 3. 覆盖与风险(判断)

由你判断,脚本不代答:

- **覆盖是否足够**:对照脑图/需求,哪些分支没测(正向/负向/边界/规格变更点)。
- **期望是否可验证**:每条 expectation 是否对应一个能判定的观察(show 输出、客户端输出、统计);不可验证的点名。
- **风险点**:会影响数据面/配置持久化的步骤、顺序依赖、清理是否完整。
- 用 `srv_zentao_products` 定位产品,`srv_zentao_bug_search` 按关键词找相关缺陷,`srv_zentao_bug_detail` 读修复说明;引用的缺陷写进发现的 facts。

## 4. 报告与提交(脚本 + 判断)

```
node <skill>/scripts/report.mjs <batch folder>
```

- 合并三类结果,写 `out/review_report.json` 与 `out/review_report.md`。每条发现:{origin: script|model, autoid(可空), code, summary, facts, evidenceIds[]}。脚本结论标 `script`,模型判断标 `model`;每条发现的 evidenceId 指到 server 落盘的原件(命令核对返回、缺陷详情、文档行)。
- 发现用 `srv_knowledge_claim_submit` 逐条提交为候选声明(subject 为用例或构建,predicate 为发现类型,value 带 facts 与 evidenceIds);不自动提升为团队知识。

## 5. 报告口径

报告 totals(用例数、fail 数、发现数)、报告路径与 SHA-256,以及每条发现的 origin 与错误码。明确说明:评审未在设备上运行任何用例。
