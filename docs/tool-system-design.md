# P1：工具系统重构设计

> 优先级：高（统一抽象，便于扩展）
> 预计工作量：3-5 天
> 前置依赖：P0 命令安全分析器

## 一、设计目标

将现有的分散功能（SSH 执行、AI 生成、文件操作等）统一抽象为工具接口，实现：
- **统一抽象**：所有功能通过 Tool 接口定义
- **动态注册**：工具池可动态增删
- **权限分层**：每个工具声明安全等级
- **上下文修改器**：工具执行后可自动更新 SessionContext
- **生命周期钩子**：支持 Pre/Post 执行钩子

## 二、核心类型定义

```typescript
// src/main/tools/Tool.ts

import { ZodSchema, z } from 'zod';
import { RiskLevel } from '../types/security';
import { ToolUseContext } from '../types/tool-context';
import { SessionContext } from '../context/SessionContext';

/** 工具输入泛型约束 */
export type ToolInput = Record<string, unknown>;

/** 工具输出泛型约束 */
export type ToolOutput = {
  success: boolean;
  data?: unknown;
  error?: string;
  messages?: ToolMessage[];      // 可注入对话片段
  contextModifier?: ContextModifier;  // 上下文修改器
};

/** 工具产生的对话片段 */
export interface ToolMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

/** 上下文修改器函数 */
export type ContextModifier = (result: ToolOutput) => Partial<SessionContext>;

/** 工具生命周期状态 */
export type ToolState = 'idle' | 'validating' | 'executing' | 'completed' | 'failed';

/** 工具安全配置 */
export interface ToolSecurity {
  riskLevel: RiskLevel;
  requiresConfirmation?: boolean;
  allowedInModes?: ('manual' | 'ai')[];
  allowedInOS?: ('linux' | 'windows')[];
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

/** 工具元数据 */
export interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  version?: string;
  author?: string;
  tags?: string[];
  examples?: string[];
}

/** 工具接口定义 */
export interface Tool<TInput extends ToolInput = ToolInput, TOutput extends ToolOutput = ToolOutput> {
  // ===== 元数据 =====
  metadata: ToolMetadata;
  
  // ===== 输入定义 =====
  inputSchema: ZodSchema<TInput>;
  
  // ===== 安全配置 =====
  security: ToolSecurity;
  
  // ===== 并发安全 =====
  concurrentSafe?: boolean;  // 是否可与其他工具并行执行
  
  // ===== 核心方法 =====
  
  /**
   * 执行工具
   * @param input 经过 schema 校验的输入参数
   * @param context 工具执行上下文
   */
  execute(input: TInput, context: ToolUseContext): Promise<TOutput>;
  
  // ===== 可选钩子 =====
  
  /**
   * 执行前钩子（可选）
   * 返回 false 可阻止执行
   */
  preExecute?(input: TInput, context: ToolUseContext): Promise<boolean | string>;
  
  /**
   * 执行后钩子（可选）
   */
  postExecute?(input: TInput, output: TOutput, context: ToolUseContext): Promise<void>;
  
  /**
   * 上下文修改器（可选）
   * 工具执行成功后自动更新 SessionContext
   */
  contextModifier?: ContextModifier;
  
  /**
   * 错误处理（可选）
   */
  onError?(error: Error, input: TInput, context: ToolUseContext): Promise<TOutput>;
  
  /**
   * 进度报告（可选，用于长时间任务）
   */
  onProgress?(progress: { percent: number; message: string }): void;
  
  /**
   * 是否可用（可选，动态判断）
   * 例如：某些工具仅在连接状态下可用
   */
  isAvailable?(context: ToolUseContext): boolean;
}

/** 工具工厂函数类型 */
export type ToolFactory<TInput extends ToolInput, TOutput extends ToolOutput> = (
  config?: Partial<Tool<TInput, TOutput>>
) => Tool<TInput, TOutput>;
```

```typescript
// src/main/types/tool-context.ts

import { ServerConfig, SessionContext } from '../context/SessionContext';
import { AIConfig } from '../services/DatabaseManager';

/** 工具执行上下文 */
export interface ToolUseContext {
  // ===== 会话信息 =====
  sessionId: string;
  serverId: number;
  connectionId?: string;
  shellSessionId?: string;
  
  // ===== 服务器信息 =====
  serverConfig: ServerConfig;
  os: 'linux' | 'windows';
  
  // ===== 上下文信息 =====
  sessionContext: SessionContext;
  
  // ===== AI 信息 =====
  aiConfig: AIConfig;
  
  // ===== 用户信息 =====
  userId?: string;
  permissionMode: 'allow' | 'confirm' | 'deny';
  
  // ===== 工具池 =====
  availableTools: string[];
  
  // ===== 日志 =====
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;
  
  // ===== 进度报告 =====
  reportProgress: (progress: { percent: number; message: string }) => void;
  
  // ===== 发送消息到前端 =====
  sendMessage: (message: ToolMessage) => void;
}
```

## 三、工具注册池

```typescript
// src/main/tools/ToolRegistry.ts

import { Tool, ToolInput, ToolOutput, ToolFactory } from './Tool';
import { RiskLevel } from '../types/security';

/** 工具注册项 */
interface ToolRegistryEntry {
  tool: Tool;
  factory?: ToolFactory<any, any>;
  enabled: boolean;
  priority: number;  // 工具展示优先级
}

/** 工具注册池 */
export class ToolRegistry {
  private tools: Map<string, ToolRegistryEntry> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();
  
  /**
   * 注册工具
   */
  register<TInput extends ToolInput, TOutput extends ToolOutput>(
    tool: Tool<TInput, TOutput>,
    options?: {
      enabled?: boolean;
      priority?: number;
      factory?: ToolFactory<TInput, TOutput>;
    }
  ): void {
    const name = tool.metadata.name;
    
    if (this.tools.has(name)) {
      console.warn(`工具 ${name} 已存在，将被覆盖`);
    }
    
    const entry: ToolRegistryEntry = {
      tool,
      factory: options?.factory,
      enabled: options?.enabled ?? true,
      priority: options?.priority ?? 100,
    };
    
    this.tools.set(name, entry);
    
    // 分类索引
    const category = tool.metadata.category;
    if (!this.categoryIndex.has(category)) {
      this.categoryIndex.set(category, new Set());
    }
    this.categoryIndex.get(category)!.add(name);
  }

  /**
   * 批量注册工具
   */
  registerAll(toolClasses: (new () => Tool)[]): void {
    for (const ToolClass of toolClasses) {
      const tool = new ToolClass();
      this.register(tool);
    }
  }

  /**
   * 取消注册
   */
  unregister(name: string): boolean {
    const entry = this.tools.get(name);
    if (!entry) return false;
    
    this.tools.delete(name);
    
    // 从分类索引移除
    const category = entry.tool.metadata.category;
    this.categoryIndex.get(category)?.delete(name);
    
    return true;
  }

  /**
   * 获取工具
   */
  getTool<TInput extends ToolInput, TOutput extends ToolOutput>(
    name: string,
    context?: Partial<ToolUseContext>
  ): Tool<TInput, TOutput> | null {
    const entry = this.tools.get(name);
    if (!entry || !entry.enabled) return null;
    
    // 检查工具是否可用
    const tool = entry.tool as Tool<TInput, TOutput>;
    if (context && tool.isAvailable && !tool.isAvailable(context as ToolUseContext)) {
      return null;
    }
    
    return tool;
  }

  /**
   * 获取所有可用工具
   */
  getAvailableTools(context?: ToolUseContext): Tool[] {
    const available: Tool[] = [];
    
    for (const [name, entry] of this.tools) {
      if (!entry.enabled) continue;
      
      const tool = entry.tool;
      
      // 检查是否可用
      if (context && tool.isAvailable && !tool.isAvailable(context)) {
        continue;
      }
      
      // 检查权限模式
      if (context?.permissionMode === 'deny' && tool.security.riskLevel !== RiskLevel.SAFE) {
        continue;
      }
      
      available.push(tool);
    }
    
    // 按优先级排序
    return available.sort((a, b) => {
      const aPriority = this.tools.get(a.metadata.name)?.priority ?? 100;
      const bPriority = this.tools.get(b.metadata.name)?.priority ?? 100;
      return aPriority - bPriority;
    });
  }

  /**
   * 按分类获取工具
   */
  getToolsByCategory(category: string): Tool[] {
    const names = this.categoryIndex.get(category);
    if (!names) return [];
    
    return Array.from(names)
      .map(name => this.tools.get(name)?.tool)
      .filter((tool): tool is Tool => tool !== undefined && tool !== null);
  }

  /**
   * 获取工具描述（用于 AI prompt）
   */
  getToolDescriptionsForAI(context?: ToolUseContext): string {
    const tools = this.getAvailableTools(context);
    
    const descriptions = tools.map(tool => {
      const schemaDesc = this.describeSchema(tool.inputSchema);
      return `### ${tool.metadata.name}
${tool.metadata.description}
输入参数:
${schemaDesc}
风险等级: ${tool.security.riskLevel}`;
    });
    
    return descriptions.join('\n\n');
  }

  /**
   * 启用/禁用工具
   */
  setEnabled(name: string, enabled: boolean): void {
    const entry = this.tools.get(name);
    if (entry) {
      entry.enabled = enabled;
    }
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size;
  }

  // ===== 私有方法 =====

  private describeSchema(schema: ZodSchema): string {
    // 简化 schema 描述
    try {
      const shape = (schema as any)._def?.shape || {};
      const fields = Object.entries(shape).map(([key, value]) => {
        const type = (value as any)._def?.typeName || 'unknown';
        return `- ${key}: ${type.toLowerCase()}`;
      });
      return fields.join('\n');
    } catch {
      return '(参数定义见 schema)';
    }
  }
}
```

## 四、工具执行器

```typescript
// src/main/tools/ToolExecutor.ts

import { Tool, ToolInput, ToolOutput, ToolState } from './Tool';
import { ToolUseContext } from '../types/tool-context';
import { ToolRegistry } from './ToolRegistry';
import { SecurityAnalyzer } from './SecurityAnalyzer';
import { RiskLevel } from '../types/security';

/** 执行请求 */
export interface ToolExecutionRequest {
  toolName: string;
  input: ToolInput;
  context: ToolUseContext;
  userConfirmed?: boolean;
}

/** 执行结果（扩展） */
export interface ToolExecutionResult extends ToolOutput {
  toolName: string;
  state: ToolState;
  durationMs: number;
  securityAnalysis?: SecurityAnalysisResult;
  validationError?: string;
}

/** 并发执行队列 */
interface ExecutionQueueItem {
  request: ToolExecutionRequest;
  resolve: (result: ToolExecutionResult) => void;
  reject: (error: Error) => void;
}

/** 工具执行器 */
export class ToolExecutor {
  private registry: ToolRegistry;
  private securityAnalyzer: SecurityAnalyzer;
  
  // 执行队列（非并发安全工具串行执行）
  private executionQueue: ExecutionQueueItem[] = [];
  private isExecuting = false;
  private activeExecutions: Set<string> = new Set();  // 正在执行的工具名

  constructor(registry: ToolRegistry, securityAnalyzer: SecurityAnalyzer) {
    this.registry = registry;
    this.securityAnalyzer = securityAnalyzer;
  }

  /**
   * 执行工具（核心入口）
   */
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const { toolName, input, context, userConfirmed } = request;

    // Step 1: 获取工具
    const tool = this.registry.getTool(toolName, context);
    if (!tool) {
      return this.createResult(toolName, startTime, {
        success: false,
        error: `工具 ${toolName} 不存在或不可用`,
        state: 'failed',
      });
    }

    // Step 2: 安全分析
    if (tool.security.riskLevel !== RiskLevel.SAFE) {
      const command = this.extractCommandFromInput(toolName, input);
      const analysis = this.securityAnalyzer.analyze(command);
      
      if (analysis.blocked && !userConfirmed) {
        return this.createResult(toolName, startTime, {
          success: false,
          error: '命令被安全策略阻止',
          state: 'failed',
          securityAnalysis: analysis,
        });
      }

      if (analysis.requiresConfirmation && !userConfirmed) {
        return this.createResult(toolName, startTime, {
          success: false,
          error: '需要用户确认',
          state: 'idle',
          securityAnalysis: analysis,
        });
      }
    }

    // Step 3: 输入校验
    let validatedInput: ToolInput;
    try {
      validatedInput = tool.inputSchema.parse(input) as ToolInput;
    } catch (error: any) {
      return this.createResult(toolName, startTime, {
        success: false,
        error: `输入参数校验失败: ${error.message}`,
        state: 'failed',
        validationError: error.message,
      });
    }

    // Step 4: 并发控制
    if (!tool.concurrentSafe && this.activeExecutions.has(toolName)) {
      // 需要等待
      return this.queueExecution(request, startTime);
    }

    this.activeExecutions.add(toolName);

    try {
      // Step 5: 执行前钩子
      if (tool.preExecute) {
        const preResult = await tool.preExecute(validatedInput, context);
        if (preResult === false) {
          return this.createResult(toolName, startTime, {
            success: false,
            error: 'PreExecute 钩子阻止执行',
            state: 'failed',
          });
        }
        if (typeof preResult === 'string') {
          return this.createResult(toolName, startTime, {
            success: false,
            error: preResult,
            state: 'failed',
          });
        }
      }

      // Step 6: 执行
      const output = await tool.execute(validatedInput, context);

      // Step 7: 执行后钩子
      if (tool.postExecute) {
        await tool.postExecute(validatedInput, output, context);
      }

      // Step 8: 上下文修改器
      if (output.success && tool.contextModifier) {
        const contextUpdates = tool.contextModifier(output);
        // 应用上下文更新（由外部处理）
        output.contextModifier = tool.contextModifier;
      }

      return this.createResult(toolName, startTime, {
        ...output,
        state: 'completed',
      });

    } catch (error: any) {
      // 错误处理钩子
      if (tool.onError) {
        return tool.onError(error, validatedInput, context);
      }

      return this.createResult(toolName, startTime, {
        success: false,
        error: error.message,
        state: 'failed',
      });

    } finally {
      this.activeExecutions.delete(toolName);
      this.processQueue();
    }
  }

  /**
   * 执行多个工具（并行）
   */
  async executeMultiple(
    requests: ToolExecutionRequest[]
  ): Promise<ToolExecutionResult[]> {
    // 分组：并发安全的可并行，非并发安全的串行
    const safeRequests = requests.filter(r => {
      const tool = this.registry.getTool(r.toolName);
      return tool?.concurrentSafe;
    });
    
    const unsafeRequests = requests.filter(r => {
      const tool = this.registry.getTool(r.toolName);
      return !tool?.concurrentSafe;
    });

    // 并行执行并发安全工具
    const safeResults = await Promise.all(
      safeRequests.map(r => this.execute(r))
    );

    // 串行执行非并发安全工具
    const unsafeResults: ToolExecutionResult[] = [];
    for (const request of unsafeRequests) {
      const result = await this.execute(request);
      unsafeResults.push(result);
    }

    return [...safeResults, ...unsafeResults];
  }

  /**
   * 确认后继续执行
   */
  async executeWithConfirmation(
    request: ToolExecutionRequest,
    confirmed: boolean
  ): Promise<ToolExecutionResult> {
    return this.execute({ ...request, userConfirmed: confirmed });
  }

  // ===== 私有方法 =====

  private createResult(
    toolName: string,
    startTime: number,
    partial: Partial<ToolExecutionResult>
  ): ToolExecutionResult {
    return {
      toolName,
      success: partial.success ?? false,
      data: partial.data,
      error: partial.error,
      messages: partial.messages,
      state: partial.state ?? 'idle',
      durationMs: Date.now() - startTime,
      securityAnalysis: partial.securityAnalysis,
      validationError: partial.validationError,
    };
  }

  private queueExecution(
    request: ToolExecutionRequest,
    startTime: number
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve, reject) => {
      this.executionQueue.push({ request, resolve, reject });
    });
  }

  private processQueue(): void {
    if (this.isExecuting || this.executionQueue.length === 0) return;

    this.isExecuting = true;
    const item = this.executionQueue.shift()!;

    this.execute(item.request)
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        this.isExecuting = false;
        this.processQueue();
      });
  }

  private extractCommandFromInput(toolName: string, input: ToolInput): string {
    // 从输入参数中提取命令字符串
    if (toolName === 'ssh:execute' && input.command) {
      return input.command as string;
    }
    return toolName;
  }
}
```

## 五、具体工具实现示例

### SSH 执行工具

```typescript
// src/main/tools/implementations/SSHExecuteTool.ts

import { Tool, ToolOutput } from '../Tool';
import { z } from 'zod';
import { RiskLevel } from '../../types/security';
import { ServerManager } from '../../services/ServerManager';
import { CommandHistory } from '../../context/SessionContext';

/** SSH 执行输入参数 */
const SSHExecuteInputSchema = z.object({
  connectionId: z.string().describe('SSH 连接 ID'),
  command: z.string().min(1).describe('要执行的命令'),
});

interface SSHExecuteInput {
  connectionId: string;
  command: string;
}

interface SSHExecuteOutput extends ToolOutput {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export class SSHExecuteTool implements Tool<SSHExecuteInput, SSHExecuteOutput> {
  private serverManager: ServerManager;

  constructor(serverManager: ServerManager) {
    this.serverManager = serverManager;
  }

  metadata = {
    name: 'ssh:execute',
    description: '在远程服务器上执行 shell 命令',
    category: 'ssh',
    version: '1.0.0',
    tags: ['ssh', 'remote', 'shell'],
    examples: [
      'ssh:execute { connectionId: "conn-123", command: "ls -la" }',
    ],
  };

  inputSchema = SSHExecuteInputSchema;

  security = {
    riskLevel: RiskLevel.MEDIUM,  // 默认中风险，具体风险由 SecurityAnalyzer 判断
    requiresConfirmation: true,
    allowedInModes: ['manual', 'ai'],
  };

  concurrentSafe = false;  // SSH 命令执行不并发

  async execute(input: SSHExecuteInput, context: ToolUseContext): Promise<SSHExecuteOutput> {
    const result = await this.serverManager.execute(input.connectionId, input.command);

    return {
      success: result.success,
      data: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      error: result.error,
    };
  }

  /**
   * 上下文修改器：自动记录命令历史
   */
  contextModifier = (output: SSHExecuteOutput): Partial<SessionContext> => {
    return {
      lastExitCode: output.exitCode ?? 1,
      // 命令历史由外部管理器处理
    };
  };

  /**
   * 执行后钩子：自动添加命令到历史
   */
  async postExecute(
    input: SSHExecuteInput,
    output: SSHExecuteOutput,
    context: ToolUseContext
  ): Promise<void> {
    const historyEntry: CommandHistory = {
      command: input.command,
      output: (output.stdout || output.stderr || '').substring(0, 1000),
      exitCode: output.exitCode ?? 1,
      timestamp: new Date().toISOString(),
      directory: context.sessionContext.currentDirectory,
    };
    
    context.log('info', `命令执行完成: ${input.command}`, { exitCode: output.exitCode });
  }

  /**
   * 可用性检查：需要已建立 SSH 连接
   */
  isAvailable = (context: ToolUseContext): boolean => {
    return context.connectionId !== undefined;
  };
}
```

### AI 命令生成工具

```typescript
// src/main/tools/implementations/AIGenerateTool.ts

import { Tool, ToolOutput, ContextModifier } from '../Tool';
import { z } from 'zod';
import { RiskLevel } from '../../types/security';
import { AIEngine } from '../../services/AIEngine';

const AIGenerateInputSchema = z.object({
  prompt: z.string().min(1).describe('用户的自然语言描述'),
  context: z.object({
    os: z.enum(['linux', 'windows']),
    currentDirectory: z.string().optional(),
    hostname: z.string().optional(),
    taskGoal: z.string().optional(),
  }).optional(),
});

interface AIGenerateInput {
  prompt: string;
  context?: {
    os: 'linux' | 'windows';
    currentDirectory?: string;
    hostname?: string;
    taskGoal?: string;
  };
}

interface AIGenerateOutput extends ToolOutput {
  command?: string;
  explanation?: string;
}

export class AIGenerateTool implements Tool<AIGenerateInput, AIGenerateOutput> {
  private aiEngine: AIEngine;

  constructor(aiEngine: AIEngine) {
    this.aiEngine = aiEngine;
  }

  metadata = {
    name: 'ai:generate',
    description: '使用 AI 根据自然语言描述生成 shell 命令',
    category: 'ai',
    version: '1.0.0',
    tags: ['ai', 'generate', 'command'],
    examples: [
      'ai:generate { prompt: "查看系统内存使用情况" }',
    ],
  };

  inputSchema = AIGenerateInputSchema;

  security = {
    riskLevel: RiskLevel.SAFE,  // AI 生成本身是安全的
    allowedInModes: ['ai'],
  };

  concurrentSafe = true;

  async execute(input: AIGenerateInput, context: ToolUseContext): Promise<AIGenerateOutput> {
    const aiContext = {
      os: context.os,
      currentDirectory: input.context?.currentDirectory || context.sessionContext.currentDirectory,
      hostname: input.context?.hostname || context.sessionContext.hostname,
      taskGoal: input.context?.taskGoal || context.sessionContext.taskGoal,
    };

    const result = await this.aiEngine.generateCommand(
      input.prompt,
      aiContext,
      context.aiConfig
    );

    return {
      success: true,
      data: {
        command: result.command,
        explanation: result.explanation,
      },
    };
  }

  /**
   * 上下文修改器：更新任务目标
   */
  contextModifier = (output: AIGenerateOutput): Partial<SessionContext> => {
    // 不直接修改，返回空对象
    // 任务目标的更新由前端处理
    return {};
  };
}
```

### 文件读取工具

```typescript
// src/main/tools/implementations/FileReadTool.ts

import { Tool, ToolOutput } from '../Tool';
import { z } from 'zod';
import { RiskLevel } from '../../types/security';

const FileReadInputSchema = z.object({
  connectionId: z.string().describe('SSH 连接 ID'),
  path: z.string().min(1).describe('文件路径'),
  encoding: z.enum(['utf-8', 'binary']).optional().default('utf-8'),
  maxSize: z.number().optional().default(1048576),  // 默认 1MB
});

interface FileReadInput {
  connectionId: string;
  path: string;
  encoding?: 'utf-8' | 'binary';
  maxSize?: number;
}

interface FileReadOutput extends ToolOutput {
  content?: string;
  size?: number;
  lines?: number;
}

export class FileReadTool implements Tool<FileReadInput, FileReadOutput> {
  metadata = {
    name: 'file:read',
    description: '读取远程服务器上的文件内容',
    category: 'file',
    version: '1.0.0',
    tags: ['file', 'read', 'remote'],
    examples: [
      'file:read { connectionId: "conn-123", path: "/etc/hosts" }',
    ],
  };

  inputSchema = FileReadInputSchema;

  security = {
    riskLevel: RiskLevel.SAFE,  // 只读操作
    allowedInModes: ['manual', 'ai'],
  };

  concurrentSafe = true;

  async execute(input: FileReadInput, context: ToolUseContext): Promise<FileReadOutput> {
    // 使用 cat 命令读取文件
    const catCommand = input.encoding === 'binary'
      ? `base64 ${input.path}`
      : `cat ${input.path}`;

    const result = await context.serverManager.execute(input.connectionId, catCommand);

    if (!result.success) {
      return {
        success: false,
        error: result.error || '文件读取失败',
      };
    }

    const content = result.stdout || '';
    const size = content.length;

    if (size > (input.maxSize || 1048576)) {
      return {
        success: false,
        error: `文件过大 (${size} bytes)，超过限制`,
        data: { size },
      };
    }

    return {
      success: true,
      data: {
        content,
        size,
        lines: content.split('\n').length,
      },
    };
  }

  isAvailable = (context: ToolUseContext): boolean => {
    return context.connectionId !== undefined;
  };
}
```

## 六、生命周期钩子

```typescript
// src/main/tools/hooks/ToolHooks.ts

import { ToolUseContext } from '../../types/tool-context';
import { ToolInput, ToolOutput } from '../Tool';

/** 钩子类型 */
export type HookType = 'preExecute' | 'postExecute' | 'onError' | 'onProgress';

/** 钼子函数 */
export type HookFunction = (
  type: HookType,
  toolName: string,
  input: ToolInput,
  output?: ToolOutput,
  context: ToolUseContext,
  error?: Error
) => Promise<void>;

/** 钼子管理器 */
export class HookManager {
  private hooks: Map<HookType, HookFunction[]> = new Map();

  /**
   * 注册钩子
   */
  register(type: HookType, hook: HookFunction): void {
    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }
    this.hooks.get(type)!.push(hook);
  }

  /**
   * 执行所有钩子
   */
  async execute(
    type: HookType,
    toolName: string,
    input: ToolInput,
    output?: ToolOutput,
    context?: ToolUseContext,
    error?: Error
  ): Promise<void> {
    const hooks = this.hooks.get(type) || [];
    
    for (const hook of hooks) {
      try {
        await hook(type, toolName, input, output, context!, error);
      } catch (e) {
        console.error(`钩子执行失败 (${type}):`, e);
      }
    }
  }

  /**
   * 清除钩子
   */
  clear(type?: HookType): void {
    if (type) {
      this.hooks.delete(type);
    } else {
      this.hooks.clear();
    }
  }
}

/** 预定义钩子示例 */

/** 日志钩子 */
export const loggingHook: HookFunction = async (type, toolName, input, output, context) => {
  context.log('info', `[${type}] ${toolName}`, { input, output });
};

/** 性能追踪钩子 */
export const performanceHook: HookFunction = async (type, toolName, input, output, context) => {
  if (type === 'postExecute' && output) {
    const duration = (output as any).durationMs;
    if (duration > 5000) {
      context.log('warn', `工具执行耗时过长: ${toolName} (${duration}ms)`);
    }
  }
};

/** 权限审计钩子 */
export const auditHook: HookFunction = async (type, toolName, input, output, context, error) => {
  if (type === 'postExecute') {
    // 记录审计日志
    context.log('info', `AUDIT: ${context.userId || 'unknown'} executed ${toolName}`, {
      input,
      success: output?.success,
      error: error?.message,
    });
  }
};
```

## 七、初始化与集成

```typescript
// src/main/tools/index.ts

import { ToolRegistry } from './ToolRegistry';
import { ToolExecutor } from './ToolExecutor';
import { SecurityAnalyzer } from './SecurityAnalyzer';
import { HookManager, loggingHook, performanceHook, auditHook } from './hooks/ToolHooks';

// 工具实现
import { SSHExecuteTool } from './implementations/SSHExecuteTool';
import { SSHConnectTool } from './implementations/SSHConnectTool';
import { AIGenerateTool } from './implementations/AIGenerateTool';
import { AIAnalyzeTool } from './implementations/AIAnalyzeTool';
import { FileReadTool } from './implementations/FileReadTool';
import { DirectoryListTool } from './implementations/DirectoryListTool';
import { ProcessListTool } from './implementations/ProcessListTool';

import { ServerManager } from '../services/ServerManager';
import { AIEngine } from '../services/AIEngine';

/** 初始化工具系统 */
export function initializeToolSystem(
  serverManager: ServerManager,
  aiEngine: AIEngine
): {
  registry: ToolRegistry;
  executor: ToolExecutor;
  securityAnalyzer: SecurityAnalyzer;
  hookManager: HookManager;
} {
  // 1. 创建注册池
  const registry = new ToolRegistry();

  // 2. 注册工具
  registry.register(new SSHExecuteTool(serverManager));
  registry.register(new SSHConnectTool(serverManager));
  registry.register(new AIGenerateTool(aiEngine));
  registry.register(new AIAnalyzeTool(aiEngine));
  registry.register(new FileReadTool());
  registry.register(new DirectoryListTool());
  registry.register(new ProcessListTool());

  // 3. 创建安全分析器
  const securityAnalyzer = new SecurityAnalyzer();

  // 4. 创建执行器
  const executor = new ToolExecutor(registry, securityAnalyzer);

  // 5. 创建钩子管理器
  const hookManager = new HookManager();
  hookManager.register('preExecute', loggingHook);
  hookManager.register('postExecute', loggingHook);
  hookManager.register('postExecute', performanceHook);
  hookManager.register('postExecute', auditHook);

  return { registry, executor, securityAnalyzer, hookManager };
}
```

```typescript
// src/main/index.ts（重构部分）

import { initializeToolSystem } from './tools';
import { ToolExecutionRequest } from './tools/ToolExecutor';

let toolSystem: ReturnType<typeof initializeToolSystem>;

app.whenReady().then(() => {
  // ... 现有初始化 ...
  
  // 初始化工具系统
  toolSystem = initializeToolSystem(serverManager, aiEngine);

  createWindow();
  setupIpcHandlers();
});

function setupIpcHandlers() {
  // ===== 工具系统 API =====
  
  // 获取可用工具列表
  ipcMain.handle('tool:list', (_event, context?: Partial<ToolUseContext>) => {
    return toolSystem.registry.getAvailableTools(context as ToolUseContext)
      .map(t => ({
        name: t.metadata.name,
        description: t.metadata.description,
        category: t.metadata.category,
        riskLevel: t.security.riskLevel,
      }));
  });

  // 执行工具
  ipcMain.handle('tool:execute', async (_event, request: ToolExecutionRequest) => {
    return toolSystem.executor.execute(request);
  });

  // 确认后执行
  ipcMain.handle('tool:executeConfirmed', async (
    _event,
    request: ToolExecutionRequest,
    confirmed: boolean
  ) => {
    return toolSystem.executor.executeWithConfirmation(request, confirmed);
  });

  // 获取工具描述（用于 AI prompt）
  ipcMain.handle('tool:descriptions', (_event, context?: Partial<ToolUseContext>) => {
    return toolSystem.registry.getToolDescriptionsForAI(context as ToolUseContext);
  });

  // 安全分析
  ipcMain.handle('tool:analyze', (_event, command: string) => {
    return toolSystem.securityAnalyzer.analyze(command);
  });

  // ... 现有 handlers 保留兼容 ...
}
```

## 八、前端适配

```typescript
// src/renderer/hooks/useToolExecution.ts

import { useState, useCallback } from 'react';

interface ToolExecutionState {
  executing: boolean;
  result?: ToolExecutionResult;
  securityWarning?: SecurityAnalysisResult;
}

export function useToolExecution(serverId: number) {
  const [state, setState] = useState<ToolExecutionState>({ executing: false });

  const execute = useCallback(async (
    toolName: string,
    input: any,
    context: Partial<ToolUseContext>
  ) => {
    setState({ executing: true });

    const request: ToolExecutionRequest = {
      toolName,
      input,
      context: {
        ...context,
        serverId,
        sessionId: `session-${Date.now()}`,
      },
    };

    const result = await window.electronAPI.toolExecute(request);

    if (result.securityAnalysis?.requiresConfirmation) {
      setState({
        executing: false,
        securityWarning: result.securityAnalysis,
        result,
      });
      return result;
    }

    setState({ executing: false, result });
    return result;
  }, [serverId]);

  const confirmAndExecute = useCallback(async (
    toolName: string,
    input: any,
    context: Partial<ToolUseContext>,
    confirmed: boolean
  ) => {
    setState({ executing: true });

    const request: ToolExecutionRequest = {
      toolName,
      input,
      context: {
        ...context,
        serverId,
        sessionId: `session-${Date.now()}`,
      },
      userConfirmed: confirmed,
    };

    const result = await window.electronAPI.toolExecuteConfirmed(request, confirmed);
    setState({ executing: false, result, securityWarning: undefined });
    return result;
  }, [serverId]);

  return {
    ...state,
    execute,
    confirmAndExecute,
  };
}
```

## 九、实施步骤

1. **Day 1**：
   - 创建 `Tool.ts` 核心接口
   - 创建 `ToolRegistry.ts` 注册池
   - 创建 `ToolExecutor.ts` 执行器

2. **Day 2**：
   - 创建 `SSHExecuteTool.ts`
   - 创建 `SSHConnectTool.ts`
   - 创建 `AIGenerateTool.ts`
   - 创建 `AIAnalyzeTool.ts`

3. **Day 3**：
   - 创建 `FileReadTool.ts`
   - 创建 `DirectoryListTool.ts`
   - 创建 `ProcessListTool.ts`
   - 创建钩子系统

4. **Day 4**：
   - 集成到 `index.ts`
   - 更新 preload API
   - 更新 vite-env.d.ts
   - 兼容旧 API（保留过渡期）

5. **Day 5**：
   - 创建前端 `useToolExecution` Hook
   - 测试完整流程
   - 文档补充

---

下一步：实施 P2 分层上下文压缩，见 `context-compression-design.md`