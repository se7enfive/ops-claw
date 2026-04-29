import { Tool, ToolInput, ToolOutput, ToolState } from './Tool';
import { ToolUseContext } from '../types/tool-context';
import { ToolRegistry } from './ToolRegistry';
import { SecurityAnalyzer } from './SecurityAnalyzer';
import { SecurityAnalysisResult, RiskLevel } from '../types/security';

/** 执行请求 */
export interface ToolExecutionRequest {
  toolName: string;
  input: ToolInput;
  context: ToolUseContext;
  userConfirmed?: boolean;
}

/** 执行结果 */
export interface ToolExecutionResult extends ToolOutput {
  toolName: string;
  state: ToolState;
  durationMs: number;
  securityAnalysis?: SecurityAnalysisResult;
  validationError?: string;
}

import { PermissionManager } from './PermissionManager';

/** 工具执行器 */
export class ToolExecutor {
  private registry: ToolRegistry;
  private securityAnalyzer: SecurityAnalyzer;
  private permissionManager?: PermissionManager;

  constructor(
    registry: ToolRegistry, 
    securityAnalyzer: SecurityAnalyzer,
    permissionManager?: PermissionManager
  ) {
    this.registry = registry;
    this.securityAnalyzer = securityAnalyzer;
    this.permissionManager = permissionManager;
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

    // Step 2: 安全分析（对包含命令的工具）
    if (tool.security.riskLevel !== RiskLevel.SAFE) {
      const command = this.extractCommandFromInput(toolName, input);
      if (command) {
        const analysis = this.securityAnalyzer.analyze(command);

        // 如果注入了 PermissionManager，则使用其策略覆写
        if (this.permissionManager) {
          const permission = this.permissionManager.checkPermission(command, analysis.level);
          if (permission === 'allow') {
            analysis.requiresConfirmation = false;
            analysis.blocked = false;
          } else if (permission === 'confirm') {
            analysis.requiresConfirmation = true;
            analysis.blocked = false;
          } else if (permission === 'deny') {
            analysis.requiresConfirmation = true;
            analysis.blocked = true;
          }
        }

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
    }

    // Step 3: 输入校验
    const validationError = tool.validateInput(input);
    if (validationError) {
      return this.createResult(toolName, startTime, {
        success: false,
        error: `输入参数校验失败: ${validationError}`,
        state: 'failed',
        validationError,
      });
    }

    try {
      // Step 4: 执行
      const output = await tool.execute(input, context);

      // Step 5: 执行后钩子
      if (tool.postExecute) {
        await tool.postExecute(input, output, context);
      }

      return this.createResult(toolName, startTime, {
        ...output,
        state: 'completed',
      });
    } catch (error: any) {
      return this.createResult(toolName, startTime, {
        success: false,
        error: error.message,
        state: 'failed',
      });
    }
  }

  /**
   * 确认后执行
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
      state: partial.state ?? 'idle',
      durationMs: Date.now() - startTime,
      securityAnalysis: partial.securityAnalysis,
      validationError: partial.validationError,
      contextUpdates: partial.contextUpdates,
    };
  }

  private extractCommandFromInput(toolName: string, input: ToolInput): string | null {
    if (toolName === 'ssh:execute' && typeof input.command === 'string') {
      return input.command;
    }
    return null;
  }
}
