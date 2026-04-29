import { Agent, AgentConfig, SubTask, AgentExecutionResult, DecompositionResult, TokenUsage } from './Agent';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolUseContext } from '../types/tool-context';
import { TaskDecomposer } from './TaskDecomposer';
import { AIEngine, AIContext } from '../ai-engine';
import { AIConfig } from '../database';

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
  private aiEngine: AIEngine;  // 修复：保存 aiEngine
  private config: CoordinatorConfig;

  // 用于存储被挂起的任务确认 Promise 的 resolve 函数
  private confirmationResolvers = new Map<string, (result: boolean) => void>();

  constructor(
    toolExecutor: ToolExecutor,
    toolRegistry: ToolRegistry,
    aiEngine: AIEngine,
    config?: Partial<CoordinatorConfig>
  ) {
    this.toolExecutor = toolExecutor;
    this.toolRegistry = toolRegistry;
    this.aiEngine = aiEngine;  // 修复：保存引用
    this.taskDecomposer = new TaskDecomposer(aiEngine);

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
   * 获取 Agent
   */
  getAgent(name: string): Agent | null {
    return this.agents.get(name)?.agent || null;
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
   * 生成任务分解计划
   * 
   * @param prompt   用户输入
   * @param context  工具上下文
   * @param aiConfig AI API 配置（从 DB 加载，由 IPC handler 传入）
   */
  async decomposeTask(
    prompt: string,
    context: ToolUseContext,
    aiConfig: AIConfig
  ): Promise<DecompositionResult> {
    const agent = this.selectAgent(prompt, context);
    if (!agent) {
      return { success: false, subTasks: [], reasoning: '没有找到合适的 Agent 处理此任务' };
    }

    if (agent.decompose) {
      const result = await agent.decompose(prompt, context);
      result.suggestedAgent = agent.config.name;
      return result;
    } else {
      const { subTasks, reasoning, tokenUsage } = await this.taskDecomposer.decompose(prompt, context, agent.config, aiConfig);
      return { success: true, subTasks, reasoning, suggestedAgent: agent.config.name, tokenUsage };
    }
  }

  /**
   * 执行已知任务计划
   *
   * @param agentName  目标 Agent 名称
   * @param subTasks   子任务列表
   * @param context    执行上下文
   * @param aiConfig   AI 配置（用于执行后分析）
   * @param userPrompt 用户原始提问（用于分析时对照目标）
   * @param onProgress 进度回调
   */
  async executeTask(
    agentName: string,
    subTasks: SubTask[],
    context: ToolUseContext,
    aiConfig: AIConfig,
    userPrompt: string,
    onProgress?: (subTasks: SubTask[]) => void
  ): Promise<AgentExecutionResult> {
    const agent = this.getAgent(agentName);
    if (!agent) {
      return {
        agentName,
        success: false,
        subTasks,
        errors: [`Agent ${agentName} 不存在`],
        durationMs: 0
      };
    }

    // 累计 Token 消耗
    let totalTokenUsage: TokenUsage | undefined;

    // 准备挂起和确认的通信通道
    const requestConfirmation = (task: SubTask): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const key = `${context.sessionId}:${task.id}`;
        this.confirmationResolvers.set(key, resolve);
      });
    };

    // 阶段一：执行
    const result = await agent.execute(subTasks, context, onProgress, requestConfirmation);

    // 阶段二：分析（提取出已完成执行的子任务，包括成功和执行过但报错的）
    const completedTasks = result.subTasks.filter(t => (t.status === 'completed' || t.status === 'failed') && t.result);
    if (completedTasks.length > 0) {
      try {
        // 收集所有子任务的输出
        const combinedOutput = completedTasks
          .map(t => {
            const output = t.result?.stdout || t.result?.stderr || '';
            return `[${t.description}]\n${output}`;
          })
          .join('\n\n');

        // 收集执行过的命令
        const combinedCommand = completedTasks
          .map(t => (t.toolInput as any)?.command || t.description)
          .join(' && ');

        const aiContext = {
          os: context.os || 'linux',
          currentDirectory: context.sessionContext?.currentDirectory,
          hostname: context.sessionContext?.hostname,
        };

        const analysis = await this.aiEngine.analyzeResult(
          userPrompt,
          combinedCommand,
          combinedOutput,
          completedTasks.every(t => t.result?.exitCode === 0) ? 0 : 1,
          aiContext,
          aiConfig
        );

        // 累计分析阶段的 Token 消耗
        if (analysis.tokenUsage) {
          totalTokenUsage = {
            promptTokens: analysis.tokenUsage.promptTokens,
            completionTokens: analysis.tokenUsage.completionTokens
          };
        }

        result.analysis = {
          summary: analysis.analysis,
          suggestions: analysis.suggestions,
          nextCommand: analysis.nextCommand,
          nextCommandReason: analysis.nextCommandReason,
        };
        result.overallOutput = analysis.analysis;
      } catch (e: any) {
        // 分析失败不影响执行结果
        console.error('Agent 执行后分析失败:', e.message);
      }
    }

    // 将累计的 Token 消耗附加到结果中
    result.tokenUsage = totalTokenUsage;

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
   * 解决前端传回的任务确认结果，恢复挂起的 Agent 协程
   */
  resolveConfirmation(tabId: string, taskId: string, isConfirmed: boolean): boolean {
    const key = `${tabId}:${taskId}`;
    const resolve = this.confirmationResolvers.get(key);
    if (resolve) {
      resolve(isConfirmed);
      this.confirmationResolvers.delete(key);
      return true;
    }
    return false;
  }
}
