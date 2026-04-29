import { Tool, ToolOutput } from '../Tool';
import { RiskLevel } from '../../types/security';
import { ToolUseContext } from '../../types/tool-context';
import { AIEngine, AIGenerateResult, AIContext } from '../../ai-engine';
import { AIConfig } from '../../database';

/** AI 生成输入参数 */
interface AIGenerateInput {
  prompt: string;
  aiConfig: AIConfig;
  context?: {
    os: string;
    currentDirectory?: string;
    hostname?: string;
    taskGoal?: string;
    recentCommands?: any[];
  };
}

/** AI 生成输出 */
interface AIGenerateOutput extends ToolOutput {
  data?: {
    command: string;
    explanation: string;
  };
}

export class AIGenerateTool implements Tool<AIGenerateInput, AIGenerateOutput> {
  private aiEngine: AIEngine;

  constructor(aiEngine: AIEngine) {
    this.aiEngine = aiEngine;
  }

  metadata = {
    name: 'ai:generate',
    description: '根据自然语言描述生成 shell 命令',
    category: 'ai',
    version: '1.0.0',
  };

  security = {
    riskLevel: RiskLevel.SAFE,  // AI 生成本身是安全的，执行时再检查
    allowedInModes: ['ai' as const],
  };

  validateInput(input: AIGenerateInput): string | null {
    if (!input.prompt || typeof input.prompt !== 'string') {
      return 'prompt 不能为空';
    }
    if (!input.aiConfig) {
      return 'aiConfig 不能为空';
    }
    if (!input.aiConfig.apiKey) {
      return 'AI API Key 未配置';
    }
    return null;
  }

  async execute(input: AIGenerateInput, context: ToolUseContext): Promise<AIGenerateOutput> {
    const aiContext: AIContext = {
      os: input.context?.os || context.os,
      currentDirectory: input.context?.currentDirectory,
      hostname: input.context?.hostname,
      taskGoal: input.context?.taskGoal,
      recentCommands: input.context?.recentCommands,
    };

    try {
      const result: AIGenerateResult = await this.aiEngine.generateCommand(
        input.prompt,
        aiContext,
        input.aiConfig
      );

      return {
        success: true,
        data: {
          command: result.command,
          explanation: result.explanation,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
