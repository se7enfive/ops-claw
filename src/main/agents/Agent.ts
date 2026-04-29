import { ToolUseContext } from '../types/tool-context';
import { SessionContext } from '../database';

/** Agent 优先级覆盖链 */
export type AgentPriority = 'built-in' | 'plugin' | 'user' | 'project' | 'flag' | 'managed';

/** Agent 触发条件 */
export interface AgentCondition {
  type: 'keyword' | 'pattern' | 'category' | 'custom';
  value: string | RegExp | ((prompt: string) => boolean);
  description?: string;
}

/** Agent 配置（声明式） */
export interface AgentConfig {
  // ===== 元数据 =====
  name: string;
  displayName: string;
  description: string;
  version?: string;
  author?: string;
  
  // ===== 优先级 =====
  priority: AgentPriority;
  
  // ===== 工具白名单 =====
  allowedTools: string[];      // 可用的工具列表
  deniedTools?: string[];      // 禁用的工具（覆盖白名单）
  
  // ===== 执行模式 =====
  executionMode: 'parallel' | 'sequential' | 'adaptive';
  maxConcurrency?: number;     // 最大并发数
  
  // ===== 任务分解 =====
  canDecompose?: boolean;      // 是否能分解子任务
  maxDepth?: number;           // 最大分解深度
  
  // ===== 提示词 =====
  systemPrompt: string;
  userPromptTemplate?: string;
  
  // ===== 条件 =====
  conditions?: AgentCondition[];  // 触发条件
}

/** 子任务定义 */
export interface SubTask {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  dependencies?: string[];     // 依赖的其他子任务 ID
  expectedOutput?: string;     // 期望输出描述
  
  // 执行状态
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_confirmation';
  result?: any;
  error?: string;
}

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/** 任务分解结果 */
export interface DecompositionResult {
  success: boolean;
  subTasks: SubTask[];
  reasoning: string;           // 分解推理过程
  suggestedAgent?: string;     // 建议使用的 Agent
  tokenUsage?: TokenUsage;     // Token 消耗统计
}

/** Agent 执行结果 */
export interface AgentExecutionResult {
  agentName: string;
  success: boolean;
  subTasks: SubTask[];
  overallOutput?: string;
  errors: string[];
  durationMs: number;
  contextUpdates?: Partial<SessionContext>;
  /** 执行后的 AI 分析（由 Coordinator 在执行完成后填充） */
  analysis?: {
    summary: string;
    suggestions: string[];
    nextCommand?: string;
    nextCommandReason?: string;
  };
  /** Token 消耗统计（累计所有 AI 调用） */
  tokenUsage?: TokenUsage;
}

/** Agent 接口 */
export interface Agent {
  config: AgentConfig;
  
  /**
   * 判断是否应该处理此任务
   */
  shouldHandle(prompt: string, context: ToolUseContext): boolean;
  
  /**
   * 分解任务（可选）
   */
  decompose?(prompt: string, context: ToolUseContext): Promise<DecompositionResult>;
  
  /**
   * 执行分解后的任务
   * 
   * @param subTasks 要执行的子任务
   * @param context 执行上下文
   * @param onProgress 进度回调函数，用于向 UI 推送实时状态
   * @param requestConfirmation 请求前端用户确认高危操作的挂起回调
   */
  execute(
    subTasks: SubTask[], 
    context: ToolUseContext,
    onProgress?: (subTasks: SubTask[]) => void,
    requestConfirmation?: (task: SubTask) => Promise<boolean>
  ): Promise<AgentExecutionResult>;
  
  /**
   * 生成总结报告
   */
  summarize?(results: SubTask[], context: ToolUseContext): Promise<string>;
}
