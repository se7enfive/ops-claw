import { RiskLevel } from '../types/security';
import { ToolUseContext } from '../types/tool-context';
import { SessionContext } from '../database';

/** 工具输入泛型约束 */
export type ToolInput = Record<string, unknown>;

/** 工具输出 */
export interface ToolOutput {
  success: boolean;
  data?: unknown;
  error?: string;
  contextUpdates?: Partial<SessionContext>;
}

/** 工具生命周期状态 */
export type ToolState = 'idle' | 'validating' | 'executing' | 'completed' | 'failed';

/** 工具安全配置 */
export interface ToolSecurity {
  riskLevel: RiskLevel;
  requiresConfirmation?: boolean;
  allowedInModes?: ('manual' | 'ai')[];
}

/** 工具元数据 */
export interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  version?: string;
}

/** 工具接口定义 */
export interface Tool<TInput extends ToolInput = ToolInput, TOutput extends ToolOutput = ToolOutput> {
  metadata: ToolMetadata;
  security: ToolSecurity;

  /**
   * 校验输入参数，返回错误信息或 null
   */
  validateInput(input: TInput): string | null;

  /**
   * 执行工具
   */
  execute(input: TInput, context: ToolUseContext): Promise<TOutput>;

  /**
   * 执行后钩子（可选）
   */
  postExecute?(input: TInput, output: TOutput, context: ToolUseContext): Promise<void>;

  /**
   * 是否可用（可选，动态判断）
   */
  isAvailable?(context: ToolUseContext): boolean;
}
