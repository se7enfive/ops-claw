/** 风险等级枚举 */
export enum RiskLevel {
  SAFE = 'safe',           // 安全：如 ls, pwd, cat 等只读命令
  LOW = 'low',             // 低风险：如 mkdir, touch, echo 等非破坏性操作
  MEDIUM = 'medium',       // 中风险：如 chmod, chown, mv 等权限/位置变更
  HIGH = 'high',           // 高风险：如 rm, kill, shutdown 等破坏性操作
  CRITICAL = 'critical',   // 极高风险：如 rm -rf /, dd 写磁盘等灾难性操作
}

/** 安全分析结果 */
export interface SecurityAnalysisResult {
  level: RiskLevel;
  requiresConfirmation: boolean;
  blocked: boolean;
  reason: string;
  matchedPattern?: string;
  saferAlternative?: string;
  affectedPaths?: string[];
  warnings: string[];
}

/** 安全分析器配置 */
export interface SecurityAnalyzerConfig {
  /** 风险阈值：高于此等级需要确认 */
  confirmationThreshold: RiskLevel;
  /** 风险阈值：高于此等级禁止执行 */
  blockThreshold: RiskLevel;
  /** 允许用户 override 禁止 */
  allowOverride: boolean;
  /** 自定义白名单命令 */
  whitelistPatterns: string[];
  /** 自定义黑名单命令（追加） */
  blacklistPatterns: string[];
}
