# P2：Agent 协作模式设计

> 优先级：中（复杂任务分解）
> 预计工作量：3 天
> 前置依赖：P1 工具系统

## 一、设计目标

将复杂运维任务自动分解为多个子任务，由专门的 Agent 执行：
- **任务分解**：AI 根据用户意图自动分解任务
- **Agent 定义**：声明式配置 + 工具白名单
- **协调执行**：AgentCoordinator 协调多 Agent 并行/串行执行
- **状态传递**：子任务结果传递给后续任务
- **权限隔离**：每个 Agent 只能使用白名单内的工具

## 二、核心类型定义

```typescript
// src/main/agents/Agent.ts

import { z, ZodSchema } from 'zod';
import { Tool } from '../tools/Tool';
import { ToolUseContext } from '../types/tool-context';

/** Agent 优先级覆盖链 */
export type AgentPriority = 'built-in' | 'plugin' | 'user' | 'project' | 'flag' | 'managed';

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

/** Agent 触发条件 */
export interface AgentCondition {
  type: 'keyword' | 'pattern' | 'category' | 'custom';
  value: string | RegExp | ((prompt: string) => boolean);
  description?: string;
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: any;
  error?: string;
}

/** 任务分解结果 */
export interface DecompositionResult {
  success: boolean;
  subTasks: SubTask[];
  reasoning: string;           // 分解推理过程
  suggestedAgent?: string;     // 建议使用的 Agent
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
   */
  execute(subTasks: SubTask[], context: ToolUseContext): Promise<AgentExecutionResult>;
  
  /**
   * 生成总结报告
   */
  summarize?(results: SubTask[], context: ToolUseContext): Promise<string>;
}
```

## 三、Agent 协调器

```typescript
// src/main/agents/AgentCoordinator.ts

import { Agent, AgentConfig, SubTask, AgentExecutionResult } from './Agent';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolUseContext } from '../types/tool-context';
import { TaskDecomposer } from './TaskDecomposer';

/** Agent 注册项 */
interface AgentRegistryEntry {
  agent: Agent;
  enabled: boolean;
}

/** 协调器配置 */
export interface CoordinatorConfig {
  defaultAgent: string;          // 默认 Agent
  maxTotalConcurrency: number;   // 全局最大并发
  enableFallback: boolean;       // 允许回退到默认 Agent
}

/** Agent 协调器 */
export class AgentCoordinator {
  private agents: Map<string, AgentRegistryEntry> = new Map();
  private toolExecutor: ToolExecutor;
  private toolRegistry: ToolRegistry;
  private taskDecomposer: TaskDecomposer;
  private config: CoordinatorConfig;

  constructor(
    toolExecutor: ToolExecutor,
    toolRegistry: ToolRegistry,
    config?: Partial<CoordinatorConfig>
  ) {
    this.toolExecutor = toolExecutor;
    this.toolRegistry = toolRegistry;
    this.taskDecomposer = new TaskDecomposer();
    
    this.config = {
      defaultAgent: 'general',
      maxTotalConcurrency: 5,
      enableFallback: true,
      ...config,
    };
  }

  /**
   * 注册 Agent
   */
  register(agent: Agent): void {
    const name = agent.config.name;
    if (this.agents.has(name)) {
      console.warn(`Agent ${name} 已存在，将被覆盖`);
    }
    this.agents.set(name, { agent, enabled: true });
  }

  /**
   * 选择合适的 Agent
   */
  selectAgent(prompt: string, context: ToolUseContext): Agent | null {
    // 按优先级排序
    const sortedAgents = Array.from(this.agents.values())
      .filter(entry => entry.enabled)
      .sort((a, b) => {
        const priorities = ['managed', 'flag', 'project', 'user', 'plugin', 'built-in'];
        return priorities.indexOf(b.agent.config.priority) - priorities.indexOf(a.agent.config.priority);
      });

    // 找到匹配的 Agent
    for (const entry of sortedAgents) {
      if (entry.agent.shouldHandle(prompt, context)) {
        return entry.agent;
      }
    }

    // 回退到默认 Agent
    if (this.config.enableFallback) {
      return this.agents.get(this.config.defaultAgent)?.agent || null;
    }

    return null;
  }

  /**
   * 执行任务流程
   */
  async runTask(
    prompt: string,
    context: ToolUseContext
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    // 1. 选择 Agent
    const agent = this.selectAgent(prompt, context);
    if (!agent) {
      return {
        agentName: 'none',
        success: false,
        subTasks: [],
        errors: ['没有找到合适的 Agent 处理此任务'],
        durationMs: Date.now() - startTime,
      };
    }

    // 2. 分解任务（如果 Agent 支持）
    let subTasks: SubTask[] = [];
    if (agent.decompose) {
      const decomposition = await agent.decompose(prompt, context);
      if (decomposition.success) {
        subTasks = decomposition.subTasks;
      }
    } else {
      // 使用通用分解器
      subTasks = this.taskDecomposer.decompose(prompt, context, agent.config);
    }

    // 3. 执行子任务
    const result = await agent.execute(subTasks, context);

    // 4. 生成总结（如果 Agent 支持）
    if (agent.summarize && result.success) {
      result.overallOutput = await agent.summarize(result.subTasks, context);
    }

    result.durationMs = Date.now() - startTime;
    return result;
  }

  /**
   * 获取可用 Agent 列表
   */
  getAvailableAgents(): AgentConfig[] {
    return Array.from(this.agents.values())
      .filter(entry => entry.enabled)
      .map(entry => entry.agent.config);
  }

  /**
   * 启用/禁用 Agent
   */
  setEnabled(name: string, enabled: boolean): void {
    const entry = this.agents.get(name);
    if (entry) {
      entry.enabled = enabled;
    }
  }

  /**
   * 获取 Agent 可用工具
   */
  getAgentTools(agentName: string): Tool[] {
    const entry = this.agents.get(agentName);
    if (!entry) return [];

    const { allowedTools, deniedTools = [] } = entry.agent.config;
    
    return allowedTools
      .filter(name => !deniedTools.includes(name))
      .map(name => this.toolRegistry.getTool(name))
      .filter((tool): tool is Tool => tool !== null);
  }
}
```

## 四、任务分解器

```typescript
// src/main/agents/TaskDecomposer.ts

import { SubTask, AgentConfig, DecompositionResult } from './Agent';
import { ToolUseContext } from '../types/tool-context';
import { AIEngine } from '../services/AIEngine';
import { v4 as uuidv4 } from 'uuid';

/** 任务分解器 */
export class TaskDecomposer {
  private aiEngine: AIEngine;

  constructor(aiEngine?: AIEngine) {
    this.aiEngine = aiEngine || new AIEngine();
  }

  /**
   * 分解用户任务
   */
  async decompose(
    prompt: string,
    context: ToolUseContext,
    agentConfig: AgentConfig
  ): Promise<SubTask[]> {
    // 如果是简单任务，不需要分解
    if (this.isSimpleTask(prompt)) {
      return [{
        id: uuidv4(),
        description: prompt,
        status: 'pending',
      }];
    }

    // 使用 AI 分解复杂任务
    try {
      const decomposition = await this.aiDecompose(prompt, context, agentConfig);
      return decomposition.subTasks;
    } catch (error) {
      console.error('任务分解失败:', error);
      return [{
        id: uuidv4(),
        description: prompt,
        status: 'pending',
      }];
    }
  }

  /**
   * 使用 AI 分解任务
   */
  private async aiDecompose(
    prompt: string,
    context: ToolUseContext,
    agentConfig: AgentConfig
  ): Promise<DecompositionResult> {
    const systemPrompt = `你是一个运维任务分解专家。根据用户的描述，将任务分解为具体的执行步骤。

可用的工具：
${agentConfig.allowedTools.map(t => `- ${t}`).join('\n')}

分解规则：
1. 每个步骤应该是一个独立的可执行命令或操作
2. 明确标注步骤之间的依赖关系
3. 如果有依赖，确保依赖步骤先执行
4. 最多分解为 ${agentConfig.maxDepth || 5} 个步骤

返回 JSON 格式：
{
  "subTasks": [
    {
      "description": "步骤描述",
      "toolName": "建议使用的工具",
      "dependencies": ["依赖的步骤ID（可选）"],
      "expectedOutput": "期望输出描述"
    }
  ],
  "reasoning": "分解推理过程"
}`;

    const response = await this.aiEngine.generateCommand(
      `分解任务：${prompt}`,
      { os: context.os },
      context.aiConfig
    );

    // 解析 AI 返回的分解结果
    try {
      const parsed = JSON.parse(response.command);
      return {
        success: true,
        subTasks: parsed.subTasks.map((st: any) => ({
          id: uuidv4(),
          description: st.description,
          toolName: st.toolName,
          dependencies: st.dependencies || [],
          expectedOutput: st.expectedOutput,
          status: 'pending',
        })),
        reasoning: parsed.reasoning,
      };
    } catch {
      return {
        success: false,
        subTasks: [],
        reasoning: 'AI 返回格式解析失败',
      };
    }
  }

  /**
   * 判断是否为简单任务
   */
  private isSimpleTask(prompt: string): boolean {
    const simpleKeywords = [
      '查看', '列出', '显示', '检查', '获取',
      'ls', 'pwd', 'cat', 'head', 'tail', 'grep',
    ];

    return simpleKeywords.some(kw => prompt.includes(kw)) && !prompt.includes('并且') && !prompt.includes('然后');
  }

  /**
   * 构建执行顺序（拓扑排序）
   */
  buildExecutionOrder(subTasks: SubTask[]): SubTask[] {
    // 构建依赖图
    const taskMap = new Map<string, SubTask>();
    const dependencyGraph = new Map<string, Set<string>>();

    for (const task of subTasks) {
      taskMap.set(task.id, task);
      dependencyGraph.set(task.id, new Set(task.dependencies || []));
    }

    // 拓扑排序（Kahn 算法）
    const result: SubTask[] = [];
    const visited = new Set<string>();
    const queue: string[] = [];

    // 找出无依赖的任务
    for (const [id, deps] of dependencyGraph) {
      if (deps.size === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentTask = taskMap.get(currentId)!;
      
      result.push(currentTask);
      visited.add(currentId);

      // 移除当前任务的依赖关系
      for (const [id, deps] of dependencyGraph) {
        if (deps.has(currentId)) {
          deps.delete(currentId);
          if (deps.size === 0 && !visited.has(id)) {
            queue.push(id);
          }
        }
      }
    }

    // 检查是否有环
    if (result.length !== subTasks.length) {
      console.warn('任务依赖图存在循环，使用原始顺序');
      return subTasks;
    }

    return result;
  }
}
```

## 五、具体 Agent 实现

### 通用运维 Agent

```typescript
// src/main/agents/implementations/GeneralAgent.ts

import { Agent, AgentConfig, SubTask, AgentExecutionResult } from '../Agent';
import { ToolUseContext } from '../../types/tool-context';
import { ToolExecutor } from '../../tools/ToolExecutor';

const GENERAL_AGENT_CONFIG: AgentConfig = {
  name: 'general',
  displayName: '通用运维助手',
  description: '处理一般运维任务，支持大部分工具',
  priority: 'built-in',
  
  allowedTools: [
    'ssh:execute',
    'ssh:connect',
    'ssh:disconnect',
    'file:read',
    'file:list',
    'process:list',
    'ai:generate',
    'ai:analyze',
  ],
  
  executionMode: 'adaptive',
  maxConcurrency: 3,
  canDecompose: true,
  maxDepth: 5,
  
  systemPrompt: `你是一个专业的服务器运维助手。帮助用户完成各种运维任务。`,
};

export class GeneralAgent implements Agent {
  config = GENERAL_AGENT_CONFIG;
  private toolExecutor: ToolExecutor;

  constructor(toolExecutor: ToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  shouldHandle(prompt: string, context: ToolUseContext): boolean {
    // 通用 Agent 总是可以处理
    return true;
  }

  async execute(
    subTasks: SubTask[],
    context: ToolUseContext
  ): Promise<AgentExecutionResult> {
    const results: SubTask[] = [];
    const errors: string[] = [];

    // 按执行模式处理
    if (this.config.executionMode === 'parallel') {
      // 并行执行所有任务
      const promises = subTasks.map(task => this.executeSubTask(task, context));
      const outcomes = await Promise.all(promises);
      results.push(...outcomes.map((o, i) => ({ ...subTasks[i], ...o })));
    } else if (this.config.executionMode === 'sequential') {
      // 串行执行
      for (const task of subTasks) {
        const outcome = await this.executeSubTask(task, context);
        results.push({ ...task, ...outcome });
        if (!outcome.success && task.dependencies?.length > 0) {
          // 如果失败且有依赖任务，跳过后续
          break;
        }
      }
    } else {
      // 自适应：无依赖的并行，有依赖的串行
      const independentTasks = subTasks.filter(t => !t.dependencies?.length);
      const dependentTasks = subTasks.filter(t => t.dependencies?.length);

      // 先并行执行无依赖任务
      if (independentTasks.length > 0) {
        const promises = independentTasks.map(t => this.executeSubTask(t, context));
        const outcomes = await Promise.all(promises);
        results.push(...outcomes.map((o, i) => ({ ...independentTasks[i], ...o })));
      }

      // 再串行执行有依赖任务
      for (const task of dependentTasks) {
        const outcome = await this.executeSubTask(task, context);
        results.push({ ...task, ...outcome });
      }
    }

    const success = results.every(r => r.status === 'completed');
    return {
      agentName: this.config.name,
      success,
      subTasks: results,
      errors,
      durationMs: 0,
    };
  }

  private async executeSubTask(
    task: SubTask,
    context: ToolUseContext
  ): Promise<{ status: SubTask['status']; result?: any; error?: string; success: boolean }> {
    if (!task.toolName) {
      return { status: 'skipped', success: false, error: '未指定工具' };
    }

    try {
      const request = {
        toolName: task.toolName,
        input: task.toolInput || {},
        context,
      };

      const result = await this.toolExecutor.execute(request);

      return {
        status: result.success ? 'completed' : 'failed',
        result: result.data,
        error: result.error,
        success: result.success,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        error: error.message,
        success: false,
      };
    }
  }
}
```

### 部署检查 Agent

```typescript
// src/main/agents/implementations/DeploymentCheckAgent.ts

import { Agent, AgentConfig, SubTask, AgentExecutionResult, DecompositionResult } from '../Agent';
import { ToolUseContext } from '../../types/tool-context';
import { ToolExecutor } from '../../tools/ToolExecutor';

const DEPLOYMENT_CHECK_CONFIG: AgentConfig = {
  name: 'deployment-check',
  displayName: '部署检查专家',
  description: '检查服务部署状态，包括进程、端口、日志、配置等',
  priority: 'built-in',
  
  allowedTools: [
    'ssh:execute',
    'file:read',
    'process:list',
  ],
  
  executionMode: 'parallel',
  maxConcurrency: 4,
  canDecompose: true,
  maxDepth: 10,
  
  conditions: [
    { type: 'keyword', value: '部署', description: '包含部署关键词' },
    { type: 'keyword', value: '服务状态', description: '包含服务状态关键词' },
    { type: 'keyword', value: '检查', description: '包含检查关键词' },
    { type: 'pattern', value: /(部署|服务|进程|端口|日志).*检查/, description: '匹配检查模式' },
  ],
  
  systemPrompt: `你是一个部署检查专家。根据用户描述的服务，系统性地检查部署状态。`,
};

export class DeploymentCheckAgent implements Agent {
  config = DEPLOYMENT_CHECK_CONFIG;
  private toolExecutor: ToolExecutor;

  constructor(toolExecutor: ToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  shouldHandle(prompt: string, context: ToolUseContext): boolean {
    return this.config.conditions?.some(cond => {
      if (cond.type === 'keyword') {
        return prompt.includes(cond.value as string);
      }
      if (cond.type === 'pattern') {
        return (cond.value as RegExp).test(prompt);
      }
      return false;
    }) || false;
  }

  /**
   * 预定义的任务分解模板
   */
  async decompose(prompt: string, context: ToolUseContext): Promise<DecompositionResult> {
    // 从 prompt 中提取服务名
    const serviceName = this.extractServiceName(prompt);

    const subTasks: SubTask[] = [
      {
        id: 'check-process',
        description: '检查服务进程是否运行',
        toolName: 'ssh:execute',
        toolInput: { command: `ps aux | grep ${serviceName} | grep -v grep` },
        expectedOutput: '进程列表',
        status: 'pending',
      },
      {
        id: 'check-port',
        description: '检查服务端口监听状态',
        toolName: 'ssh:execute',
        toolInput: { command: `netstat -tlnp | grep ${serviceName}` },
        expectedOutput: '端口监听信息',
        status: 'pending',
      },
      {
        id: 'check-config',
        description: '检查服务配置文件',
        toolName: 'file:read',
        toolInput: { path: `/etc/${serviceName}/${serviceName}.conf` },
        expectedOutput: '配置文件内容',
        status: 'pending',
      },
      {
        id: 'check-log',
        description: '检查最近的服务日志',
        toolName: 'ssh:execute',
        toolInput: { command: `tail -50 /var/log/${serviceName}/${serviceName}.log` },
        expectedOutput: '最近日志',
        status: 'pending',
      },
    ];

    return {
      success: true,
      subTasks,
      reasoning: `部署检查标准流程：进程→端口→配置→日志`,
      suggestedAgent: this.config.name,
    };
  }

  async execute(
    subTasks: SubTask[],
    context: ToolUseContext
  ): Promise<AgentExecutionResult> {
    // 并行执行所有检查
    const promises = subTasks.map(task => this.executeSubTask(task, context));
    const outcomes = await Promise.all(promises);
    const results = outcomes.map((o, i) => ({ ...subTasks[i], ...o }));

    const success = results.some(r => r.status === 'completed');
    return {
      agentName: this.config.name,
      success,
      subTasks: results,
      errors: outcomes.filter(o => o.error).map(o => o.error!),
      durationMs: 0,
    };
  }

  /**
   * 生成部署状态报告
   */
  async summarize(results: SubTask[], context: ToolUseContext): Promise<string> {
    const summaryParts: string[] = [];

    for (const result of results) {
      if (result.status === 'completed' && result.result) {
        summaryParts.push(`${result.description}: 成功`);
      } else if (result.status === 'failed') {
        summaryParts.push(`${result.description}: 失败 (${result.error})`);
      }
    }

    return `部署检查报告：\n${summaryParts.join('\n')}`;
  }

  private extractServiceName(prompt: string): string {
    const patterns = [
      /检查\s+(\w+)\s+(服务|部署)/,
      /(\w+)\s+(服务|部署)\s+状态/,
      /(\w+)\s+是否\s+(正常运行|启动)/,
    ];

    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'nginx';  // 默认服务
  }

  private async executeSubTask(
    task: SubTask,
    context: ToolUseContext
  ): Promise<{ status: SubTask['status']; result?: any; error?: string }> {
    if (!task.toolName) {
      return { status: 'skipped' };
    }

    try {
      const request = {
        toolName: task.toolName,
        input: {
          connectionId: context.connectionId,
          ...task.toolInput,
        },
        context,
      };

      const result = await this.toolExecutor.execute(request);

      return {
        status: result.success ? 'completed' : 'failed',
        result: result.data,
        error: result.error,
      };
    } catch (error: any) {
      return {
        status: 'failed',
        error: error.message,
      };
    }
  }
}
```

### 日志分析 Agent

```typescript
// src/main/agents/implementations/LogAnalysisAgent.ts

import { Agent, AgentConfig, SubTask, AgentExecutionResult } from '../Agent';
import { ToolUseContext } from '../../types/tool-context';

const LOG_ANALYSIS_CONFIG: AgentConfig = {
  name: 'log-analysis',
  displayName: '日志分析专家',
  description: '分析系统日志，识别错误、异常和关键信息',
  priority: 'built-in',
  
  allowedTools: [
    'ssh:execute',
    'file:read',
    'ai:analyze',
  ],
  
  executionMode: 'sequential',  // 日志分析需要先获取再分析
  canDecompose: true,
  
  conditions: [
    { type: 'keyword', value: '日志' },
    { type: 'keyword', value: '错误' },
    { type: 'keyword', value: '异常' },
    { type: 'keyword', value: '排查' },
  ],
  
  systemPrompt: `你是一个日志分析专家。帮助用户分析系统日志，找出问题和异常。`,
};

export class LogAnalysisAgent implements Agent {
  config = LOG_ANALYSIS_CONFIG;

  shouldHandle(prompt: string, context: ToolUseContext): boolean {
    return this.config.conditions?.some(cond => {
      if (cond.type === 'keyword') {
        return prompt.includes(cond.value as string);
      }
      return false;
    }) || false;
  }

  async execute(
    subTasks: SubTask[],
    context: ToolUseContext
  ): Promise<AgentExecutionResult> {
    // 先获取日志，再分析
    // ... 实现逻辑 ...
    return {
      agentName: this.config.name,
      success: true,
      subTasks,
      errors: [],
      durationMs: 0,
    };
  }
}
```

## 六、Agent Markdown 配置文件

```markdown
# src/main/agents/configs/deployment-check.md

---
name: deployment-check
displayName: 部署检查专家
description: 检查服务部署状态，包括进程、端口、日志、配置等
version: 1.0.0
priority: built-in
---

## 工具白名单

- ssh:execute
- file:read
- process:list

## 执行模式

- 模式：parallel
- 最大并发：4

## 触发条件

- 关键词：部署
- 关键词：服务状态
- 关键词：检查
- 正则：/(部署|服务|进程|端口|日志).*检查/

## 系统提示

你是一个部署检查专家。根据用户描述的服务，系统性地检查部署状态。

## 任务分解模板

当用户请求检查服务部署状态时，按以下步骤执行：

1. **检查进程**：`ps aux | grep {service}`
2. **检查端口**：`netstat -tlnp | grep {service}`
3. **检查配置**：读取 `/etc/{service}/{service}.conf`
4. **检查日志**：`tail -100 /var/log/{service}/{service}.log`

## 输出格式

生成部署检查报告，包含：
- 进程状态
- 端口监听状态
- 配置关键参数
- 最近错误日志
```

## 七、IPC Handlers

```typescript
// src/main/index.ts（新增部分）

import { AgentCoordinator } from './agents/AgentCoordinator';
import { initializeAgents } from './agents';

let agentCoordinator: AgentCoordinator;

function setupIpcHandlers() {
  // ===== Agent 系统 API =====
  
  // 获取可用 Agent 列表
  ipcMain.handle('agent:list', () => {
    return agentCoordinator.getAvailableAgents();
  });

  // 执行任务（Agent 自动选择）
  ipcMain.handle('agent:run', async (_event, prompt: string, context: ToolUseContext) => {
    return agentCoordinator.runTask(prompt, context);
  });

  // 使用指定 Agent 执行
  ipcMain.handle('agent:execute', async (
    _event,
    agentName: string,
    subTasks: SubTask[],
    context: ToolUseContext
  ) => {
    const agent = agentCoordinator.getAgent(agentName);
    if (!agent) {
      return { success: false, error: `Agent ${agentName} 不存在` };
    }
    return agent.execute(subTasks, context);
  });

  // 任务分解
  ipcMain.handle('agent:decompose', async (
    _event,
    prompt: string,
    agentName: string,
    context: ToolUseContext
  ) => {
    const agent = agentCoordinator.getAgent(agentName);
    if (!agent || !agent.decompose) {
      return { success: false, subTasks: [], reasoning: 'Agent 不支持任务分解' };
    }
    return agent.decompose(prompt, context);
  });
}
```

## 八、前端 Agent 任务显示

```tsx
// src/renderer/components/AgentTaskPanel.tsx

import React from 'react';
import { SubTask, AgentExecutionResult } from '../types/agent';

interface AgentTaskPanelProps {
  result: AgentExecutionResult;
}

const STATUS_COLORS = {
  pending: 'bg-gray-200 text-gray-600',
  running: 'bg-blue-100 text-blue-600',
  completed: 'bg-green-100 text-green-600',
  failed: 'bg-red-100 text-red-600',
  skipped: 'bg-yellow-100 text-yellow-600',
};

export const AgentTaskPanel: React.FC<AgentTaskPanelProps> = ({ result }) => {
  return (
    <div className="border border-gray-300 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-bold">{result.agentName}</span>
        <span className={`px-2 py-1 rounded text-sm ${
          result.success ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
        }`}>
          {result.success ? '成功' : '失败'}
        </span>
        <span className="text-sm text-gray-500">
          {result.durationMs}ms
        </span>
      </div>

      {/* 子任务列表 */}
      <div className="space-y-2">
        {result.subTasks.map(task => (
          <div key={task.id} className="flex items-start gap-3 p-2 bg-gray-50 rounded">
            <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[task.status]}`}>
              {task.status}
            </span>
            <div className="flex-1">
              <div className="font-medium">{task.description}</div>
              {task.toolName && (
                <div className="text-xs text-gray-500">工具: {task.toolName}</div>
              )}
              {task.error && (
                <div className="text-xs text-red-500 mt-1">{task.error}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 总结 */}
      {result.overallOutput && (
        <div className="mt-4 p-3 bg-blue-50 rounded">
          <div className="font-medium text-sm text-blue-700 mb-1">任务总结</div>
          <div className="text-sm text-blue-600">{result.overallOutput}</div>
        </div>
      )}

      {/* 错误列表 */}
      {result.errors.length > 0 && (
        <div className="mt-4 p-3 bg-red-50 rounded">
          <div className="font-medium text-sm text-red-700 mb-1">错误</div>
          {result.errors.map((err, i) => (
            <div key={i} className="text-sm text-red-600">{err}</div>
          ))}
        </div>
      )}
    </div>
  );
};
```

## 九、实施步骤

1. **Day 1**：
   - 创建 `Agent.ts` 核心接口
   - 创建 `AgentCoordinator.ts` 协调器
   - 创建 `TaskDecomposer.ts` 分解器

2. **Day 2**：
   - 创建 `GeneralAgent.ts`
   - 创建 `DeploymentCheckAgent.ts`
   - 创建 `LogAnalysisAgent.ts`
   - 测试 Agent 注册和选择

3. **Day 3**：
   - 添加 IPC handlers
   - 创建前端 `AgentTaskPanel.tsx`
   - 测试完整流程
   - 文档补充

---

下一步：实施 P3 会话恢复机制，见 `session-recovery-design.md`