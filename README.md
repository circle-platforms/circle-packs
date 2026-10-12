# Circle Packs

circle-server 上承载的技能包和产品模块。circle-server 是承载技能和 B/C/D/E 四对象的通用平台；这里的内容按模块单独版本、单独发布，通过平台自己的机制装上去（技能包走推送、试跑记录和他人审批），不随 server 一起发布。

## 里面有什么

| 目录 | 内容 | 状态 |
|---|---|---|
| [skills/apv-mindmap-compile](skills/apv-mindmap-compile/SKILL.md) | 把 APV 脑图编译成可上机的执行工作簿：重组意图、按绑定构建核对每条设备命令、出九列单表 | 从 circle-server server-s2 迁入 |

产品线模块（目前在 server-s2 的 `packs/apv`）等平台定好模块接口后再迁入。

## 不放什么

命令树、Excel 函数契约、床配置、脑图原件、设备返回这类内部原件不进 Git。运行时由用户作为原件上传到 circle-server，带 SHA 登记、经另一人批准后才被工具使用。仓库里只有过程、脚本和合成测试数据。

## 检查

使用 Node.js 24，无需安装依赖：

```sh
node --test skills/*/tests/*.test.mjs
```

测试只用合成样本，证明脚本行为，不证明真实产品或设备上的结果。
