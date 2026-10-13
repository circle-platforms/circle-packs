# 安全问题与支持范围

circle-packs 在开发中，不是受支持的生产发行。这里的验收跑在合成样本上。把它装进任何要紧的 circle-hub 之前，先按 [产品线包典范](https://github.com/qingshanfeihu/circle-hub/blob/main/docs/design/product-line-pack.md)里的适配单和审批核对这个包。

## 报告安全问题

仓库使用 GitHub 的私密漏洞报告：在仓库的 **Security** 页面点 **Report a vulnerability**，私下提交。不要在公开 Issue 里披露漏洞细节。

报告时写清：受影响的包或脚本、最小复现、影响、版本或提交号、相关文件。不要上传口令、令牌、内网地址、原始业务资料、设备返回或完整用户会话。

维护者评估后按具体问题安排复现、修复和披露。当前阶段不承诺生产响应时限。

## 仓库里不放的东西

命令树、函数契约、床配置、脑图原件、设备返回、运行时地址和凭据都不进 Git。测试只用合成样本。含这些内容的提交应当被拒绝，而不是打码后留下。

## 不属于本仓库的事

运行时地址、凭据和证书由部署方保管，登记进 circle-hub，不由本仓库托管或轮换。本仓库只提供要装上去的字节。circle-hub 怎样审批和执行，见它的[审批与执行链](https://github.com/qingshanfeihu/circle-hub/blob/main/docs/design/approvals-and-enforcement.md)。
