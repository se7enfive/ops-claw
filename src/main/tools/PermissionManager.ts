import { RiskLevel } from '../types/security';

/** 权限模式 */
export type PermissionMode = 'standard' | 'cautious' | 'strict';

/** 权限规则 */
export interface PermissionRule {
  id: string;
  pattern: string;
  action: 'allow' | 'deny' | 'confirm';
  description?: string;
}

/** 权限配置 */
export interface PermissionConfig {
  mode: PermissionMode;
  rules: PermissionRule[];
}

const DEFAULT_CONFIG: PermissionConfig = {
  mode: 'standard',
  rules: [],
};

/**
 * 权限管理器
 * 根据权限模式和自定义规则决定命令是否需要确认
 */
export class PermissionManager {
  private config: PermissionConfig;

  constructor(config?: Partial<PermissionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 检查命令是否允许执行 */
  checkPermission(command: string, riskLevel: RiskLevel): 'allow' | 'confirm' | 'deny' {
    // 1. 先检查自定义规则（优先级最高）
    const ruleMatch = this.matchRule(command);
    if (ruleMatch) return ruleMatch;

    // 2. 按权限模式判断
    switch (this.config.mode) {
      case 'strict':
        // 严格模式：只有 SAFE 命令不需确认
        if (riskLevel === RiskLevel.SAFE) return 'allow';
        if (riskLevel === RiskLevel.CRITICAL) return 'deny';
        return 'confirm';

      case 'cautious':
        // 谨慎模式：LOW 及以下不需确认
        if (riskLevel === RiskLevel.SAFE || riskLevel === RiskLevel.LOW) return 'allow';
        if (riskLevel === RiskLevel.CRITICAL) return 'deny';
        return 'confirm';

      case 'standard':
      default:
        // 标准模式：MEDIUM 及以下不需确认
        if (riskLevel === RiskLevel.CRITICAL) return 'deny';
        if (riskLevel === RiskLevel.HIGH) return 'confirm';
        return 'allow';
    }
  }

  /** 获取当前配置 */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  /** 更新权限模式 */
  setMode(mode: PermissionMode): void {
    this.config.mode = mode;
  }

  /** 添加规则 */
  addRule(rule: Omit<PermissionRule, 'id'>): PermissionRule {
    const newRule: PermissionRule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    };
    this.config.rules.push(newRule);
    return newRule;
  }

  /** 删除规则 */
  removeRule(id: string): boolean {
    const before = this.config.rules.length;
    this.config.rules = this.config.rules.filter(r => r.id !== id);
    return this.config.rules.length < before;
  }

  /** 获取模式描述 */
  static getModeDescription(mode: PermissionMode): string {
    switch (mode) {
      case 'standard': return '标准模式：仅高危命令需确认';
      case 'cautious': return '谨慎模式：中风险以上需确认';
      case 'strict': return '严格模式：所有非只读命令需确认';
    }
  }

  // ===== 私有方法 =====

  private matchRule(command: string): 'allow' | 'confirm' | 'deny' | null {
    for (const rule of this.config.rules) {
      try {
        if (new RegExp(rule.pattern).test(command)) {
          return rule.action;
        }
      } catch {
        if (command.includes(rule.pattern)) {
          return rule.action;
        }
      }
    }
    return null;
  }
}
