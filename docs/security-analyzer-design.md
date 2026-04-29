# P0：命令安全语义分析器设计

> 优先级：最高（安全是一等约束）
> 预计工作量：2-3 天

## 一、设计目标

防止用户误执行危险命令，在命令执行前进行安全分析，根据风险等级决定：
- **安全命令**：直接执行
- **低风险命令**：提示但可继续
- **中风险命令**：需要用户确认
- **高风险命令**：强烈警告 + 确认 + 安全替代建议
- **极高风险命令**：禁止执行（可选白名单绕过）

## 二、核心类型定义

```typescript
// src/main/types/security.ts

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
  // 风险阈值：高于此等级需要确认
  confirmationThreshold: RiskLevel;
  // 风险阈值：高于此等级禁止执行
  blockThreshold: RiskLevel;
  // 允许用户 override 禁止
  allowOverride: boolean;
  // 自定义白名单命令
  whitelistPatterns: string[];
  // 自定义黑名单命令（追加）
  blacklistPatterns: string[];
}

/** 命令分类 */
export interface CommandClassification {
  type: 'read' | 'write' | 'execute' | 'network' | 'system' | 'dangerous';
  targets: string[];      // 命令操作的目标路径/进程
  sideEffects: string[];  // 潜在副作用描述
}
```

## 三、危险模式库

```typescript
// src/main/tools/DangerousPatterns.ts

export const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // ===== 极高风险（CRITICAL）=====
  {
    pattern: /^rm\s+(-[rf]+\s+)*\/$/,
    level: RiskLevel.CRITICAL,
    reason: '删除根目录将导致系统完全损坏',
    category: 'filesystem',
  },
  {
    pattern: /^rm\s+(-[rf]+\s+)*\/\*/,
    level: RiskLevel.CRITICAL,
    reason: '删除根目录下所有文件将导致系统损坏',
    category: 'filesystem',
  },
  {
    pattern: /^dd\s+.*of=\/dev\/(sd[a-z]|hd[a-z]|nvme)/,
    level: RiskLevel.CRITICAL,
    reason: '直接写入磁盘设备将破坏数据',
    category: 'disk',
  },
  {
    pattern: /:\(\)\s*{\s*:\|:&\s*};/,
    level: RiskLevel.CRITICAL,
    reason: 'Fork bomb 将耗尽系统资源',
    category: 'system',
  },
  {
    pattern: /^chmod\s+(-R\s+)?(777|a+rwx)\s+\/$/,
    level: RiskLevel.CRITICAL,
    reason: '将根目录权限设为全开放极其危险',
    category: 'permission',
  },
  {
    pattern: /^mkfs\.(ext[234]|xfs|btrfs|ntfs|fat)\s+\/dev\/(sd|hd|nvme)/,
    level: RiskLevel.CRITICAL,
    reason: '格式化磁盘将删除所有数据',
    category: 'disk',
  },

  // ===== 高风险（HIGH）=====
  {
    pattern: /^rm\s+(-[rf]+\s+)/,
    level: RiskLevel.HIGH,
    reason: '强制删除文件/目录，无法恢复',
    category: 'filesystem',
    alternative: '建议先备份，使用 rm -i 进行交互式删除',
  },
  {
    pattern: /^kill\s+(-9\s+)?(\d+|\$PID|all)/,
    level: RiskLevel.HIGH,
    reason: '强制终止进程可能导致数据丢失或服务中断',
    category: 'process',
  },
  {
    pattern: /^shutdown|^reboot|^halt|^poweroff/,
    level: RiskLevel.HIGH,
    reason: '关机/重启命令将中断所有服务',
    category: 'system',
  },
  {
    pattern: /^iptables\s+(-F|-P\s+INPUT\s+DROP)/,
    level: RiskLevel.HIGH,
    reason: '清空防火墙规则可能导致安全暴露',
    category: 'network',
  },
  {
    pattern: /^chown\s+(-R\s+)?/,
    level: RiskLevel.HIGH,
    reason: '更改文件所有者可能影响服务运行',
    category: 'permission',
  },
  {
    pattern: /^chmod\s+(-R\s+)?(000|a-rwx)/,
    level: RiskLevel.HIGH,
    reason: '移除所有权限将导致文件不可访问',
    category: 'permission',
  },
  {
    pattern: /^curl.*\|\s*(sh|bash|zsh)/,
    level: RiskLevel.HIGH,
    reason: '从网络下载并直接执行脚本存在安全风险',
    category: 'network',
  },
  {
    pattern: /^wget.*\|\s*(sh|bash|zsh)/,
    level: RiskLevel.HIGH,
    reason: '从网络下载并直接执行脚本存在安全风险',
    category: 'network',
  },

  // ===== 中风险（MEDIUM）=====
  {
    pattern: /^chmod\s+/,
    level: RiskLevel.MEDIUM,
    reason: '更改文件权限可能影响访问控制',
    category: 'permission',
  },
  {
    pattern: /^mv\s+/,
    level: RiskLevel.MEDIUM,
    reason: '移动文件可能改变文件位置，影响引用',
    category: 'filesystem',
  },
  {
    pattern: /^cp\s+(-r\s+)?/,
    level: RiskLevel.MEDIUM,
    reason: '复制操作可能覆盖目标文件',
    category: 'filesystem',
  },
  {
    pattern: /^service\s+\w+\s+(stop|restart)/,
    level: RiskLevel.MEDIUM,
    reason: '停止/重启服务将暂时中断功能',
    category: 'system',
  },
  {
    pattern: /^systemctl\s+(stop|restart|disable)\s+/,
    level: RiskLevel.MEDIUM,
    reason: '停止/重启/禁用服务将影响系统功能',
    category: 'system',
  },
  {
    pattern: /^docker\s+(rm|rmi|stop|kill)/,
    level: RiskLevel.MEDIUM,
    reason: 'Docker 操作可能影响容器运行',
    category: 'container',
  },
  {
    pattern: /^kubectl\s+(delete|scale\s+--replicas=0)/,
    level: RiskLevel.MEDIUM,
    reason: 'Kubernetes 删除/缩容操作将影响服务',
    category: 'container',
  },

  // ===== 低风险（LOW）=====
  {
    pattern: /^mkdir\s+/,
    level: RiskLevel.LOW,
    reason: '创建目录',
    category: 'filesystem',
  },
  {
    pattern: /^touch\s+/,
    level: RiskLevel.LOW,
    reason: '创建/更新文件时间戳',
    category: 'filesystem',
  },
  {
    pattern: /^echo\s+/,
    level: RiskLevel.LOW,
    reason: '输出文本',
    category: 'filesystem',
  },
  {
    pattern: /^ln\s+/,
    level: RiskLevel.LOW,
    reason: '创建链接',
    category: 'filesystem',
  },
];

/** 安全命令库（白名单） */
export const SAFE_COMMANDS: SafeCommandPattern[] = [
  { pattern: /^ls/, type: 'read', description: '列出目录' },
  { pattern: /^pwd/, type: 'read', description: '显示当前目录' },
  { pattern: /^cat\s+/, type: 'read', description: '查看文件内容' },
  { pattern: /^head\s+/, type: 'read', description: '查看文件开头' },
  { pattern: /^tail\s+/, type: 'read', description: '查看文件结尾' },
  { pattern: /^less\s+/, type: 'read', description: '分页查看文件' },
  { pattern: /^more\s+/, type: 'read', description: '分页查看文件' },
  { pattern: /^grep\s+/, type: 'read', description: '搜索文本' },
  { pattern: /^find\s+/, type: 'read', description: '查找文件' },
  { pattern: /^which\s+/, type: 'read', description: '查找命令位置' },
  { pattern: /^whereis\s+/, type: 'read', description: '查找文件位置' },
  { pattern: /^whoami/, type: 'read', description: '显示当前用户' },
  { pattern: /^id/, type: 'read', description: '显示用户信息' },
  { pattern: /^uname\s+/, type: 'read', description: '显示系统信息' },
  { pattern: /^hostname/, type: 'read', description: '显示主机名' },
  { pattern: /^date/, type: 'read', description: '显示日期' },
  { pattern: /^uptime/, type: 'read', description: '显示运行时间' },
  { pattern: /^free\s+/, type: 'read', description: '显示内存状态' },
  { pattern: /^df\s+/, type: 'read', description: '显示磁盘状态' },
  { pattern: /^du\s+/, type: 'read', description: '显示目录大小' },
  { pattern: /^ps\s+/, type: 'read', description: '显示进程' },
  { pattern: /^top/, type: 'read', description: '显示进程状态' },
  { pattern: /^htop/, type: 'read', description: '交互式进程查看' },
  { pattern: /^netstat\s+/, type: 'read', description: '显示网络状态' },
  { pattern: /^ss\s+/, type: 'read', description: '显示 socket 状态' },
  { pattern: /^ip\s+(addr|route|link)\s+show/, type: 'read', description: '显示网络配置' },
  { pattern: /^ifconfig\s+/, type: 'read', description: '显示网络接口' },
  { pattern: /^ping\s+/, type: 'network', description: '网络连通测试' },
  { pattern: /^traceroute\s+/, type: 'network', description: '路由追踪' },
  { pattern: /^dig\s+/, type: 'network', description: 'DNS 查询' },
  { pattern: /^nslookup\s+/, type: 'network', description: 'DNS 查询' },
  { pattern: /^curl\s+(-I|--head)/, type: 'read', description: 'HTTP 头检查' },
  { pattern: /^wget\s+--spider/, type: 'read', description: 'URL 检查' },
  { pattern: /^docker\s+(ps|images|logs|inspect|stats)/, type: 'read', description: 'Docker 信息查看' },
  { pattern: /^kubectl\s+(get|describe|logs)/, type: 'read', description: 'Kubernetes 信息查看' },
  { pattern: /^git\s+(status|log|diff|branch|show)/, type: 'read', description: 'Git 信息查看' },
  { pattern: /^journalctl\s+/, type: 'read', description: '查看系统日志' },
  { pattern: /^dmesg\s+/, type: 'read', description: '查看内核消息' },
  { pattern: /^history/, type: 'read', description: '查看命令历史' },
  { pattern: /^env/, type: 'read', description: '显示环境变量' },
  { pattern: /^printenv/, type: 'read', description: '显示环境变量' },
];

interface DangerousPattern {
  pattern: RegExp;
  level: RiskLevel;
  reason: string;
  category: string;
  alternative?: string;
}

interface SafeCommandPattern {
  pattern: RegExp;
  type: 'read' | 'network';
  description: string;
}
```

## 四、安全分析器实现

```typescript
// src/main/tools/SecurityAnalyzer.ts

import { RiskLevel, SecurityAnalysisResult, SecurityAnalyzerConfig } from '../types/security';
import { DANGEROUS_PATTERNS, SAFE_COMMANDS } from './DangerousPatterns';

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
   * @param command 待执行的命令字符串
   * @returns 安全分析结果
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

    // 5. 未知命令：按中风险处理
    return this.createUnknownResult(trimmedCommand);
  }

  /**
   * 提取命令操作的目标路径
   */
  extractTargets(command: string): string[] {
    const targets: string[] = [];
    
    // 匹配路径模式
    const pathPatterns = [
      // rm/mv/cp/chmod/chown 后的路径
      /(rm|mv|cp|chmod|chown|mkdir|touch|cat|head|tail|less)\s+(-\S+\s+)*(['"]?)([\/\~][^\s'"]*)\3/g,
      // 重定向目标
      />\s*(['"]?)([\/\~][^\s'"]*)\1/g,
      // dd of 参数
      /of=(['"]?)([^\s'"]*)\1/g,
    ];

    for (const pattern of pathPatterns) {
      const matches = command.matchAll(pattern);
      for (const match of matches) {
        if (match[4] || match[2]) {
          targets.push(match[4] || match[2]);
        }
      }
    }

    return targets;
  }

  /**
   * 建议安全替代命令
   */
  suggestAlternative(command: string): string | null {
    // rm -rf → rm -i (交互式)
    if (command.match(/^rm\s+(-[rf]+\s+)/)) {
      return command.replace(/-rf?/, '-i');
    }

    // chmod 777 → chmod 755
    if (command.match(/chmod\s+777/)) {
      return command.replace(/777/, '755');
    }

    // curl | sh → curl → 检查 → sh
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

    // 添加路径警告
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
      level: RiskLevel.MEDIUM,
      requiresConfirmation: true,
      blocked: false,
      reason: '未知命令，建议确认后再执行',
      warnings: ['无法确定此命令的安全性'],
    };
  }

  private compareRiskLevel(a: RiskLevel, b: RiskLevel): number {
    const levels = [RiskLevel.SAFE, RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];
    return levels.indexOf(a) - levels.indexOf(b);
  }
}
```

## 五、集成到执行流程

```typescript
// src/main/tools/CommandExecutor.ts（新增）

import { SecurityAnalyzer } from './SecurityAnalyzer';
import { SecurityAnalysisResult, RiskLevel } from '../types/security';
import { ServerManager } from '../services/ServerManager';

export interface ExecutionRequest {
  connectionId: string;
  command: string;
  serverId: number;
  context?: {
    userPrompt?: string;
    isAIGenerated?: boolean;
  };
}

export interface ExecutionResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  securityAnalysis?: SecurityAnalysisResult;
  wasConfirmed?: boolean;
}

export class CommandExecutor {
  private securityAnalyzer: SecurityAnalyzer;
  private serverManager: ServerManager;
  private pendingConfirmations: Map<string, ExecutionRequest> = new Map();

  constructor(serverManager: ServerManager) {
    this.serverManager = serverManager;
    this.securityAnalyzer = new SecurityAnalyzer();
  }

  /**
   * 执行命令流程
   * 1. 安全分析
   * 2. 根据风险等级决定是否需要确认
   * 3. 执行命令
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // Step 1: 安全分析
    const securityAnalysis = this.securityAnalyzer.analyze(request.command);

    // Step 2: 判断是否需要确认
    if (securityAnalysis.blocked && !securityAnalysis.wasOverridden) {
      return {
        success: false,
        error: '命令被安全策略阻止',
        securityAnalysis,
      };
    }

    if (securityAnalysis.requiresConfirmation) {
      // 需要确认：返回分析结果，等待前端确认
      return {
        success: false,
        error: '需要用户确认',
        securityAnalysis,
      };
    }

    // Step 3: 执行命令
    return this.doExecute(request, securityAnalysis);
  }

  /**
   * 用户确认后执行
   */
  async executeWithConfirmation(
    request: ExecutionRequest,
    userConfirmed: boolean
  ): Promise<ExecutionResult> {
    const securityAnalysis = this.securityAnalyzer.analyze(request.command);

    if (!userConfirmed) {
      return {
        success: false,
        error: '用户取消执行',
        securityAnalysis,
        wasConfirmed: false,
      };
    }

    return this.doExecute(request, securityAnalysis, true);
  }

  /**
   * 实际执行命令
   */
  private async doExecute(
    request: ExecutionRequest,
    securityAnalysis: SecurityAnalysisResult,
    wasConfirmed = false
  ): Promise<ExecutionResult> {
    try {
      const result = await this.serverManager.execute(
        request.connectionId,
        request.command
      );

      return {
        ...result,
        securityAnalysis,
        wasConfirmed,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        securityAnalysis,
        wasConfirmed,
      };
    }
  }
}
```

## 六、IPC Handler 集成

```typescript
// src/main/index.ts（新增部分）

import { CommandExecutor, ExecutionRequest, ExecutionResult } from './tools/CommandExecutor';
import { SecurityAnalyzer } from './tools/SecurityAnalyzer';

let commandExecutor: CommandExecutor;

function setupIpcHandlers() {
  // ... 现有 handlers ...

  // 命令安全分析（前端可调用）
  ipcMain.handle('command:analyze', (_event, command: string) => {
    return securityAnalyzer.analyze(command);
  });

  // 带安全检查的命令执行
  ipcMain.handle('command:execute', async (_event, request: ExecutionRequest) => {
    return commandExecutor.execute(request);
  });

  // 确认后执行
  ipcMain.handle('command:executeConfirmed', async (
    _event,
    request: ExecutionRequest,
    confirmed: boolean
  ) => {
    return commandExecutor.executeWithConfirmation(request, confirmed);
  });

  // 更新安全配置
  ipcMain.handle('security:updateConfig', (_event, config: Partial<SecurityAnalyzerConfig>) => {
    securityAnalyzer.updateConfig(config);
  });
}
```

## 七、前端 API 暴露

```typescript
// src/preload/index.ts（新增部分）

contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有 API ...

  // 命令安全分析
  commandAnalyze: (command: string) => ipcRenderer.invoke('command:analyze', command),
  
  // 带安全检查的命令执行
  commandExecute: (request: ExecutionRequest) => ipcRenderer.invoke('command:execute', request),
  
  // 确认后执行
  commandExecuteConfirmed: (request: ExecutionRequest, confirmed: boolean) => 
    ipcRenderer.invoke('command:executeConfirmed', request, confirmed),
  
  // 安全配置
  securityUpdateConfig: (config: any) => ipcRenderer.invoke('security:updateConfig', config),
});
```

## 八、前端安全警告组件

```tsx
// src/renderer/components/SecurityWarning.tsx

import React from 'react';
import { RiskLevel, SecurityAnalysisResult } from '../types/security';

interface SecurityWarningProps {
  analysis: SecurityAnalysisResult;
  command: string;
  onConfirm: () => void;
  onCancel: () => void;
  onUseAlternative?: (alternative: string) => void;
}

const RISK_COLORS: Record<RiskLevel, string> = {
  [RiskLevel.SAFE]: 'bg-green-100 text-green-800 border-green-300',
  [RiskLevel.LOW]: 'bg-blue-100 text-blue-800 border-blue-300',
  [RiskLevel.MEDIUM]: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  [RiskLevel.HIGH]: 'bg-orange-100 text-orange-800 border-orange-300',
  [RiskLevel.CRITICAL]: 'bg-red-100 text-red-800 border-red-300',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  [RiskLevel.SAFE]: '安全',
  [RiskLevel.LOW]: '低风险',
  [RiskLevel.MEDIUM]: '中风险',
  [RiskLevel.HIGH]: '高风险',
  [RiskLevel.CRITICAL]: '极高风险',
};

export const SecurityWarning: React.FC<SecurityWarningProps> = ({
  analysis,
  command,
  onConfirm,
  onCancel,
  onUseAlternative,
}) => {
  if (!analysis.requiresConfirmation) {
    return null;
  }

  const colorClass = RISK_COLORS[analysis.level];
  const label = RISK_LABELS[analysis.level];

  return (
    <div className={`fixed inset-0 flex items-center justify-center bg-black/50 z-50`}>
      <div className={`max-w-lg w-full mx-4 p-6 rounded-lg border-2 ${colorClass} shadow-xl`}>
        {/* 标题 */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`px-3 py-1 rounded-full font-bold ${colorClass}`}>
            {label}
          </div>
          <h3 className="font-bold text-lg">命令安全警告</h3>
        </div>

        {/* 命令显示 */}
        <div className="bg-gray-800 text-gray-100 p-3 rounded mb-4 font-mono text-sm overflow-x-auto">
          {command}
        </div>

        {/* 警告列表 */}
        <ul className="mb-4 space-y-1">
          {analysis.warnings.map((warning, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-orange-500">⚠</span>
              {warning}
            </li>
          ))}
        </ul>

        {/* 安全替代 */}
        {analysis.saferAlternative && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
            <div className="text-sm font-medium text-green-700 mb-1">
              建议使用安全替代：
            </div>
            <div className="font-mono text-sm text-green-800">
              {analysis.saferAlternative}
            </div>
            {onUseAlternative && (
              <button
                onClick={() => onUseAlternative(analysis.saferAlternative!)}
                className="mt-2 px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition"
              >
                使用替代命令
              </button>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded transition"
          >
            取消执行
          </button>
          {!analysis.blocked && (
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded transition ${
                analysis.level === RiskLevel.HIGH || analysis.level === RiskLevel.CRITICAL
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              确认执行（风险自负）
            </button>
          )}
        </div>

        {/* 受影响路径 */}
        {analysis.affectedPaths && analysis.affectedPaths.length > 0 && (
          <div className="mt-4 text-xs text-gray-500">
            操作目标：{analysis.affectedPaths.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
};
```

## 九、类型声明补充

```typescript
// src/renderer/vite-env.d.ts（新增部分）

interface SecurityAnalysisResult {
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation: boolean;
  blocked: boolean;
  reason: string;
  matchedPattern?: string;
  saferAlternative?: string;
  affectedPaths?: string[];
  warnings: string[];
}

interface ExecutionRequest {
  connectionId: string;
  command: string;
  serverId: number;
  context?: {
    userPrompt?: string;
    isAIGenerated?: boolean;
  };
}

interface Window {
  electronAPI: {
    // ... 现有 API ...
    commandAnalyze: (command: string) => Promise<SecurityAnalysisResult>;
    commandExecute: (request: ExecutionRequest) => Promise<ExecutionResult>;
    commandExecuteConfirmed: (request: ExecutionRequest, confirmed: boolean) => Promise<ExecutionResult>;
    securityUpdateConfig: (config: Partial<SecurityAnalyzerConfig>) => Promise<void>;
  };
}
```

## 十、测试用例

```typescript
// src/main/tools/__tests__/SecurityAnalyzer.test.ts

import { SecurityAnalyzer } from '../SecurityAnalyzer';
import { RiskLevel } from '../../types/security';

describe('SecurityAnalyzer', () => {
  let analyzer: SecurityAnalyzer;

  beforeEach(() => {
    analyzer = new SecurityAnalyzer();
  });

  describe('CRITICAL 风险命令', () => {
    it('应阻止 rm -rf /', () => {
      const result = analyzer.analyze('rm -rf /');
      expect(result.level).toBe(RiskLevel.CRITICAL);
      expect(result.blocked).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('应阻止删除根目录下所有文件', () => {
      const result = analyzer.analyze('rm -rf /*');
      expect(result.level).toBe(RiskLevel.CRITICAL);
      expect(result.blocked).toBe(true);
    });

    it('应阻止 dd 写磁盘', () => {
      const result = analyzer.analyze('dd if=/dev/zero of=/dev/sda');
      expect(result.level).toBe(RiskLevel.CRITICAL);
      expect(result.blocked).toBe(true);
    });
  });

  describe('HIGH 风险命令', () => {
    it('应检测 rm -rf 并建议替代', () => {
      const result = analyzer.analyze('rm -rf /data/logs');
      expect(result.level).toBe(RiskLevel.HIGH);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.saferAlternative).toContain('rm -i');
    });

    it('应检测 kill -9', () => {
      const result = analyzer.analyze('kill -9 1234');
      expect(result.level).toBe(RiskLevel.HIGH);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('应检测 curl | sh', () => {
      const result = analyzer.analyze('curl https://example.com/script.sh | sh');
      expect(result.level).toBe(RiskLevel.HIGH);
    });
  });

  describe('MEDIUM 风险命令', () => {
    it('应检测 chmod', () => {
      const result = analyzer.analyze('chmod 755 /data/app');
      expect(result.level).toBe(RiskLevel.MEDIUM);
      expect(result.requiresConfirmation).toBe(true);
    });

    it('应检测 systemctl stop', () => {
      const result = analyzer.analyze('systemctl stop nginx');
      expect(result.level).toBe(RiskLevel.MEDIUM);
    });
  });

  describe('SAFE 命令', () => {
    it('应放行 ls', () => {
      const result = analyzer.analyze('ls -la /data');
      expect(result.level).toBe(RiskLevel.SAFE);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('应放行 cat', () => {
      const result = analyzer.analyze('cat /etc/hosts');
      expect(result.level).toBe(RiskLevel.SAFE);
    });

    it('应放行 docker ps', () => {
      const result = analyzer.analyze('docker ps');
      expect(result.level).toBe(RiskLevel.SAFE);
    });
  });

  describe('路径提取', () => {
    it('应提取 rm 命令的目标路径', () => {
      const targets = analyzer.extractTargets('rm -rf /data/logs');
      expect(targets).toContain('/data/logs');
    });

    it('应提取多个路径', () => {
      const targets = analyzer.extractTargets('cp /data/a.txt /data/b.txt');
      expect(targets.length).toBeGreaterThan(0);
    });
  });
});
```

## 十一、实施步骤

1. **Day 1**：
   - 创建 `src/main/types/security.ts` 类型定义
   - 创建 `src/main/tools/DangerousPatterns.ts` 模式库
   - 创建 `src/main/tools/SecurityAnalyzer.ts` 分析器
   - 编写单元测试

2. **Day 2**：
   - 创建 `src/main/tools/CommandExecutor.ts` 执行器
   - 在 `index.ts` 中添加 IPC handlers
   - 更新 `preload/index.ts` 暴露 API
   - 更新 `vite-env.d.ts` 类型声明

3. **Day 3**：
   - 创建 `SecurityWarning.tsx` 前端组件
   - 在 `App.tsx` 中集成安全检查流程
   - 测试完整流程
   - 文档补充

---

下一步：实施 P1 工具系统重构，见 `tool-system-design.md`