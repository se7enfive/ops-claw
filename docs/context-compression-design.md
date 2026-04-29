# P2：分层上下文压缩设计

> 优先级：中（成本控制，Token 预算管理）
> 预计工作量：2 天
> 前置依赖：P0、P1

## 一、设计目标

防止上下文无限增长导致：
1. **API 成本飙升**：每次请求携带过多历史，Token 数量失控
2. **响应变慢**：模型需要处理更多历史内容
3. **关键信息淹没**：过多历史导致 AI 遗忘重要上下文

实现：
- **Token 预算追踪**：实时监控输入/输出 Token 消耗
- **智能压缩引擎**：保留关键信息，压缩冗余输出
- **分层摘要**：按重要性分级处理历史
- **自动触发机制**：达到阈值自动触发压缩

## 二、核心类型定义

```typescript
// src/main/context/TokenBudget.ts

/** Token 预算状态 */
export interface BudgetState {
  inputUsed: number;        // 已使用输入 Token
  inputBudget: number;      // 输入 Token 预算上限
  outputUsed: number;       // 已使用输出 Token
  outputBudget: number;     // 输出 Token 预算上限
  warningLevel: 'none' | 'warning' | 'critical' | 'exceeded';
  percentUsed: number;      // 使用百分比
  remaining: number;        // 剩余 Token
  shouldCompact: boolean;   // 是否应该触发压缩
}

/** 预算配置 */
export interface BudgetConfig {
  inputBudget: number;      // 默认 100000（根据模型调整）
  outputBudget: number;     // 默认 4000
  warningThreshold: number; // 警告阈值百分比，默认 70%
  criticalThreshold: number;// 临界阈值百分比，默认 85%
  autoCompactThreshold: number; // 自动压缩阈值，默认 80%
}

/** Token 计算结果 */
export interface TokenCountResult {
  total: number;
  breakdown: {
    messages: number;
    tools: number;
    context: number;
    systemPrompt: number;
  };
}

/** 预算追踪器 */
export class TokenBudgetTracker {
  private config: BudgetConfig;
  private inputUsed: number = 0;
  private outputUsed: number = 0;

  private readonly DEFAULT_CONFIG: BudgetConfig = {
    inputBudget: 100000,      // Claude Code 默认约 100K
    outputBudget: 4000,
    warningThreshold: 70,
    criticalThreshold: 85,
    autoCompactThreshold: 80,
  };

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
  }

  /**
   * 追踪 API 调用消耗
   */
  trackUsage(inputTokens: number, outputTokens: number): BudgetState {
    this.inputUsed += inputTokens;
    this.outputUsed += outputTokens;

    return this.getState();
  }

  /**
   * 获取当前状态
   */
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

  /**
   * 重置预算（新会话）
   */
  reset(): void {
    this.inputUsed = 0;
    this.outputUsed = 0;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 估算消息 Token 数量（简化算法）
   * 真实 Token 需调用 API tokenizer，这里用估算
   */
  estimateTokens(content: string): number {
    // 简化估算：英文约 4 字符 = 1 token，中文约 2 字符 = 1 token
    const englishChars = content.replace(/[^\x00-\x7F]/g, '').length;
    const chineseChars = content.replace(/[\x00-\x7F]/g, '').length;
    
    return Math.ceil(englishChars / 4 + chineseChars / 2);
  }

  /**
   * 估算消息数组 Token
   */
  estimateMessagesTokens(messages: any[]): TokenCountResult {
    let messagesTokens = 0;
    let toolsTokens = 0;
    let contextTokens = 0;
    let systemPromptTokens = 0;

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPromptTokens += this.estimateTokens(msg.content);
      } else if (msg.role === 'tool') {
        toolsTokens += this.estimateTokens(msg.content);
      } else {
        messagesTokens += this.estimateTokens(msg.content);
      }

      // 工具调用/结果的额外计算
      if (msg.toolCalls) {
        toolsTokens += this.estimateTokens(JSON.stringify(msg.toolCalls));
      }
      if (msg.toolResult) {
        toolsTokens += this.estimateTokens(msg.toolResult);
      }
    }

    return {
      total: messagesTokens + toolsTokens + contextTokens + systemPromptTokens,
      breakdown: {
        messages,
        tools,
        context,
        systemPrompt,
      },
    };
  }
}
```

```typescript
// src/main/context/CompactEngine.ts

import { CommandHistory, TaskStep, SessionContext } from './SessionContext';
import { TokenBudgetTracker } from './TokenBudget';

/** 压缩策略 */
export interface CompactStrategy {
  preserveRecentCommands: number;   // 保留最近 N 条完整命令
  preserveRecentSteps: number;      // 保留最近 N 条任务步骤
  maxOutputLength: number;          // 输出截断长度
  maxMessageAge: number;            // 消息最大保留时长（分钟）
  summarizeThreshold: number;       // 超过此数量的历史开始摘要
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
  tokenReduction: number;    // 估计节省的 Token 数
}

/** 默认压缩策略 */
const DEFAULT_STRATEGY: CompactStrategy = {
  preserveRecentCommands: 3,
  preserveRecentSteps: 5,
  maxOutputLength: 500,
  maxMessageAge: 30,
  summarizeThreshold: 10,
};

/** 压缩引擎 */
export class CompactEngine {
  private budgetTracker: TokenBudgetTracker;
  private strategy: CompactStrategy;

  constructor(
    budgetTracker: TokenBudgetTracker,
    strategy?: Partial<CompactStrategy>
  ) {
    this.budgetTracker = budgetTracker;
    this.strategy = { ...DEFAULT_STRATEGY, ...strategy };
  }

  /**
   * 执行压缩
   */
  compact(context: SessionContext): CompactResult {
    const { recentCommands = [], taskHistory = [] } = context;

    // 1. 分离保留和压缩部分
    const preservedCommands = recentCommands.slice(-this.strategy.preserveRecentCommands);
    const commandsToSummarize = recentCommands.slice(0, -this.strategy.preserveRecentCommands);

    const preservedSteps = taskHistory.slice(-this.strategy.preserveRecentSteps);
    const stepsToSummarize = taskHistory.slice(0, -this.strategy.preserveRecentSteps);

    // 2. 生成摘要
    const commandsSummary = this.summarizeCommands(commandsToSummarize);
    const stepsSummary = this.summarizeSteps(stepsToSummarize);

    // 3. 计算节省的 Token
    const originalTokens = this.budgetTracker.estimateMessagesTokens([
      ...recentCommands.map(c => ({ role: 'system', content: c.output })),
      ...taskHistory.map(s => ({ role: 'system', content: s.content })),
    ]).total;

    const compressedTokens = this.budgetTracker.estimateTokens(
      (commandsSummary || '') + (stepsSummary || '')
    );

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
      tokenReduction: originalTokens - compressedTokens,
    };
  }

  /**
   * 自动压缩（根据预算状态）
   */
  autoCompact(context: SessionContext): CompactResult | null {
    const state = this.budgetTracker.getState();
    
    if (!state.shouldCompact) {
      return null;
    }

    console.log(`触发自动压缩：Token 使用 ${state.percentUsed}%`);
    return this.compact(context);
  }

  /**
   * 应用压缩结果到上下文
   */
  applyCompact(context: SessionContext, result: CompactResult): SessionContext {
    const newContext: SessionContext = {
      ...context,
      recentCommands: result.preserved.commands,
      taskHistory: result.preserved.steps,
    };

    // 如果有摘要，添加到上下文作为历史备注
    if (result.summarized.commandsSummary) {
      newContext.taskHistory = [
        {
          timestamp: new Date().toISOString(),
          action: 'analysis',
          content: `历史命令摘要：${result.summarized.commandsSummary}`,
        },
        ...newContext.taskHistory,
      ];
    }

    return newContext;
  }

  // ===== 私有方法 =====

  /**
   * 摘要命令历史
   */
  private summarizeCommands(commands: CommandHistory[]): string | undefined {
    if (commands.length === 0) return undefined;

    // 按命令类型分组统计
    const successCount = commands.filter(c => c.exitCode === 0).length;
    const failCount = commands.filter(c => c.exitCode !== 0).length;
    const categories = this.groupCommandsByCategory(commands);

    const summary = `执行了 ${commands.length} 条命令（${successCount} 成功，${failCount} 失败）`;
    const details = Object.entries(categories)
      .map(([cat, cmds]) => `${cat}: ${cmds.length} 条`)
      .join('、');

    return `${summary}。主要操作：${details}`;
  }

  /**
   * 摘要任务步骤
   */
  private summarizeSteps(steps: TaskStep[]): string | undefined {
    if (steps.length === 0) return undefined;

    const intentCount = steps.filter(s => s.action === 'intent').length;
    const commandCount = steps.filter(s => s.action === 'command').length;
    const resultCount = steps.filter(s => s.action === 'result').length;

    // 提取主要意图
    const intents = steps
      .filter(s => s.action === 'intent')
      .map(s => s.content)
      .slice(0, 3);

    return `进行了 ${intentCount} 次操作意图，执行 ${commandCount} 条命令，获得 ${resultCount} 个结果。主要目标：${intents.join('、')}`;
  }

  /**
   * 按类别分组命令
   */
  private groupCommandsByCategory(commands: CommandHistory[]): Record<string, CommandHistory[]> {
    const categories: Record<string, CommandHistory[]> = {};

    for (const cmd of commands) {
      const category = this.classifyCommand(cmd.command);
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(cmd);
    }

    return categories;
  }

  /**
   * 分类命令
   */
  private classifyCommand(command: string): string {
    const cmd = command.trim().split(' ')[0];

    if (['ls', 'pwd', 'cat', 'head', 'tail', 'less', 'grep', 'find'].includes(cmd)) {
      return '查看操作';
    }
    if (['rm', 'mv', 'cp', 'mkdir', 'touch'].includes(cmd)) {
      return '文件操作';
    }
    if (['chmod', 'chown'].includes(cmd)) {
      return '权限操作';
    }
    if (['ps', 'kill', 'top', 'htop'].includes(cmd)) {
      return '进程操作';
    }
    if (['docker', 'kubectl'].includes(cmd)) {
      return '容器操作';
    }
    if (['systemctl', 'service'].includes(cmd)) {
      return '服务操作';
    }
    if (['curl', 'wget', 'ping', 'netstat', 'ss'].includes(cmd)) {
      return '网络操作';
    }

    return '其他操作';
  }

  /**
   * 截断输出
   */
  private truncateOutput(output: string): string {
    if (output.length <= this.strategy.maxOutputLength) {
      return output;
    }
    return output.substring(0, this.strategy.maxOutputLength) + '\n...[已截断]';
  }
}
```

## 三、自动压缩触发器

```typescript
// src/main/context/AutoCompactTrigger.ts

import { TokenBudgetTracker, BudgetState } from './TokenBudget';
import { CompactEngine, CompactResult } from './CompactEngine';
import { SessionContext } from './SessionContext';
import { DatabaseManager } from '../services/DatabaseManager';

/** 压缩事件 */
export interface CompactEvent {
  serverId: number;
  trigger: 'manual' | 'auto_warning' | 'auto_critical' | 'auto_threshold';
  state: BudgetState;
  result: CompactResult;
  timestamp: string;
}

/** 自动压缩触发器 */
export class AutoCompactTrigger {
  private budgetTracker: TokenBudgetTracker;
  private compactEngine: CompactEngine;
  private db: DatabaseManager;
  
  // 记录每个服务器的压缩历史
  private compactHistory: Map<number, CompactEvent[]> = new Map();

  constructor(
    budgetTracker: TokenBudgetTracker,
    compactEngine: CompactEngine,
    db: DatabaseManager
  ) {
    this.budgetTracker = budgetTracker;
    this.compactEngine = compactEngine;
    this.db = db;
  }

  /**
   * 检查并触发压缩
   */
  checkAndTrigger(serverId: number): CompactResult | null {
    const context = this.db.getContext(serverId);
    const state = this.budgetTracker.getState();

    if (!state.shouldCompact) {
      return null;
    }

    const trigger = this.determineTrigger(state);
    const result = this.compactEngine.compact(context);

    if (result) {
      // 应用压缩
      const newContext = this.compactEngine.applyCompact(context, result);
      this.db.updateContext(serverId, newContext);

      // 记录压缩事件
      const event: CompactEvent = {
        serverId,
        trigger,
        state,
        result,
        timestamp: new Date().toISOString(),
      };
      this.recordCompactEvent(serverId, event);

      // 重置预算（压缩后重新计算）
      this.budgetTracker.reset();

      console.log(`自动压缩完成：节省 ${result.tokenReduction} Token`);
    }

    return result;
  }

  /**
   * 手动触发压缩
   */
  manualCompact(serverId: number): CompactResult {
    const context = this.db.getContext(serverId);
    const result = this.compactEngine.compact(context);
    const newContext = this.compactEngine.applyCompact(context, result);
    
    this.db.updateContext(serverId, newContext);

    const event: CompactEvent = {
      serverId,
      trigger: 'manual',
      state: this.budgetTracker.getState(),
      result,
      timestamp: new Date().toISOString(),
    };
    this.recordCompactEvent(serverId, event);

    return result;
  }

  /**
   * 获取压缩历史
   */
  getCompactHistory(serverId: number): CompactEvent[] {
    return this.compactHistory.get(serverId) || [];
  }

  /**
   * 获取压缩统计
   */
  getCompactStats(serverId: number): {
    totalCompacts: number;
    totalTokensSaved: number;
    lastCompactTime?: string;
  } {
    const history = this.getCompactHistory(serverId);
    
    return {
      totalCompacts: history.length,
      totalTokensSaved: history.reduce((sum, e) => sum + e.result.tokenReduction, 0),
      lastCompactTime: history[history.length - 1]?.timestamp,
    };
  }

  // ===== 私有方法 =====

  private determineTrigger(state: BudgetState): CompactEvent['trigger'] {
    if (state.warningLevel === 'exceeded') {
      return 'auto_critical';
    }
    if (state.warningLevel === 'critical') {
      return 'auto_critical';
    }
    if (state.warningLevel === 'warning') {
      return 'auto_warning';
    }
    return 'auto_threshold';
  }

  private recordCompactEvent(serverId: number, event: CompactEvent): void {
    if (!this.compactHistory.has(serverId)) {
      this.compactHistory.set(serverId, []);
    }
    this.compactHistory.get(serverId)!.push(event);

    // 只保留最近 10 次压缩历史
    const history = this.compactHistory.get(serverId)!;
    if (history.length > 10) {
      history.shift();
    }
  }
}
```

## 四、集成到 AI 调用流程

```typescript
// src/main/services/AIEngine.ts（修改）

import { TokenBudgetTracker } from '../context/TokenBudget';
import { CompactEngine } from '../context/CompactEngine';
import { AutoCompactTrigger } from '../context/AutoCompactTrigger';

export class AIEngine {
  private budgetTracker: TokenBudgetTracker;
  private compactEngine: CompactEngine;
  private autoCompactTrigger: AutoCompactTrigger | null = null;

  constructor() {
    this.budgetTracker = new TokenBudgetTracker();
    this.compactEngine = new CompactEngine(this.budgetTracker);
  }

  /**
   * 设置自动压缩触发器
   */
  setAutoCompactTrigger(trigger: AutoCompactTrigger): void {
    this.autoCompactTrigger = trigger;
  }

  /**
   * 生成命令（增加预算追踪和自动压缩）
   */
  async generateCommand(
    prompt: string,
    context: AIContext,
    config: AIConfig,
    serverId?: number
  ): Promise<AIGenerateResult> {
    // 检查是否需要压缩
    if (serverId && this.autoCompactTrigger) {
      this.autoCompactTrigger.checkAndTrigger(serverId);
    }

    // 构建系统提示（包含压缩后的历史摘要）
    const systemPrompt = this.buildSystemPrompt(context);

    // 估算输入 Token
    const estimatedInput = this.budgetTracker.estimateTokens(systemPrompt + prompt);

    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
      });

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      // 追踪实际 Token 使用（如果 API 返回）
      const actualInput = response.usage?.prompt_tokens || estimatedInput;
      const actualOutput = response.usage?.completion_tokens || 0;
      this.budgetTracker.trackUsage(actualInput, actualOutput);

      const content = response.choices[0]?.message?.content || '{}';
      return JSON.parse(content);

    } catch (error: any) {
      throw new Error(`AI 命令生成失败：${error.message}`);
    }
  }

  /**
   * 构建系统提示（包含压缩历史）
   */
  private buildSystemPrompt(context: AIContext): string {
    // ... 原有系统提示构建逻辑 ...

    // 添加压缩后的历史摘要
    if (context.historySummary) {
      return `${baseSystemPrompt}\n\n历史操作摘要：${context.historySummary}`;
    }

    return baseSystemPrompt;
  }

  /**
   * 获取预算状态
   */
  getBudgetState(): BudgetState {
    return this.budgetTracker.getState();
  }

  /**
   * 手动触发压缩
   */
  manualCompact(serverId: number): CompactResult | null {
    if (this.autoCompactTrigger) {
      return this.autoCompactTrigger.manualCompact(serverId);
    }
    return null;
  }
}
```

## 五、IPC Handlers

```typescript
// src/main/index.ts（新增部分）

// Token 预算
ipcMain.handle('budget:getState', () => {
  return aiEngine.getBudgetState();
});

// 手动压缩
ipcMain.handle('context:compact', (_event, serverId: number) => {
  return aiEngine.manualCompact(serverId);
});

// 压缩统计
ipcMain.handle('context:compactStats', (_event, serverId: number) => {
  return autoCompactTrigger?.getCompactStats(serverId);
});

// 更新预算配置
ipcMain.handle('budget:updateConfig', (_event, config: Partial<BudgetConfig>) => {
  budgetTracker.updateConfig(config);
});
```

## 六、前端预算显示组件

```tsx
// src/renderer/components/BudgetIndicator.tsx

import React from 'react';
import { BudgetState } from '../types/budget';

interface BudgetIndicatorProps {
  state: BudgetState;
  onCompact?: () => void;
}

const WARNING_COLORS = {
  none: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-orange-500',
  exceeded: 'bg-red-500',
};

export const BudgetIndicator: React.FC<BudgetIndicatorProps> = ({ state, onCompact }) => {
  const colorClass = WARNING_COLORS[state.warningLevel];
  const showCompactButton = state.shouldCompact || state.warningLevel !== 'none';

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100">
      {/* 进度条 */}
      <div className="flex-1 h-2 bg-gray-300 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClass} transition-all`}
          style={{ width: `${Math.min(state.percentUsed, 100)}%` }}
        />
      </div>

      {/* 百分比 */}
      <span className={`text-sm font-medium ${
        state.warningLevel === 'exceeded' ? 'text-red-600' :
        state.warningLevel === 'critical' ? 'text-orange-600' :
        'text-gray-600'
      }`}>
        {state.percentUsed}%
      </span>

      {/* 剩余 Token */}
      <span className="text-xs text-gray-500">
        {state.remaining.toLocaleString()} 剩余
      </span>

      {/* 压缩按钮 */}
      {showCompactButton && onCompact && (
        <button
          onClick={onCompact}
          className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          压缩历史
        </button>
      )}
    </div>
  );
};
```

## 七、预算状态轮询

```typescript
// src/renderer/App.tsx（新增部分）

const [budgetState, setBudgetState] = useState<BudgetState | null>(null);

// 定期获取预算状态
useEffect(() => {
  if (mode !== 'ai' || !activeTabId) return;

  const interval = setInterval(async () => {
    const state = await window.electronAPI.budgetGetState();
    setBudgetState(state);
  }, 5000);  // 每 5 秒更新

  return () => clearInterval(interval);
}, [mode, activeTabId]);

// 渲染预算指示器
{budgetState && (
  <BudgetIndicator
    state={budgetState}
    onCompact={() => window.electronAPI.contextCompact(activeTabId)}
  />
)}
```

## 八、实施步骤

1. **Day 1 上午**：
   - 创建 `TokenBudget.ts` 预算追踪器
   - 创建 `CompactEngine.ts` 压缩引擎
   - 测试估算算法

2. **Day 1 下午**：
   - 创建 `AutoCompactTrigger.ts` 自动触发器
   - 集成到 `AIEngine.ts`
   - 添加 IPC handlers

3. **Day 2 上午**：
   - 创建 `BudgetIndicator.tsx` 前端组件
   - 创建预算状态轮询
   - 更新 preload/vite-env.d.ts

4. **Day 2 下午**：
   - 测试完整流程
   - 调优压缩策略参数
   - 文档补充

---

下一步：实施 P2 Agent 协作模式，见 `agent-system-design.md`