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
| A 用户在 Circle 看什么 | srv_buildsite_* / srv_docs_* / srv_zentao_* / srv_env_* 工具,case.xlsx 产物与审批卡片;不加新界面。 |

## 验收记录

- hub 核心零改动;产品名只在清单、模块、规则、数据里。
- 每个资产可被独立审批、被 SHA 钉住、被停用。
- 运行失败只有固定错误码;无平台批准记录。
- 仓库内没有原件、地址、凭据、真实返回。

## 依赖

包的测试需要 hub 的依赖集(exceljs@4.4.0、read-excel-file@9.3.12、fflate@0.8.3、zod@4.6.5 中的 exceljs 与 fflate)。本仓库不 vendored;跑测试时把 hub 的依赖集软链到本目录的 node_modules,例如:

```
ln -s <circle-hub 检出目录>/node_modules node_modules
```
