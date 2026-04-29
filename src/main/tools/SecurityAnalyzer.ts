import { RiskLevel, SecurityAnalysisResult, SecurityAnalyzerConfig } from '../types/security';
import { DANGEROUS_PATTERNS, SAFE_COMMANDS, DangerousPattern, SafeCommandPattern } from './DangerousPatterns';

const DEFAULT_CONFIG: SecurityAnalyzerConfig = {
  confirmationThreshold: RiskLevel.MEDIUM,
  blockThreshold: RiskLevel.CRITICAL,
  allowOverride: true,
  whitelistPatterns: [],
  blacklistPatterns: [],
};

export class SecurityAnalyzer {
  private config: SecurityAnalyzerConfig;

  constructor(config: Partial<SecurityAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 分析命令安全等级
   */
  analyze(command: string): SecurityAnalysisResult {
    const trimmedCommand = command.trim();

    // 1. 检查白名单
    if (this.isWhitelisted(trimmedCommand)) {
      return this.createSafeResult(trimmedCommand);
    }

    // 2. 检查安全命令库
    const safeMatch = this.matchSafeCommand(trimmedCommand);
    if (safeMatch) {
      return this.createSafeResult(trimmedCommand, safeMatch.description);
    }

    // 3. 检查危险模式库（从高风险到低风险）
    const dangerousMatch = this.matchDangerousPattern(trimmedCommand);
    if (dangerousMatch) {
      return this.createDangerousResult(trimmedCommand, dangerousMatch);
    }

    // 4. 检查黑名单（用户自定义）
    if (this.isBlacklisted(trimmedCommand)) {
      return this.createBlockedResult(trimmedCommand, '命令在黑名单中');
    }

    // 5. 未知命令：按低风险处理（不强制确认，避免打扰）
    return this.createUnknownResult(trimmedCommand);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SecurityAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 提取命令操作的目标路径
   */
  extractTargets(command: string): string[] {
    const targets: string[] = [];

    const pathPatterns = [
      /(rm|mv|cp|chmod|chown|mkdir|touch|cat|head|tail|less)\s+(-\S+\s+)*(['"]?)(\/[^\s'"]*)\3/g,
      />\s*(['"]?)(\/[^\s'"]*)\1/g,
      /of=(['"]?)([^\s'"]*)\1/g,
    ];

    for (const pattern of pathPatterns) {
      const matches = command.matchAll(pattern);
      for (const match of matches) {
        const target = match[4] || match[2];
        if (target) {
          targets.push(target);
        }
      }
    }

    return targets;
  }

  /**
   * 建议安全替代命令
   */
  suggestAlternative(command: string): string | null {
    if (command.match(/^rm\s+(-[rf]+\s+)/)) {
      return command.replace(/-rf?/, '-i');
    }

    if (command.match(/chmod\s+777/)) {
      return command.replace(/777/, '755');
    }

    if (command.match(/(curl|wget).*\|\s*(sh|bash)/)) {
      return '请先下载脚本，检查内容后再执行';
    }

    return null;
  }

  // ===== 私有方法 =====

  private isWhitelisted(command: string): boolean {
    return this.config.whitelistPatterns.some(pattern => {
      try {
        return new RegExp(pattern).test(command);
      } catch {
        return command.includes(pattern);
      }
    });
  }

  private isBlacklisted(command: string): boolean {
    return this.config.blacklistPatterns.some(pattern => {
      try {
        return new RegExp(pattern).test(command);
      } catch {
        return command.includes(pattern);
      }
    });
  }

  private matchSafeCommand(command: string): SafeCommandPattern | null {
    return SAFE_COMMANDS.find(p => p.pattern.test(command)) || null;
  }

  private matchDangerousPattern(command: string): DangerousPattern | null {
    // 按风险等级从高到低匹配
    const orderedPatterns = [...DANGEROUS_PATTERNS].sort((a, b) => {
      const levels = [RiskLevel.CRITICAL, RiskLevel.HIGH, RiskLevel.MEDIUM, RiskLevel.LOW];
      return levels.indexOf(a.level) - levels.indexOf(b.level);
    });

    return orderedPatterns.find(p => p.pattern.test(command)) || null;
  }

  private createSafeResult(command: string, description?: string): SecurityAnalysisResult {
    return {
      level: RiskLevel.SAFE,
      requiresConfirmation: false,
      blocked: false,
      reason: description || '安全命令',
      warnings: [],
    };
  }

  private createDangerousResult(
    command: string,
    pattern: DangerousPattern
  ): SecurityAnalysisResult {
    const level = pattern.level;
    const requiresConfirmation = this.compareRiskLevel(level, this.config.confirmationThreshold) >= 0;
    const blocked = this.compareRiskLevel(level, this.config.blockThreshold) >= 0;

    const warnings: string[] = [pattern.reason];
    if (pattern.alternative) {
      warnings.push(`安全替代: ${pattern.alternative}`);
    }

    const targets = this.extractTargets(command);
    if (targets.length > 0) {
      warnings.push(`操作目标: ${targets.join(', ')}`);
    }

    return {
      level,
      requiresConfirmation,
      blocked,
      reason: pattern.reason,
      matchedPattern: pattern.pattern.source,
      saferAlternative: this.suggestAlternative(command) || pattern.alternative,
      affectedPaths: targets,
      warnings,
    };
  }

  private createBlockedResult(command: string, reason: string): SecurityAnalysisResult {
    return {
      level: RiskLevel.CRITICAL,
      requiresConfirmation: true,
      blocked: true,
      reason,
      warnings: ['此命令被禁止执行'],
    };
  }

  private createUnknownResult(command: string): SecurityAnalysisResult {
    return {
      level: RiskLevel.LOW,
      requiresConfirmation: false,
      blocked: false,
      reason: '未识别的命令',
      warnings: [],
    };
  }

  private compareRiskLevel(a: RiskLevel, b: RiskLevel): number {
    const levels = [RiskLevel.SAFE, RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];
    return levels.indexOf(a) - levels.indexOf(b);
  }
}
