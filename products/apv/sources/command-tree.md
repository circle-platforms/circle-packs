# 原件 role:command-tree

- 文件:设备 CLI 命令树(菜单路径式 XML),一个构建一份。
- metadata 必填:`buildName`(构建名,如 `InfosecOS_Beta_APV_HG_K_10_5_0_585`);建议 `versionLine`、`platform`、`releasedOn`。
- 上传:产品线的测试工程负责人;上传前核对文件 SHA-256 与来源一致。
- 阅读:本线技能包与 Hook 处理器;审批人经 readers 授权可见草稿。
- 核对:hub 只存字节与 SHA;床上实际构建由运行时 `env_prepare` 回报,与本原件的 `buildName` 不符时不执行。
- 举例:`refs/cmdtree_585.xml`(Beta 床,buildName 声明为预期值,未经床确认时须在 metadata.note 写明)。
