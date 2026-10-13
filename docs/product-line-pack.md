# 产品线包：本仓库的做法与状态

典范本身——布局、适配单、每类资产怎么写、开发到生效、验收清单——的权威版本在 circle-hub：[docs/design/product-line-pack.md](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/product-line-pack.md)（中文）· [English](https://github.com/circle-platforms/circle-hub/blob/main/docs/design/en/product-line-pack.md)。本页不复述典范，只记录本仓库按典范做了什么、到了哪一步，以及本仓库自己的约定。

## 本仓库的约定

- 一条产品线一个目录 `products/<line>/`，布局按典范：`product-line.json`（tools、hooks、连接器包、工具别名、知识映射、流程）、`connectors/`、`sources/`、`tools/`、`hooks/`、`flows/`、`resources/`、`README.md`（填好的适配单 + 验收记录）。技能包在 `skills/<id>/`，每个自成一体，不跨技能 import。
- Tool 实现是纯函数：输入字节、输出结构，不读环境、不连网、不写文件。只能 import hub 自带依赖集里的包（exceljs 4.4.0、read-excel-file 9.3.12、fflate 0.8.3、zod 4.6.5、saxes、parse5），并在 `product-line.json` 的 `tools[].imports` 里声明；Node 内建模块（`node:*`）也不行，散列用全局 WebCrypto `crypto.subtle`，不需要 import。本仓库不装依赖、不提交 node_modules；跑产品线包的测试前把 circle-hub 的 node_modules 软链过来。
- Hook 处理器签名 `handle({event, binding, subject}) → {decision:'pass'} | {decision:'block', code, facts}`，纯函数、确定性，只拦 100% 可证真的事。主机 shell 只拦真正自毁的命令（对根或系统目录的 rm、mkfs、dd 写设备、shutdown/reboot、passwd/userdel、对根的 chmod/chown -R）；dig、curl、ping、tc、iptables、systemctl 这类客户端步骤必须放行。
- 技能包的 SKILL.md 每一步标明「脚本」或「判断」：有唯一答案的步骤全在 `scripts/`，工具返回由 hub 原样落盘，脚本只拿 evidenceId 指针；判断由模型做，产物里标 `origin: model`。
- 公开仓库：不出现内网地址（样例一律用 192.0.2.0/24 文档段）、本机绝对路径、凭据、原件和真实返回。
- `modules.json` 由 `node tools/modules.ts write` 生成、`node tools/modules.ts check` 复核；清单只冻结字节，不批准任何东西，生效要走 hub 的变更集审批。

## APV 的四项能力

| 能力 | 按典范拆成什么 | 状态 |
|---|---|---|
| 脑图编译 | 技能包 [skills/apv-mindmap-compile](../skills/apv-mindmap-compile/SKILL.md)（重组与撰写是判断，核对、过闸、出表是脚本）。[products/apv](../products/apv/README.md)：原件 role command-tree、function-contract；Tool 实现 mindmap、contracts、function-contract、dialect、workbook（只查形状，不做治理判定）；Hook 处理器 device-command-tree、host-destructive、host-policy（主机闭集 / 字面量 / 可缩小策略，主机名不分大小写）、workbook-contract；流程 apv-case-execute/1；资源 case-gateway（MCP，static-secret，writes device-config） | 技能包 0.2.7 已批准；products/apv 已入 main，18 个合成测试 |
| 用例评审 | 技能包 `skills/apv-case-review`：结构、命令、契约核对是脚本，覆盖、可验证性、风险是判断；产物是带 evidenceId 的评审报告；发现以 knowledge.claim_submit 提交为候选声明；不碰资源，只有登记要审批 | 0.1.3 已入 main，21 个合成测试 |
| PLM 查询 | 连接器实例 query-mirror（禅道）+ zentao.products / bug_search / bug_detail；知识映射 repairJoin（bugzillaID ↔ 修复清单）；缺陷记录按脚本抽成声明（origin script） | 声明抽取已入 main（Tool defect-claims + 技能 apv-defect-claims 0.1.0）；服务凭据是 hub 侧的凭据模式，不在包里 |
| 产品问答 | 技能包 `apv-product-qa`：docs.search / docs.section 取证据，回答带 evidenceId，判断标为模型；没有证据就说没有 | 0.1.3 已入 main；试验 hub 上 answered 与 no_evidence 两条路径试跑通过（10 次调用全在声明内），候选已由独立审批人批准 |

四项能力都没有改 hub：全部是技能包加清单里的映射；这就是典范成立的证据。
