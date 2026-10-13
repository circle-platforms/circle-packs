---
name: apv-product-qa
description: Answer APV product questions from the manuals with verbatim citations, using the circle-hub document tools. Use when asked about APV product behavior, commands or configuration.
---

# APV 产品问答

Answer a product question only from what the manuals say, with every claim tied to a hub-saved section. No evidence, no answer.

## 输入

- `question`(问题,任意措辞)、`product`(产品线,如 APV)、`versionLine`(如 10.5)。
- circle-hub 工具:`srv_docs_list`、`srv_docs_section`。缺了就说明并停下:不凭记忆作答。

## 0. 确定手册版本(工具 + 判断)

`version` 参数要的是**手册的完整版本号**,不是版本线——文档源按目录存放(如 `rel_apv_10_5_0`),版本线 10.5 对应的目录不存在,报错还和「无权限」长得一样。先用 `srv_docs_list` 列出可用手册目录,选与绑定构建一致的那个完整版本(如 585 构建 → 10.5.0),把列表结果和选择交给第 4 步的脚本记进查询记录。列表里没有对应的版本就如实说,不猜、不退回版本线。

## 1. 检索词(判断)

从问题里拆出该查手册的词:命令名、功能名、配置对象。用产品的通用词,不造词;问题本身含命令名就直接用它。

## 2. 定位与取段(工具 + 判断)

- `srv_docs_list` 列出选定手册目录(`cli/rel_apv_<版本>/`),定位到手册本体文件;这本手册是单文件(`cli_cn.md`),直接取段。**anchor 只能来自问题里的命令名或 catalog 条目,不许猜**——问题问哪条命令,anchor 就是那条命令的小节标题。
- `srv_docs_section` 带 `file` 与 `anchor` 直取小节;hub 原样落盘每次返回(`savedAs` 指向路径),答案只引用落盘返回里的文字。`version` 一律传第 0 步选定的完整版本号。
- 小节未命中也如实记录。**no_evidence 必须有一次真实的 section 未命中**,不能是没查:没查不是「手册里没有」。注意:本项目对不存在的 anchor 返回的是 `SOURCE_FORBIDDEN`(与「源不可用」同码,这是 hub 的合并语义),且非 200 返回目前不落盘——未命中的证据目前只能是试跑记录里的调用本身;hub 把非 200 返回也落盘后,lookup 才能渲染未命中行。
- 多文件目录的窄范围搜索(docs.search)目前在 hub 侧超时,是 hub 的 bug;修复后再把窄搜加回本步骤。

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
node <skill>/scripts/cite.mjs <question folder> --section <hub 落盘的章节返回或 {savedAs} 指针> [--section …] [--lookup <hub 落盘的 docs.section 返回或 {savedAs} 指针> …] [--list <hub 落盘的 docs.list 返回或 {savedAs} 指针> … --chosen-version <完整版本号>]
```

- 逐条校验:quote 必须逐字出现在某份章节返回里(单行或跨行),evidenceId 必须属于那份返回;`answered` 至少一条引用、每段至少一个 `[evd_…]` 标记且标记都指向已通过校验的引用,`no_evidence` 引用必须为空。校验不过就报错,不产出 answer.md。
- 通过则渲染 `<question folder>/answer.md`:开头一行写明分工(回答是模型判断,引用校验与查询记录是脚本);段落与标记按你写的原样;末尾列引用(evidenceId · source · section,quote),并从 `--lookup` 返回的 args/result 生成「查询记录」一节——每次 section 直取一行,写 file 与 anchor,命中标「命中」、未命中标「未命中(<错误码>)」;这些是脚本从落盘返回取的事实,不用你抄。给了 `--list` 与 `--chosen-version` 时,查询记录先写一行手册目录列表与选定版本;选定版本必须能在列表目录里对上(rel_apv_<版本>),对不上就报错,不猜。

## 5. 报告口径

回答以 `answer.md` 为准;`no_evidence` 时明确说「手册里没有找到」,查询记录照样渲染(定位与每次 section 直取/未命中),不推断。
