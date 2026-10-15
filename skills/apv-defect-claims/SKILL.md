---
name: apv-defect-claims
description: Turn ZenTao defect records into candidate knowledge claims with script origin, using the circle-hub PLM tools. Use when asked to extract, 抽取 or 沉淀 defect facts as claims.
---

# APV 缺陷声明抽取

Circle binding: Circle 1.7.0 or newer uses the `hub` extension, `/hub login` and `hub_tool_*`. Other harnesses expose the declared remote tools through their own adapters. Former Circle extension, command and tool names are not aliases.

Read defect records and turn their deterministic fields into candidate claims. The script decides what becomes a claim — a field to a predicate, nothing invented; you decide which product, which bugs, and submit.

## 输入

- `product`(产品线,如 APV)与 `defects`(修复清单里的 bug id,或检索关键词)。
- circle-hub 工具:`hub_tool_zentao_products`、`hub_tool_zentao_bug_search`、`hub_tool_zentao_bug_detail`、`hub_tool_knowledge_claim_submit`。缺了就说明并停下。

## 1. 定位产品(判断 + 工具)

照 apv-mindmap-compile 的规则:先用 `hub_tool_zentao_products` 从产品列表解出产品 id,再用一次带状态筛选的 `hub_tool_zentao_bug_search` 证实它确实返回缺陷(与产品线同名的产品可能是空的,缺陷可能在家族产品下);id 不许猜,`product` 传名字会被拒。

## 2. 检索缺陷(判断 + 工具)

`hub_tool_zentao_bug_search` 必带 product;修复清单给了 bug id 就直接取详情,关键词就按功能词检索挑相关缺陷。「没查到」不等于「不存在」:写明查了哪些、覆盖到哪。

## 3. 读详情并抽取(工具 + 脚本)

`hub_tool_zentao_bug_detail` 读完整历史,hub 原样落盘每次返回;然后:

```
node <skill>/scripts/extract.mjs <folder> --detail <hub 落盘的返回或 {savedAs} 指针> [--detail …]
```

脚本读落盘文件(不转抄),对每个缺陷产出候选声明 `[{subject: "defect:<id>", predicate, value, origin: "script", evidenceIds}]`——谓词是固定枚举(title/status/severity/priority/affects_product/affects_version/fixed_in_build/resolution/legacy_issue_id/repair_note),value 原样取字段,svn 提交动作的备注成 repair_note,evidenceId 取自那份返回。字段没有或为空不出声明,**没有任何推断**;推断(比如某缺陷意味着某行为)是模型的活,走别的技能。产出 `<folder>/defect_claims.json`。

## 4. 提交(工具)

`defect_claims.json` 的每条**原样**交给 `hub_tool_knowledge_claim_submit`(subject/predicate/value/evidenceIds 都不改);提交为候选,不自动提升为团队知识。提交后报告条数与任务 id;哪条被拒如实转述原因。
