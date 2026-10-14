# APV 产品线包

APV 产品线的 harness 原语集合:连接器声明、原件 role、工具实现、钩子处理器、流程版本与资源声明。装进 circle-hub 后经独立审批人批准生效。

## 适配单

| 对象 | 答案 |
|---|---|
| B 读哪些系统 | 5 个连接器:documents / build-site / query-mirror / environment-view / case-gateway;别名 docs/buildsite/zentao/env/case-gateway。`connectors/` 未单独列模板,声明在 `product-line.json` 的 connectorPackages/toolAliases/connectorOptions。 |
| B 上传什么原件 | 两类:`sources/command-tree.md`(role command-tree)、`sources/function-contract.md`(role function-contract)。运行时上传,带 SHA、经独立审批批准。 |
| B 产生什么证据 | 技能包 outputs:case.xlsx、compile_report.json、delivery_report.md、unsuccessful_cases.md;claim 的 origin:脚本抽取的为 script,模型判断的为 model。 |
| C 有哪些流程 | 1 条:`flows/apv-case-execute.json`(apv-case-execute/1)。 |
| C 哪些动作要独立审批 | 只有变更集(登记、修改、批准);运行不审批。 |
| C 有哪些身份 | 范围策略里的角色;资源(case-gateway)用机器身份。 |
| D 碰哪些资源 | 1 个执行资源:`resources/case-gateway.json`(MCP,static-secret,writes device-config)。 |
| D 凭据怎么给 | static-secret,登记/轮换进保险箱,执行时 worker 注入。 |
| D 什么叫未知 | 流程里的 unknown 分支:资源回报与预期不符时停 unknown 并披露,不重发;reconcile 由申请人选择。 |
| E Skill 里哪些是脚本 | 见 skills/apv-mindmap-compile/SKILL.md 分段;脚本在 scripts/,只处理 B 给的字节与自己的产物。 |
| E 清单声明什么 | `product-line.json`:连接器包、别名、连接器选项、知识映射、tools(含 imports)、hooks、flows。 |
| E 挂哪些 Hook | 4 个:`hooks/device-command-tree.ts`(verify.deviceCommand)、`hooks/host-destructive.ts`(verify.hostCommand, order 10)、`hooks/host-policy.ts`(verify.hostCommand, order 20:主机闭集 HOST_NOT_IN_BED/HOST_SET_UNDECLARED、字面量 COMMAND_NOT_LITERAL、单主机前缀策略 HOST_COMMAND_OUTSIDE_POLICY;闭集与前缀由床管理员在 hub 登记资源时从床配置填入 declaration,不进 Git)、`hooks/workbook-contract.ts`(verify.workbook);固定错误码 COMMAND_NOT_IN_TREE / DESTRUCTIVE_COMMAND / HOST_NOT_IN_BED / HOST_SET_UNDECLARED / COMMAND_NOT_LITERAL / HOST_COMMAND_OUTSIDE_POLICY / COMMAND_VALIDATION_FAILED。 |
- 主机闭集与方法启用均由 Hook 判定(host-policy 按已批准声明、workbook-contract 按契约),Tool 只查形状;主机名比较大小写不敏感(床拓扑回报与工作簿/契约写法可能不同),facts 保留原拼写。
| A 用户在 Circle 看什么 | srv_buildsite_* / srv_docs_* / srv_zentao_* / srv_env_* 工具,case.xlsx 产物与审批卡片;不加新界面。 |

## 验收记录

- hub 核心零改动;产品名只在清单、模块、规则、数据里。
- 每个资产可被独立审批、被 SHA 钉住、被停用。
- 运行失败只有固定错误码;无平台批准记录。
- 仓库内没有原件、地址、凭据、真实返回。

### 试验 hub 上的登记记录(2026-10-13)

按典范「开发到生效」的流程,四个技能/模块在试验 hub 上各做了一次真实试跑并提交;以下只记事实与 id。

- **apv-mindmap-compile 0.2.7**:此前已登记。本轮未再试跑。
- **apv-case-review 0.1.3**:对一次编译批次绑定其构建走完评审:定位产品与缺陷检索(zentao.products / zentao.bug_search)、读缺陷详情(zentao.bug_detail)、整批一次命令核对(buildsite.command_check,绑定构建的命令树)、契约核对(apply --contract)、结构检查与报告(脚本,无工具调用)、逐条提交候选声明(knowledge.claim_submit)。试跑共 6 次工具调用,全部在声明内。候选 `skp_84176c5a74b14861be0e0d22f2a9c92b`,已由独立审批人批准(registered)。产出候选声明 2 条(coverage_gap、related_defect,均含证据指针)。
- **apv-defect-claims 0.1.0**:用修复清单中的真实缺陷号取详情并抽取:zentao.products 定位产品、zentao.bug_search 证实产品返回缺陷、zentao.bug_detail 取两条记录、脚本抽取 17 条候选声明(2 个缺陷;其中 1 个无修复提交动作,未编造 repair_note)、knowledge.claim_submit 提交 2 条代表候选。试跑共 5 次工具调用,全部在声明内。候选 `skp_261ba95d44634dfca9bcc8a058ad41ff`,已由独立审批人批准(registered)。
- **apv-product-qa 0.1.3**:试跑未完成。代码已达 0.1.3(手册版本先定位再取段、docs.section 直取、no_evidence 需一次真实未命中);试跑被 hub 的大文件回报 bug 挡住——读约 2.6MB 的手册文件时 worker 回报在服务端出错,操作落 unknown 并冻结文档资源,试跑中断。待 hub 修复后重跑 answered 与 no_evidence 两条路径。
- **host-policy(hub-hook/1,products/apv 1.2.0)**:等 hub 把 verify.hostCommand 的 subject/declaration 两处对上后试跑。

## 执行流(1.3.0,需要 hub ≥ 7b359a3)

toolArguments/receipts/identityProjection/argumentsByTool 这些网关策略映射字段在 7b359a3 之前的 hub 上会被登记拒绝;module 映射保留(sdns),省略时由网关取默认。

## 执行流(1.3.0)

`flows/apv-case-execute-v2.json`(id `apv-case-execute-v2`,driver `hub-execution-transition/1`)把执行流迁入本包:transition 纯函数按观察推进(environment → [topology] → device-map → verify → submit → wait → parse → afterResult → deliver),租约、beforeDispatch、终态核验由 hub 驱动与 worker 完成;工作簿字节经 provider.call 的 byteArgs 受控槽(xlsx_b64),不在 args 内联。环境/结果/拒绝解释是本包纯 Tool(environment/results/refusal),设备映射优先 env_prepare.conf.device_ips。资源声明在 `resources/case-gateway.json` 的 configuration.receiptPolicy(hub-provider/observation/1),登记时以床网关实际工具名覆盖。

## 命令来源(1.3.1)

verify.deviceCommand 的 present 来自两种冻结原件之一:真实床的命令来源制品给 **XML 原件**(command-tree 槽)——流程内 tools/command-tree.ts 解析(与 hub BuildSite.commandsFrom 逐字一致的 scope/menu 遍历,imports 声明 saxes@5.0.1)、tools/command-check.ts 按 hub commandCheck 规则逐条核对并出 `{result:{build,buildId,sourceSha256:XML 字节 SHA,ruleVersion,commands:[…]}}`;合成夹具的 JSON command-check 原件走 projectCommandTree 兼容路径(role 不变)。两条路的核对身份都绑流程的 build 与树原件。

## 依赖

包的测试需要 hub 的依赖集(exceljs@4.4.0、read-excel-file@9.3.12、fflate@0.8.3、zod@4.6.5 中的 exceljs 与 fflate)。本仓库不 vendored;跑测试时把 hub 的依赖集软链到本目录的 node_modules,例如:

```
ln -s <circle-hub 检出目录>/node_modules node_modules
```
