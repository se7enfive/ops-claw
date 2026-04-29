/// <reference types="vite/client" />

interface SessionContext {
  currentDirectory?: string;
  lastExitCode?: number;
  environmentVars?: Record<string, string>;
  hostname?: string;
  taskGoal?: string;
  taskHistory?: TaskStep[];
  recentCommands?: CommandHistory[];
}

interface TaskStep {
  timestamp: string;
  action: 'intent' | 'command' | 'result' | 'analysis';
  content: string;
  command?: string;
  result?: string;
}

interface CommandHistory {
  command: string;
  output: string;
  exitCode: number;
  timestamp: string;
  directory?: string;
}

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

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  riskLevel: string;
}

interface ToolExecutionResult {
  toolName: string;
  success: boolean;
  data?: any;
  error?: string;
  state: string;
  durationMs: number;
  securityAnalysis?: SecurityAnalysisResult;
  validationError?: string;
  contextUpdates?: Partial<SessionContext>;
}

interface BudgetState {
  inputUsed: number;
  inputBudget: number;
  outputUsed: number;
  outputBudget: number;
  warningLevel: 'none' | 'warning' | 'critical' | 'exceeded';
  percentUsed: number;
  remaining: number;
  shouldCompact: boolean;
}

interface RecoveryInfo {
  hasRecovery: boolean;
  serverIds: number[];
  lastActivity?: string;
  entryCount: number;
}

type PermissionMode = 'standard' | 'cautious' | 'strict';

interface PermissionConfig {
  mode: PermissionMode;
  rules: { id: string; pattern: string; action: 'allow' | 'deny' | 'confirm'; description?: string }[];
}

interface SubTask {
  id: string;
  description: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  dependencies?: string[];
  expectedOutput?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_confirmation';
  result?: any;
  error?: string;
}

interface AgentConfig {
  name: string;
  displayName: string;
  description: string;
  priority: string;
  allowedTools: string[];
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

interface DecompositionResult {
  success: boolean;
  subTasks: SubTask[];
  reasoning: string;
  suggestedAgent?: string;
  tokenUsage?: TokenUsage;
}

interface AgentExecutionResult {
  agentName: string;
  success: boolean;
  subTasks: SubTask[];
  userPrompt?: string;
  overallOutput?: string;
  errors: string[];
  durationMs: number;
  analysis?: {
    summary: string;
    suggestions: string[];
    nextCommand?: string;
    nextCommandReason?: string;
  };
  tokenUsage?: TokenUsage;
}

// AI 配置类型
interface AIConfigItem {
  id: number;
  name: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  isDefault?: boolean;
  createdAt?: string;
}

interface Window {
  electronAPI: {
    serverList: () => Promise<any[]>;
    serverAdd: (config: any) => Promise<number>;
    serverDelete: (id: number) => Promise<void>;
    serverUpdate: (id: number, config: any) => Promise<void>;
    sshConnect: (serverId: number) => Promise<{ connectionId: string; success: boolean; error?: string }>;
    sshExecute: (connectionId: string, command: string) => Promise<{ success: boolean; stdout?: string; stderr?: string; exitCode?: number; error?: string }>;
    sshDisconnect: (connectionId: string) => Promise<void>;
    sshShellCreate: (connectionId: string, cols: number, rows: number) => Promise<{ sessionId: string; success: boolean; error?: string }>;
    sshShellWrite: (sessionId: string, data: string) => Promise<void>;
    sshShellResize: (sessionId: string, cols: number, rows: number) => Promise<void>;
    sshShellClose: (sessionId: string) => Promise<void>;
    onSshShellData: (callback: (payload: { sessionId: string; data: string }) => void) => () => void;
    onSshShellClose: (callback: (payload: { sessionId: string }) => void) => () => void;
    onSshShellError: (callback: (payload: { sessionId: string; error: string }) => void) => () => void;
    logWrite: (level: 'info' | 'warn' | 'error', scope: string, message: string, meta?: any) => Promise<void>;
    logPaths: () => Promise<{ logDirectory: string; appLogPath: string; errorLogPath: string }>;
    commandAnalyze: (command: string) => Promise<SecurityAnalysisResult>;
    toolExecute: (request: any) => Promise<ToolExecutionResult>;
    toolList: () => Promise<ToolInfo[]>;
    aiGenerate: (tabId: string, prompt: string, context: any) => Promise<{ command: string; explanation: string }>;
    aiAnalyze: (tabId: string, userPrompt: string, command: string, output: string, exitCode: number | undefined, context: any) => Promise<{ analysis: string; suggestions: string[]; nextCommand?: string; nextCommandReason?: string }>;
    // AI 配置管理
    aiListConfigs: () => Promise<AIConfigItem[]>;
    aiGetConfig: (id: number) => Promise<AIConfigItem>;
    aiGetActiveConfig: () => Promise<AIConfigItem>;
    aiAddConfig: (config: Omit<AIConfigItem, 'id'>) => Promise<number>;
    aiUpdateConfig: (id: number, config: Omit<AIConfigItem, 'id'>) => Promise<void>;
    aiDeleteConfig: (id: number) => Promise<void>;
    aiSetActiveConfig: (id: number) => Promise<void>;
    aiGetActiveConfigId: () => Promise<number>;
    contextGet: (tabId: string) => Promise<SessionContext>;
    contextUpdate: (tabId: string, updates: Partial<SessionContext>) => Promise<void>;
    contextClear: (tabId: string) => Promise<void>;
    contextSummary: (tabId: string) => Promise<string>;
    // 新增：带自动长度限制的历史添加
    contextAddTaskStep: (tabId: string, step: TaskStep) => Promise<SessionContext>;
    contextAddCommand: (tabId: string, command: CommandHistory) => Promise<SessionContext>;
    messageList: (tabId: string) => Promise<any[]>;
    messageSave: (tabId: string, message: any) => Promise<void>;
    messageClear: (tabId: string) => Promise<void>;
    budgetState: () => Promise<BudgetState>;
    budgetReset: () => Promise<BudgetState>;
    budgetCompact: (tabId: string) => Promise<{ budgetState: BudgetState; compactResult: any }>;
    recoveryCheck: () => Promise<RecoveryInfo>;
    recoveryGetData: (tabId: string) => Promise<any>;
    recoveryConfirm: () => Promise<void>;
    recoveryDismiss: () => Promise<void>;
    permissionGetConfig: () => Promise<PermissionConfig>;
    permissionSetMode: (mode: PermissionMode) => Promise<PermissionConfig>;
    permissionAddRule: (rule: { pattern: string; action: 'allow' | 'deny' | 'confirm'; description?: string }) => Promise<any>;
    permissionRemoveRule: (id: string) => Promise<boolean>;
    agentList: () => Promise<AgentConfig[]>;
    agentDecompose: (prompt: string, context: any) => Promise<DecompositionResult>;
    agentExecute: (agentName: string, subTasks: SubTask[], context: any, userPrompt: string) => Promise<AgentExecutionResult>;
    agentConfirm: (tabId: string, taskId: string, isConfirmed: boolean) => Promise<boolean>;
    onAgentProgress: (callback: (payload: { tabId: string; subTasks: SubTask[] }) => void) => () => void;
  };
}

