/** Token 预算状态 */
export interface BudgetState {
  inputUsed: number;
  inputBudget: number;
  outputUsed: number;
  outputBudget: number;
  warningLevel: 'none' | 'warning' | 'critical' | 'exceeded';
  percentUsed: number;
  remaining: number;
  shouldCompact: boolean;
}

/** 预算配置 */
export interface BudgetConfig {
  inputBudget: number;
  outputBudget: number;
  warningThreshold: number;
  criticalThreshold: number;
  autoCompactThreshold: number;
}

const DEFAULT_CONFIG: BudgetConfig = {
  inputBudget: 100000,
  outputBudget: 4000,
  warningThreshold: 70,
  criticalThreshold: 85,
  autoCompactThreshold: 80,
};

/** Token 预算追踪器 */
export class TokenBudgetTracker {
  private config: BudgetConfig;
  private inputUsed: number = 0;
  private outputUsed: number = 0;

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 追踪 API 调用消耗 */
  trackUsage(inputTokens: number, outputTokens: number): BudgetState {
    this.inputUsed += inputTokens;
    this.outputUsed += outputTokens;
    return this.getState();
  }

  /** 获取当前状态 */
  getState(): BudgetState {
    const percentUsed = (this.inputUsed / this.config.inputBudget) * 100;
    const remaining = this.config.inputBudget - this.inputUsed;

    let warningLevel: BudgetState['warningLevel'] = 'none';
    let shouldCompact = false;

    if (percentUsed >= 100) {
      warningLevel = 'exceeded';
      shouldCompact = true;
    } else if (percentUsed >= this.config.criticalThreshold) {
      warningLevel = 'critical';
      shouldCompact = true;
    } else if (percentUsed >= this.config.warningThreshold) {
      warningLevel = 'warning';
      shouldCompact = percentUsed >= this.config.autoCompactThreshold;
    }

    return {
      inputUsed: this.inputUsed,
      inputBudget: this.config.inputBudget,
      outputUsed: this.outputUsed,
      outputBudget: this.config.outputBudget,
      warningLevel,
      percentUsed: Math.round(percentUsed),
      remaining,
      shouldCompact,
    };
  }

  /** 重置预算（新会话或压缩后） */
  reset(): void {
    this.inputUsed = 0;
    this.outputUsed = 0;
  }

  /** 压缩后部分重置（减去已压缩的量） */
  reduceUsage(tokenReduction: number): void {
    this.inputUsed = Math.max(0, this.inputUsed - tokenReduction);
  }

  /** 更新配置 */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 估算文本 Token 数量
   * 英文约 4 字符 = 1 token，中文约 2 字符 = 1 token
   */
  estimateTokens(content: string): number {
    if (!content) return 0;
    const englishChars = content.replace(/[^\x00-\x7F]/g, '').length;
    const chineseChars = content.replace(/[\x00-\x7F]/g, '').length;
    return Math.ceil(englishChars / 4 + chineseChars / 2);
  }
}
