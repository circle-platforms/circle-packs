---
name: apv-product-qa
description: Answer APV product questions from the manuals with verbatim citations, using the circle-hub document tools. Use when asked about APV product behavior, commands or configuration.
---

# APV 产品问答

Answer a product question only from what the manuals say, with every claim tied to a hub-saved section. No evidence, no answer.

## 输入

- `question`(问题,任意措辞)、`product`(产品线,如 APV)、`versionLine`(如 10.5)。
- circle-hub 工具:`srv_docs_list`、`srv_docs_search`、`srv_docs_section`。缺了就说明并停下:不凭记忆作答。

## 0. 确定手册版本(工具 + 判断)

`version` 参数要的是**手册的完整版本号**,不是版本线——文档源按目录存放(如 `rel_apv_10_5_0`),版本线 10.5 对应的目录不存在,报错还和「无权限」长得一样。先用 `srv_docs_list` 列出可用手册目录,选与绑定构建一致的那个完整版本(如 585 构建 → 10.5.0),把列表结果和选择交给第 4 步的脚本记进查询记录。列表里没有对应的版本就如实说,不猜、不退回版本线。

## 1. 检索词(判断)

从问题里拆出该查手册的词:命令名、功能名、配置对象。用产品的通用词,不造词;问题本身含命令名就直接用它。

## 2. 检索与选段(判断 + 工具)

- 检索一律**先定位再窄搜**:全目录搜索一页要读 20 个文件、每次请求间隔 200ms,容易撞 30 秒超时。先用 `srv_docs_list` 列出选定手册目录(`cli/rel_apv_<版本>/`),从中挑与问题相关的子目录或文件,再 `srv_docs_search` 带 `path` 限定到它,配 `version`(第 0 步选定的完整版本号)、检索词与 `limit`;读回的命中里挑出与问题相关的手册章节。
- 对选中的章节用 `srv_docs_section` 取原文;hub 原样落盘每次返回(`savedAs` 指向路径),答案只引用落盘返回里的文字。
- 检索没命中就如实说没有,不换词硬凑到「看起来答了」。`srv_docs_search` 与 `srv_docs_section` 的 `version` 一律传第 0 步选定的完整版本号。

## 3. 作答(判断)

写 `<question folder>/answer.json`,形状固定:

```
{question, status: answered|no_evidence, answer, citations:[{evidenceId, source, section, quote}]}
```

- `status: answered` 时 `citations` 至少一条;每条引用的 `quote` 是**逐字**抄自某份落盘章节返回的文字(可跨行),`evidenceId` 是那份返回的 evidence id,`source`/`section` 写该返回对应的文件与小节名——`section` 是你写的手册小节名,脚本不会改它。
- `answer` 的每一段**在段尾自己写标记** `[evd_…]`(可多个),指向支撑该段的引用;段里不必复述引文原文。没有标记的段、标记指向未通过校验的引用,第 4 步都会拒。
- `status: no_evidence` 时 `citations` 必须为空,`answer` 只能说没有找到,不许凭记忆补。

## 4. 校验与渲染(脚本)

```
node <skill>/scripts/cite.mjs <question folder> --section <hub 落盘的章节返回或 {savedAs} 指针> [--section …] [--search <hub 落盘的 docs.search 返回或 {savedAs} 指针> …] [--list <hub 落盘的 docs.list 返回或 {savedAs} 指针> … --chosen-version <完整版本号>]
```

- 逐条校验:quote 必须逐字出现在某份章节返回里(单行或跨行),evidenceId 必须属于那份返回;`answered` 至少一条引用、每段至少一个 `[evd_…]` 标记且标记都指向已通过校验的引用,`no_evidence` 引用必须为空。校验不过就报错,不产出 answer.md。
- 通过则渲染 `<question folder>/answer.md`:开头一行写明分工(回答是模型判断,引用校验与查询记录是脚本);段落与标记按你写的原样;末尾列引用(evidenceId · source · section,quote),并从 `--search` 返回的 args/result 生成「查询记录」一节(检索词、version、命中数)——这些是脚本从落盘返回取的事实,不用你抄。给了 `--list` 与 `--chosen-version` 时,查询记录先写一行手册目录列表与选定版本;选定版本必须能在列表目录里对上(rel_apv_<版本>),对不上就报错,不猜。

## 5. 报告口径

回答以 `answer.md` 为准;`no_evidence` 时明确说「手册里没有找到」,查询记录照样渲染(查了哪些词、命中多少),不推断。
