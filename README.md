# Circle Packs

circle-hub（原 circle-server）上承载的技能包和产品线包。circle-hub 是承载技能和 B/C/D/E 四对象的通用平台；这里的内容按模块单独版本、单独发布，通过平台自己的机制装上去（技能包走推送、试跑记录和他人审批），不随 server 一起发布。

## 里面有什么

| 目录 | 内容 | 状态 |
|---|---|---|
| [skills/apv-mindmap-compile](skills/apv-mindmap-compile/SKILL.md) | 把 APV 脑图编译成可上机的执行工作簿：重组意图、按绑定构建核对每条设备命令、出九列单表 | 从 circle-server server-s2 迁入 |

产品线模块（目前在 server-s2 的 `packs/apv`）等平台定好模块接口后再迁入。

## 不放什么

命令树、Excel 函数契约、床配置、脑图原件、设备返回这类内部原件不进 Git。运行时由用户作为原件上传到 circle-server，带 SHA 登记、经另一人批准后才被工具使用。仓库里只有过程、脚本和合成测试数据。

## 模块清单

[modules.json](modules.json) 是 server 安装器读取的清单（schema `circle-packs/modules/1`）。每个模块一项：

| 字段 | 含义 |
|---|---|
| `id` | 模块 id，与目录名、自身清单里的 id 一致 |
| `kind` | `skill-pack`（`skills/<id>/skillpack.json`）或 `product-line`（`products/<id>/product-line.json`） |
| `root` / `manifestPath` | 模块目录和自身清单的相对路径 |
| `version` | 取自自身清单 |
| `files` | 模块目录下全部文件（隐藏文件除外）的相对路径和 SHA-256，按路径排序 |
| `digest` | 把 `files` 按 `sha256sum` 的输出格式（每行 `<sha256>  <path>`）拼成文本后的 SHA-256，可用命令行工具复算 |

安装器只按这份清单冻结字节，再走平台自己的登记、试跑记录和他人批准；清单本身不批准任何东西。改了模块文件后运行 `node tools/modules.ts write` 重写清单。

## 检查

使用 Node.js 24，无需安装依赖：

```sh
node tools/modules.ts check
node --test tools/*.test.ts skills/*/tests/*.test.mjs
```

测试只用合成样本，证明脚本行为，不证明真实产品或设备上的结果。
