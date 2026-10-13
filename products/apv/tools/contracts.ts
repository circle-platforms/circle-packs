// Tool: 执行包声明与输入校验(纯函数,不读环境、不连网、不写文件)。
// 来源:server-s2 packs/apv/execution/contracts.ts @ bd364ac58ac16b8496c5bac39246b8c64c6e0e68
// 迁移说明:原版依赖 zod 与 server-s2 contracts 包(registerErrorCodes/registerOperation 副作用
// 与实现哈希的文件读取);本版内联为无副作用的声明结构与一个纯校验函数,不注册任何东西。
export interface ExecutionInput {
  sourceRevisionId?: string;
  artifactId?: string;
  sourceSha256?: string;
  methodAssetId?: string;
  gatewayAssetId: string;
  commandSourceAssetId: string;
  build: string;
  platform?: string | null;
  module?: string;
  deadlineMs?: number;
}
export interface ExecutionInputError { field: string; message: string }

const ID = /^[a-z]+_[A-Za-z0-9]+$/;
const SHA = /^[a-f0-9]{64}$/;

// Pure validation of the execution input. Returns [] when the input is well-formed.
export function validateExecutionInput(input: unknown): ExecutionInputError[] {
  const errors: ExecutionInputError[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [{ field: '$', message: 'input must be an object' }];
  const value = input as Record<string, unknown>;
  const need = (field: string, pattern: RegExp, max = 200) => {
    const v = value[field];
    if (typeof v !== 'string' || !v || v.length > max || !pattern.test(v)) errors.push({ field, message: 'required identifier is missing or malformed' });
  };
  need('gatewayAssetId', ID); need('commandSourceAssetId', ID);
  if (typeof value.build !== 'string' || !value.build || value.build.length > 200) errors.push({ field: 'build', message: 'build is required' });
  if (value.sourceRevisionId !== undefined && (typeof value.sourceRevisionId !== 'string' || !/^src_/.test(value.sourceRevisionId)))
    errors.push({ field: 'sourceRevisionId', message: 'malformed source revision id' });
  if (value.artifactId !== undefined && (typeof value.artifactId !== 'string' || !/^art_/.test(value.artifactId)))
    errors.push({ field: 'artifactId', message: 'malformed artifact id' });
  if (!!value.sourceRevisionId === !!value.artifactId) errors.push({ field: '$', message: 'provide exactly one source or artifact' });
  if (value.sourceSha256 !== undefined && (typeof value.sourceSha256 !== 'string' || !SHA.test(value.sourceSha256)))
    errors.push({ field: 'sourceSha256', message: 'malformed sha256' });
  if (value.platform !== undefined && value.platform !== null && (typeof value.platform !== 'string' || !value.platform || value.platform.length > 100))
    errors.push({ field: 'platform', message: 'malformed platform' });
  if (value.module !== undefined && (typeof value.module !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.module)))
    errors.push({ field: 'module', message: 'malformed module' });
  if (value.deadlineMs !== undefined && (!Number.isInteger(value.deadlineMs) || (value.deadlineMs as number) < 1000 || (value.deadlineMs as number) > 3600000))
    errors.push({ field: 'deadlineMs', message: 'deadline must be 1000..3600000 ms' });
  return errors;
}

// The execution pack declaration, as data. The original also computed an implementationSha256
// over the execution sources; in the pack the digest is produced by tools/modules.ts instead.
export const ExecutionPack = {
  capabilityPackId: 'apv-case-execute',
  version: '1.0.0',
  flowVersion: 'apv-case-execute/1',
  title: 'APV 工作簿上机执行',
  inputFormats: ['apv-execution-xlsx/1'],
  contractVersion: 'APV_EXCEL_CONTRACT | apv.excel.runtime | v1',
  requiredOperations: ['cases.verify', 'cases.execute', 'cases.observe'],
  conclusionScope: 'gateway-device-observation',
  inputSchema: {
    type: 'object',
    required: ['gatewayAssetId', 'commandSourceAssetId', 'build'],
    properties: {
      sourceRevisionId: { type: 'string', pattern: '^src_' },
      artifactId: { type: 'string', pattern: '^art_' },
      sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      methodAssetId: { type: 'string' },
      gatewayAssetId: { type: 'string' },
      commandSourceAssetId: { type: 'string' },
      build: { type: 'string', minLength: 1, maxLength: 200 },
      platform: { anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'null' }] },
      module: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' },
      deadlineMs: { type: 'integer', minimum: 1000, maximum: 3600000, default: 3600000 },
    },
    additionalProperties: false,
  },
} as const;
