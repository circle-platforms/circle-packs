# 原件 role:function-contract

- 文件:InfoTest 执行侧 Excel 函数契约(`ist.excel.function-contract`,含 `objects` 与 `entries`,每项 e/f/status,`complete: true`)。
- metadata 必填:`runnerSource`(如 `lib/test_xlsx.py`)、`runnerSha256`;建议 `contractSha256`。
- 上传:执行框架维护人;上传前核对文件 SHA-256 与框架仓库提交一致。
- 阅读:本线技能包(过闸校验 test_env 客户端名)与 Hook 处理器(verify.workbook);审批人经 readers 授权可见草稿。
- 核对:hub 只存字节与 SHA;契约里 `disabled` 的方法(如 `APV.reboot`)在上机链路上被 Hook 拒绝,不靠本文件之外的承诺。
- 举例:`refs/excel_contract.json`(含 `test_env` 的启用方法:clientc/clientd/cliente/routera/routerb/server213/server231/server232)。
