# 产品线包开发典范

一个产品线接进 circle-hub，交付物只有一样东西：**产品线包**。它是若干资产的集合——连接器实例声明、原件、技能包、方法模块、规则包、流程版本、资源声明——外加一份清单。hub 核心不为任何产品线改代码；产品线包按本文的布局和适配单来写，装进 hub 后经独立审批人批准生效。

本文是后续所有产品线包的样板。第一个按它写的是 APV（本仓库），第二个是公开仓库里的合成产品线 meridian，用来证明同一套核心不改也能装第二条线。

## 1. 和对象标准的对应

hub 的四个对象（资料 B、任务 C、执行 D、方法 E）都由同样五样组成：记录、资产、审批策略、证据、扩展点。产品线包只能从**扩展点**插进去，插进去的东西都是**资产**（kind · version · sha256 · declaration · configuration · lifecycle），生效都走**审批策略**（变更集，独立审批人），运行留下**证据**。

| 包里的东西 | 插到哪个对象的扩展点 | 资产 kind | 谁解读 |
|---|---|---|---|
| 连接器实例声明 | B · 连接器包（按系统类型） | connector-instance | hub 的连接器包，只按声明遍历，不认产品 |
| 原件（命令树、函数契约、手册…） | B · 原件上传（文件 + role + metadata） | knowledge-source | 方法模块；hub 只存字节与 SHA |
| 对象词表、知识映射 | B · 词表 / 清单 | 写在产品线清单里 | hub 的知识层按映射登记声明 |
| 技能包 | E · 技能包 | skill-package | 无界面的 Circle 执行；hub 核对声明工具与试跑 |
| 方法模块 | E · 方法模块（纯 TS，作用于 B 的字节） | product-line 模块 | hub 装载后在边界调用 |
| 规则包 | E · 规则包（派发前、交付前的确定性闸） | product-line 模块 | hub 在执行链第 3 步调用 |
| 流程版本 | C · 流程版本 | product-line 模块 | hub 的任务引擎按版本推进 |
| 资源声明 | D · 资源适配器 + 凭据模式 + profile | connector-instance（执行资源） | hub 的 worker；端点与密钥在库外 profile 和保险箱 |

不在表里的东西不属于产品线包：改 hub 核心、改 Circle 核心、写死地址或凭据，都不是「适配」。

## 2. 目录布局

```
circle-packs/
  modules.json                     安装清单（schema circle-packs/modules/1）：每个模块的 root、manifestPath、version、files+sha、digest
  products/<line>/
    product-line.json              清单 product-line/1：连接器包、工具别名、连接器选项、知识映射、方法模块、规则、流程
    connectors/<package>.json      连接器实例声明模板：declaration + configuration，不含地址与凭据（运行时由管理员填）
    sources/<role>.md              每类原件的 role、metadata 键、谁上传、怎么核对
    modules/<name>.ts              方法模块：解析器、契约、结果解释；纯函数，输入是 B 的字节
    rules/<name>.ts                规则包：对一次运行的确定性判定，返回错误码与事实
    flows/<name>.json              流程版本：阶段、等待原因枚举、交付项
    resources/<name>.json          执行资源声明：writes、凭据模式、runtimeProfileRef、是否 executionIsChange
    README.md                      填好的适配单 + 验收记录
  skills/<skill-id>/
    SKILL.md                       给模型看的流程：哪些步骤是脚本、哪些是判断
    skillpack.json                 清单：id、version、tools、inputs、outputs、triggers、model
    scripts/                       有唯一答案的步骤全在这里；不调外部系统，只处理 B 给的字节
    references/                    契约、规则的说明（不含原件）
    tests/                         合成样本上的测试；只证明脚本行为
```

原件、床配置、真实返回不进仓库：它们是运行时上传到 hub 的原件（B），带 SHA、经独立审批人批准后才被模块读到。

## 3. 适配单

把一项能力接进来，先填这张表，答案只能是「N 个资产 + M 条流程 + K 条规则」；哪一格的答案是「改 hub」，就回到设计。

| 对象 | 要回答的问题 | 答案形式 |
|---|---|---|
| B | 读哪些系统？每个系统类型一个连接器 | `connectors/*.json` + 清单 connectorPackages / toolAliases |
| B | 有没有要上传的原件？文件 + role + metadata | `sources/*.md` 定义 role；运行时上传 |
| B | 产生什么证据？能提交什么声明？声明的来源是脚本还是模型？ | 技能包的 outputs；knowledge.claim_submit 的 origin |
| C | 有哪些流程？每条有版本号 | `flows/*.json` |
| C | 哪些动作要独立审批人？ | 只有变更集（登记、修改）；运行不审批 |
| C | 有哪些身份？人、服务客户端 | 范围策略里的角色；资源用机器身份 |
| D | 碰哪些资源？走哪种协议的适配器？ | `resources/*.json`：MCP 网关 / SSH / HTTP / 浏览器 |
| D | 凭据怎么给？ | static-secret / hub 签发 / 外部 OAuth |
| D | 什么叫未知？怎么核对？ | 流程里的 unknown 分支与 reconcile |
| E | 技能包里哪些是脚本、哪些是模型判断？ | SKILL.md 分段写明；脚本在 scripts/ |
| E | 产品线清单声明什么？ | `product-line.json` |
| E | hub 在边界跑哪些确定性规则？ | `rules/*.ts`，返回固定错误码 |
| A | 用户在 Circle 里看什么、做什么？ | 用到的 srv_* 工具、/hub 命令、卡片与登记簿；不加新界面 |

## 4. 每类资产怎么写

- **连接器实例声明**：只写 declaration（reads / writes / credentials 引用名）和 configuration 的形状；地址、账号、CA 在管理员登记时填进库外 profile 或保险箱。同一个连接器包被两条产品线用时，各自一个实例、各自的别名。
- **原件**：每种 role 一段说明——文件是什么、从哪来、metadata 必填哪些键（例如 buildName、platform）、怎么核对 SHA、谁有权上传与阅读。metadata 是上传者的声明，hub 不验证；要验证的事（例如床的实际构建）在运行时由资源回报。
- **技能包**：SKILL.md 先写输入、工具、输出，再按步骤写；每一步标明「脚本」或「判断」。脚本只处理 B 给的字节（原件、工具返回）和自己的产物；工具返回由 hub 原样保存，脚本只拿 evidenceId 指针。试跑记录要覆盖技能声明的每条路径（例如站点构建和上传原件两种绑定）。
- **Tool 实现**：纯函数，输入字节、输出结构；不读环境、不连网、不写文件。在内存里用解析库处理字节是允许的（例如用 ExcelJS 读一个 Buffer），但只能 import hub 自带依赖集里的包（exceljs、read-excel-file、fflate、zod、saxes、parse5，精确版本），并在清单的 `tools[].imports` 里声明；包的测试需要 hub 的依赖集（node_modules 软链或安装同版本）。版本随产品线清单。
- **规则包**：输入一次运行的绑定（方法、资源、原件、输入），输出通过或一个固定错误码加事实。规则是 100% 可证真的判定；判定不了的不写规则，交给披露。
- **流程版本**：阶段枚举固定（received · running · waiting-input · waiting-review · delivered · failed · cancelled），等待原因是枚举字段，交付项列清楚。
- **资源声明**：writes 写实话（会改设备配置就写 device-config）；要两人规则的生产资源声明 executionIsChange。

## 5. 开发到生效

1. 本地开发技能包与模块，用合成样本跑 tests/。
2. 在 Circle 里登录 hub，`/hub trial start`，按 SKILL.md 走一遍真实工具（只读），产物带 SHA。
3. `/hub skill push`：清单、文件、试跑记录一起作为变更集提交；hub 核对声明工具 = 试跑实际调用、引用的资产已就绪。
4. 独立审批人在自己的 Circle 里决定；批准后版本不可变，改动就是新版本。
5. 产品线清单、模块、规则、流程由 `modules.json` 列出，`/hub install` 从仓库装入，同样是变更集。
6. 运行走执行链，不审批；报错带错误码回会话，未知如实披露。

## 6. 验收清单

- hub 核心零改动；产品名只出现在清单、模块、规则和数据里。
- 每个资产都能被独立审批人批准、被 SHA 钉住、被停用。
- 技能包的试跑覆盖每条声明路径；未声明的工具一个都没调。
- 运行失败只有固定错误码；没有「平台批准」的记录。
- 第二条产品线装进去不改核心（公开仓库里的 meridian 就是这条）。
- 仓库里没有原件、地址、凭据、真实返回。

## 7. 样例：APV 的四项能力

| 能力 | InfoTest 里的样子 | 按典范拆成什么 | 状态 |
|---|---|---|---|
| 脑图编译 | 事件溯源编译引擎，脑图 → case.xlsx，机械规则 + 真机结果两道关 | 技能包 `apv-mindmap-compile`（重组与撰写是判断，核对、过闸、出表是脚本）；原件 role command-tree、function-contract；规则 command_check、工具声明一致、自毁规则；流程 apv-case-execute/1；资源 跳板机网关（MCP，static-secret，writes device-config） | 技能包 0.2.7 已批；清单、规则、流程仍在 hub 代码里，待迁入 `products/apv/` |
| 用例评审 | test-list-review：证据纪律 + 缺陷库检索，评审用例与测试策略 | 技能包 `apv-case-review`：读原件（命令树、契约、手册）和缺陷查询，脚本做命令与契约核对，模型做覆盖与风险判断；产物是评审报告（带 evidenceId）；发现以 knowledge.claim_submit 提交为候选声明；不碰资源，只有登记要审批 | 未适配；InfoTest 的 Python 是行为参考，脚本重写为 TS |
| PLM 查询 | defect_fetch_on_demand：Bugzilla → 禅道回退链，缺陷元数据进评审 | 连接器实例 `query-mirror`（禅道）+ 工具 zentao.products / bug_search / bug_detail；知识映射 repairJoin（bugzillaID ↔ 修复清单）；缺陷记录按脚本抽成声明（origin script） | 连接器与工具已有；声明抽取与服务凭据未做（现在是个人凭据注入） |
| 产品问答 | Product_QA skill：手册检索 + 回答 | 技能包 `apv-product-qa`：docs.search / docs.section 取证据，回答带 evidenceId，判断标为模型；没有证据就说没有 | 连接器 `documents` 已有；技能包未做 |

填表时发现的共性：三条「未做」都不需要改 hub，都是技能包 + 清单里的映射；这就是标准成立的证据。
