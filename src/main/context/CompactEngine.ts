import { CommandHistory, TaskStep, SessionContext } from '../database';
import { TokenBudgetTracker } from './TokenBudget';
import { AIEngine, AISummaryRequest } from '../ai-engine';
import { AIConfigItem } from '../database';

/** 压缩策略 */
export interface CompactStrategy {
  preserveRecentCommands: number;
  preserveRecentSteps: number;
  maxOutputLength: number;
  useAISummary: boolean;  // 是否使用 AI 生成智能摘要
  aiSummaryThreshold: number;  // 超过此数量步骤才用 AI 摘要
}

/** 压缩结果 */
export interface CompactResult {
  preserved: {
    commands: CommandHistory[];
    steps: TaskStep[];
  };
  summarized: {
    commandsSummary?: string;
    stepsSummary?: string;
  };
  removed: {
    commandsCount: number;
    stepsCount: number;
  };
  tokenReduction: number;
}

const DEFAULT_STRATEGY: CompactStrategy = {
  preserveRecentCommands: 3,
  preserveRecentSteps: 5,
  maxOutputLength: 500,
  useAISummary: true,       // 默认使用 AI 智能摘要
  aiSummaryThreshold: 5,   // 超过5个步骤需要摘要时，用 AI
};

/** 上下文压缩引擎 */
export class CompactEngine {
  private budgetTracker: TokenBudgetTracker;
  private strategy: CompactStrategy;
  private aiEngine?: AIEngine;
  private aiConfig?: AIConfigItem;

  constructor(
    budgetTracker: TokenBudgetTracker,
    strategy?: Partial<CompactStrategy>,
    aiEngine?: AIEngine
  ) {
    this.budgetTracker = budgetTracker;
    this.strategy = { ...DEFAULT_STRATEGY, ...strategy };
    this.aiEngine = aiEngine;
  }

  /** 设置 AI 配置（用于智能摘要） */
  setAIConfig(config: AIConfigItem): void {
    this.aiConfig = config;
  }

  /** 执行压缩 */
  compact(context: SessionContext): CompactResult {
    const { recentCommands = [], taskHistory = [] } = context;

    // 分离保留和需压缩的部分
    const preserveCount = Math.min(this.strategy.preserveRecentCommands, recentCommands.length);
    const preservedCommands = recentCommands.slice(-preserveCount);
    const commandsToSummarize = recentCommands.slice(0, -preserveCount || recentCommands.length);

    const stepsPreserveCount = Math.min(this.strategy.preserveRecentSteps, taskHistory.length);
    const preservedSteps = taskHistory.slice(-stepsPreserveCount);
    const stepsToSummarize = taskHistory.slice(0, -stepsPreserveCount || taskHistory.length);

    // 生成摘要（同步版本，用于快速压缩）
    const commandsSummary = this.summarizeCommands(commandsToSummarize);
    const stepsSummary = this.summarizeSteps(stepsToSummarize);

    // 估算 Token 节省量
    const originalTokens = this.estimateContextTokens(recentCommands, taskHistory);
    const compressedTokens =
      this.estimateContextTokens(preservedCommands, preservedSteps) +
      this.budgetTracker.estimateTokens((commandsSummary || '') + (stepsSummary || ''));

    return {
      preserved: {
        commands: preservedCommands.map(c => ({
          ...c,
          output: this.truncateOutput(c.output),
        })),
        steps: preservedSteps,
      },
      summarized: {
        commandsSummary,
        stepsSummary,
      },
      removed: {
        commandsCount: commandsToSummarize.length,
        stepsCount: stepsToSummarize.length,
      },
      tokenReduction: Math.max(0, originalTokens - compressedTokens),
    };
  }

  /**
   * 执行压缩（带 AI 智能摘要）
   * Claude Code 方案：当历史较多时，用 AI 生成智能摘要
   */
  async compactWithAISummary(
    context: SessionContext,
    currentGoal?: string
  ): Promise<CompactResult> {
    const { recentCommands = [], taskHistory = [] } = context;

    // 分离保留和需压缩的部分
    const preserveCount = Math.min(this.strategy.preserveRecentCommands, recentCommands.length);
    const preservedCommands = recentCommands.slice(-preserveCount);
    const commandsToSummarize = recentCommands.slice(0, -preserveCount || recentCommands.length);

    const stepsPreserveCount = Math.min(this.strategy.preserveRecentSteps, taskHistory.length);
    const preservedSteps = taskHistory.slice(-stepsPreserveCount);
    const stepsToSummarize = taskHistory.slice(0, -stepsPreserveCount || taskHistory.length);

    // 判断是否需要 AI 智能摘要
    const needAISummary = this.strategy.useAISummary &&
                          stepsToSummarize.length >= this.strategy.aiSummaryThreshold &&
                          this.aiEngine &&
                          this.aiConfig;

    let stepsSummary: string | undefined;

    if (needAISummary) {
      // Claude Code 方案：用 AI 生成智能摘要
      console.log(`[CompactEngine] 使用 AI 智能摘要，共 ${stepsToSummarize.length} 个步骤`);

      try {
        const aiResult = await this.aiEngine.generateContextSummary(
          {
            taskHistory: stepsToSummarize.map(s => ({
              action: s.action,
              content: s.content,
              command: s.command,
              result: s.result,
            })),
            recentCommands: commandsToSummarize,
            currentGoal: currentGoal,
          },
          {
            os: 'linux',
            currentDirectory: context.currentDirectory,
            hostname: context.hostname,
          },
          this.aiConfig!
        );

        // 组装 AI 生成的摘要
        if (aiResult.summary) {
          stepsSummary = aiResult.summary;
        }
        if (aiResult.keyFindings.length > 0) {
          stepsSummary = (stepsSummary || '') + `\n关键发现: ${aiResult.keyFindings.join(', ')}`;
        }

        // 追踪 AI 摘要的 Token 消耗（由调用方处理）
      } catch (e: any) {
        console.error('[CompactEngine] AI 摘要失败，使用正则摘要:', e.message);
        stepsSummary = this.summarizeSteps(stepsToSummarize);
      }
    } else {
      // 快速压缩：使用正则提取
      stepsSummary = this.summarizeSteps(stepsToSummarize);
    }

    const commandsSummary = this.summarizeCommands(commandsToSummarize);

    // 估算 Token 节省量
    const originalTokens = this.estimateContextTokens(recentCommands, taskHistory);
    const compressedTokens =
      this.estimateContextTokens(preservedCommands, preservedSteps) +
      this.budgetTracker.estimateTokens((commandsSummary || '') + (stepsSummary || ''));

    return {
      preserved: {
        commands: preservedCommands.map(c => ({
          ...c,
          output: this.truncateOutput(c.output),
        })),
        steps: preservedSteps,
      },
      summarized: {
        commandsSummary,
        stepsSummary,
      },
      removed: {
        commandsCount: commandsToSummarize.length,
        stepsCount: stepsToSummarize.length,
      },
      tokenReduction: Math.max(0, originalTokens - compressedTokens),
    };
  }

  /** 应用压缩结果到上下文 */
  applyCompact(context: SessionContext, result: CompactResult): SessionContext {
    const newContext: SessionContext = {
      ...context,
      recentCommands: result.preserved.commands,
      taskHistory: [...result.preserved.steps],
    };

    // 将摘要作为历史备注插入到最前面
    if (result.summarized.stepsSummary) {
      newContext.taskHistory = [
        {
          timestamp: new Date().toISOString(),
          action: 'analysis',
          content: `历史摘要：${result.summarized.stepsSummary}`,
        },
        ...newContext.taskHistory!,
      ];
    }

    return newContext;
  }

  // ===== 私有方法 =====

  private estimateContextTokens(commands: CommandHistory[], steps: TaskStep[]): number {
    let total = 0;
    for (const cmd of commands) {
      total += this.budgetTracker.estimateTokens(cmd.command + cmd.output);
    }
    for (const step of steps) {
      total += this.budgetTracker.estimateTokens(step.content + (step.command || '') + (step.result || ''));
    }
    return total;
  }

  private summarizeCommands(commands: CommandHistory[]): string | undefined {
    if (commands.length === 0) return undefined;

    const successCount = commands.filter(c => c.exitCode === 0).length;
    const failCount = commands.length - successCount;
    const categories = this.groupByCategory(commands);

    const details = Object.entries(categories)
      .map(([cat, cmds]) => `${cat}: ${cmds.length} 条`)
      .join('、');

    return `执行了 ${commands.length} 条命令（${successCount} 成功，${failCount} 失败）。主要操作：${details}`;
  }

  private summarizeSteps(steps: TaskStep[]): string | undefined {
    if (steps.length === 0) return undefined;

    const intents = steps
      .filter(s => s.action === 'intent')
      .map(s => s.content)
      .slice(0, 3);

    // 提取关键路径信息（最重要！）
    const pathFindings: string[] = [];
    for (const step of steps) {
      if (step.action === 'result' && (step.result || step.content)) {
        const content = step.result || step.content;
        // 提取路径
        const paths = content.match(/\/[\w\-\.\/]+/g);
        if (paths) {
          const uniquePaths = [...new Set(paths)].filter(p =>
            p.length > 3 && !p.includes('/proc') && !p.includes('/sys') && !p.includes('/dev')
          );
          if (uniquePaths.length > 0) {
            pathFindings.push(...uniquePaths.slice(0, 5));
          }
        }
      }
    }

    const parts: string[] = [];
    if (intents.length > 0) {
      parts.push(`操作目标: ${intents.join('、')}`);
    }
    if (pathFindings.length > 0) {
      parts.push(`发现路径: ${[...new Set(pathFindings)].slice(0, 5).join(', ')}`);
    }

    if (parts.length === 0) {
      parts.push(`执行了 ${steps.length} 个步骤`);
    }

    return parts.join('；');
  }

  private groupByCategory(commands: CommandHistory[]): Record<string, CommandHistory[]> {
    const categories: Record<string, CommandHistory[]> = {};

    for (const cmd of commands) {
      const category = this.classifyCommand(cmd.command);
      if (!categories[category]) categories[category] = [];
      categories[category].push(cmd);
    }

    return categories;
  }

  private classifyCommand(command: string): string {
    const cmd = command.trim().split(' ')[0];

    const categoryMap: Record<string, string[]> = {
      '查看操作': ['ls', 'pwd', 'cat', 'head', 'tail', 'less', 'grep', 'find', 'wc'],
      '文件操作': ['rm', 'mv', 'cp', 'mkdir', 'touch', 'ln'],
      '权限操作': ['chmod', 'chown'],
      '进程操作': ['ps', 'kill', 'top', 'htop'],
      '容器操作': ['docker', 'kubectl'],
      '服务操作': ['systemctl', 'service'],
      '网络操作': ['curl', 'wget', 'ping', 'netstat', 'ss', 'dig', 'nslookup'],
    };

    for (const [category, cmds] of Object.entries(categoryMap)) {
      if (cmds.includes(cmd)) return category;
    }

    return '其他操作';
  }

  private truncateOutput(output: string): string {
    if (output.length <= this.strategy.maxOutputLength) return output;
    return output.substring(0, this.strategy.maxOutputLength) + '\n...[已截断]';
  }
}
