import { SubTask, AgentConfig, DecompositionResult, TokenUsage } from './Agent';
import { ToolUseContext } from '../types/tool-context';
import { AIEngine, AIContext } from '../ai-engine';
import { AIConfig, SessionContext, TaskStep } from '../database';
import { randomUUID } from 'crypto';

/** 任务分解器 */
export class TaskDecomposer {
  private aiEngine: AIEngine;

  constructor(aiEngine: AIEngine) {
    this.aiEngine = aiEngine;
  }

  /**
   * 构建任务历史摘要
   * Claude Code 方案：直接使用 CompactEngine 生成的摘要（如果存在）
   * 如果没有压缩摘要，则智能提取关键信息
   */
  private buildTaskHistorySummary(sessionContext: SessionContext): string {
    // 优先使用已有的压缩摘要（CompactEngine 生成的，已保留关键路径）
    const taskHistory = sessionContext.taskHistory || [];
    const existingSummary = taskHistory.find(s =>
      s.action === 'analysis' && s.content.includes('摘要')
    );
    if (existingSummary) {
      return existingSummary.content;
    }

    // 否则，智能提取关键信息
    const parts: string[] = [];
    const keyFindings: string[] = [];

    // 提取关键发现（路径、重要信息）
    for (const step of taskHistory.slice(-10)) {
      if (step.action === 'intent') {
        parts.push(`用户意图: ${step.content}`);
      } else if (step.action === 'result') {
        const resultContent = step.result || step.content;

        // 提取路径信息（关键！）
        const pathMatches = resultContent.match(/\/[\w\-\.\/]+/g);
        if (pathMatches) {
          const uniquePaths = [...new Set(pathMatches)].filter(p =>
            p.length > 3 && !p.includes('/proc') && !p.includes('/sys') && !p.includes('/dev')
          );
          if (uniquePaths.length > 0) {
            keyFindings.push(`发现路径: ${uniquePaths.slice(0, 5).join(', ')}`);
          }
        }

        // 结果摘要（保留有意义的内容）
        const meaningfulLines = resultContent
          .split('\n')
          .filter(line => line.trim().length > 0 && line.trim().length < 200)
          .slice(0, 3);

        if (meaningfulLines.length > 0) {
          parts.push(`结果: ${meaningfulLines.join('; ')}`);
        }
      }
    }

    // 组装摘要
    const summaryParts: string[] = [];
    if (keyFindings.length > 0) {
      summaryParts.push(`【关键发现】 ${keyFindings.join('; ')}`);
    }
    if (parts.length > 0) {
      summaryParts.push(`【操作历史】 ${parts.slice(-5).join('; ')}`);
    }

    return summaryParts.join('\n');
  }

  /**
   * 分解用户任务
   *
   * @param prompt   用户自然语言输入
   * @param context  工具执行上下文
   * @param agentConfig Agent 配置（含 allowedTools 等）
   * @param aiConfig AI API 配置（从 DB 加载，由调用方传入）
   */
  async decompose(
    prompt: string,
    context: ToolUseContext,
    agentConfig: AgentConfig,
    aiConfig: AIConfig
  ): Promise<{ subTasks: SubTask[], reasoning: string, tokenUsage?: TokenUsage }> {
    // 构建完整的上下文信息，使用智能摘要
    const aiContext: AIContext = {
      os: context.os || 'linux',
      currentDirectory: context.sessionContext?.currentDirectory,
      hostname: context.sessionContext?.hostname,
      recentCommands: context.sessionContext?.recentCommands,
      taskGoal: context.sessionContext?.taskGoal,
      // 使用智能摘要（提取关键信息而非简单截取）
      taskHistorySummary: context.sessionContext ? this.buildTaskHistorySummary(context.sessionContext) : undefined,
    };

    const result = await this.aiEngine.decomposeTask(
      prompt,
      aiContext,
      aiConfig,
      {
        allowedTools: agentConfig.allowedTools,
        maxSteps: agentConfig.maxDepth || 5,
      }
    );

    const subTasks: SubTask[] = result.subTasks.map(st => ({
      id: st.id || randomUUID(),
      description: st.description,
      toolName: st.toolName,
      toolInput: st.toolInput,
      dependencies: st.dependencies,
      expectedOutput: st.expectedOutput,
      status: 'pending' as const,
    }));

    return {
      subTasks: this.buildExecutionOrder(subTasks),
      reasoning: result.reasoning,
      tokenUsage: result.tokenUsage
    };
  }

  /**
   * 构建执行顺序（拓扑排序）
   */
  buildExecutionOrder(subTasks: SubTask[]): SubTask[] {
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

      for (const [id, deps] of dependencyGraph) {
        if (deps.has(currentId)) {
          deps.delete(currentId);
          if (deps.size === 0 && !visited.has(id)) {
            queue.push(id);
          }
        }
      }
    }

    if (result.length !== subTasks.length) {
      console.warn('任务依赖图存在循环，使用原始顺序');
      return subTasks;
    }

    return result;
  }
}
