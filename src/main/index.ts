import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'path';
import { ServerManager } from './server-manager';
import { AIEngine, AIContext } from './ai-engine';
import { DatabaseManager, ServerConfig, AIConfigItem, CommandHistory, TaskStep, SessionContext } from './database';
import { getLogPaths, initializeLogger, logError, logInfo, logMessage, serializeError } from './logger';
import { SecurityAnalyzer } from './tools/SecurityAnalyzer';
import { ToolRegistry } from './tools/ToolRegistry';
import { ToolExecutor, ToolExecutionRequest } from './tools/ToolExecutor';
import { SSHExecuteTool } from './tools/implementations/SSHExecuteTool';
import { AIGenerateTool } from './tools/implementations/AIGenerateTool';
import { TokenBudgetTracker } from './context/TokenBudget';
import { CompactEngine } from './context/CompactEngine';
import { SessionLogger } from './recovery/SessionLogger';
import { SessionRecovery } from './recovery/SessionRecovery';
import { PermissionManager } from './tools/PermissionManager';
import { AgentCoordinator } from './agents/AgentCoordinator';
import { initializeAgentSystem } from './agents';
import { ToolUseContext } from './types/tool-context';
import { SubTask } from './agents/Agent';

let mainWindow: BrowserWindow | null = null;
let serverManager: ServerManager;
let aiEngine: AIEngine;
let db: DatabaseManager;
let securityAnalyzer: SecurityAnalyzer;
let toolRegistry: ToolRegistry;
let toolExecutor: ToolExecutor;
let budgetTracker: TokenBudgetTracker;
let compactEngine: CompactEngine;
let sessionLogger: SessionLogger;
let sessionRecovery: SessionRecovery;
let permissionManager: PermissionManager;
let agentCoordinator: AgentCoordinator;

function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 使用 app.isPackaged 检测开发/生产模式 (比 NODE_ENV 更可靠)
  // 开发模式: app.isPackaged = false
  // 生产模式: app.isPackaged = true (打包后)
  if (!app.isPackaged) {
    const url = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    mainWindow.loadURL(url);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'right' });
    });
  } else {
    // 生产模式: 加载打包后的文件
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  initializeLogger();
  logInfo('app', '应用启动');

  db = new DatabaseManager();
  serverManager = new ServerManager();
  aiEngine = new AIEngine();
  securityAnalyzer = new SecurityAnalyzer();

  // 初始化权限管理器
  permissionManager = new PermissionManager();

  // 初始化工具系统
  toolRegistry = new ToolRegistry();
  toolExecutor = new ToolExecutor(toolRegistry, securityAnalyzer, permissionManager);

  // 注册内置工具
  toolRegistry.register(new SSHExecuteTool(serverManager));
  toolRegistry.register(new AIGenerateTool(aiEngine));

  // 初始化 Token 预算与压缩引擎
  budgetTracker = new TokenBudgetTracker();
  compactEngine = new CompactEngine(budgetTracker);

  // 初始化会话恢复
  sessionLogger = new SessionLogger();
  sessionRecovery = new SessionRecovery(sessionLogger);

  // 初始化 Agent 系统
  agentCoordinator = initializeAgentSystem(toolExecutor, toolRegistry, aiEngine);

  createWindow();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logInfo('app', '所有窗口已关闭');
  // 记录会话正常结束
  sessionLogger?.log('session_end', 0, { reason: 'window_closed' });
  sessionLogger?.close();
  serverManager?.disconnectAll();
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  logError('process', '未捕获异常', serializeError(error));
});

process.on('unhandledRejection', (reason) => {
  logError('process', '未处理的 Promise 拒绝', serializeError(reason));
});

function setupIpcHandlers() {
  ipcMain.handle('log:write', (_event: Electron.IpcMainInvokeEvent, level: 'info' | 'warn' | 'error', scope: string, message: string, meta?: unknown) => {
    logMessage(level, scope, message, meta);
  });

  ipcMain.handle('log:paths', () => getLogPaths());

  // 命令安全分析（集成权限模式）
  ipcMain.handle('command:analyze', (_event: Electron.IpcMainInvokeEvent, command: string) => {
    const analysis = securityAnalyzer.analyze(command);

    // 用权限管理器覆写确认/拦截决策
    const permission = permissionManager.checkPermission(command, analysis.level);
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

    return analysis;
  });

  // 工具系统
  ipcMain.handle('tool:execute', async (_event: Electron.IpcMainInvokeEvent, request: ToolExecutionRequest) => {
    return toolExecutor.execute(request);
  });

  ipcMain.handle('tool:list', (_event: Electron.IpcMainInvokeEvent) => {
    const tools = toolRegistry.getAvailableTools();
    return tools.map(t => ({
      name: t.metadata.name,
      description: t.metadata.description,
      category: t.metadata.category,
      riskLevel: t.security.riskLevel,
    }));
  });

  // 服务器管理
  ipcMain.handle('server:list', () => db.getServers());
  ipcMain.handle('server:add', async (_event: Electron.IpcMainInvokeEvent, config: Omit<ServerConfig, 'id'>) => 
    await db.addServer(config)
  );
  ipcMain.handle('server:delete', async (_event: Electron.IpcMainInvokeEvent, id: number) =>
    await db.deleteServer(id)
  );
  ipcMain.handle('server:update', async (_event: Electron.IpcMainInvokeEvent, id: number, config: Omit<ServerConfig, 'id'>) =>
    await db.updateServer(id, config)
  );
  
  // SSH 连接
  ipcMain.handle('ssh:connect', async (_event: Electron.IpcMainInvokeEvent, serverId: number) => {
    const server = await db.getServerWithPassword(serverId);
    if (!server) return { success: false, error: 'Server not found' };
    return serverManager.connect(server);
  });
  ipcMain.handle('ssh:execute', (_event: Electron.IpcMainInvokeEvent, connectionId: string, command: string) => {
    return serverManager.execute(connectionId, command);
  });
  ipcMain.handle('ssh:disconnect', (_event: Electron.IpcMainInvokeEvent, connectionId: string) => {
    serverManager.disconnect(connectionId);
  });
  ipcMain.handle('ssh:shell:create', async (_event: Electron.IpcMainInvokeEvent, connectionId: string, cols: number, rows: number) => {
    return serverManager.createShellSession(
      connectionId,
      cols,
      rows,
      (sessionId, data) => mainWindow?.webContents.send('ssh:shell:data', { sessionId, data }),
      (sessionId) => mainWindow?.webContents.send('ssh:shell:close', { sessionId }),
      (sessionId, error) => mainWindow?.webContents.send('ssh:shell:error', { sessionId, error }),
    );
  });
  ipcMain.handle('ssh:shell:write', (_event: Electron.IpcMainInvokeEvent, sessionId: string, data: string) => {
    serverManager.writeToShell(sessionId, data);
  });
  ipcMain.handle('ssh:shell:resize', (_event: Electron.IpcMainInvokeEvent, sessionId: string, cols: number, rows: number) => {
    serverManager.resizeShell(sessionId, cols, rows);
  });
  ipcMain.handle('ssh:shell:close', (_event: Electron.IpcMainInvokeEvent, sessionId: string) => {
    serverManager.closeShell(sessionId);
  });

  // AI 命令生成 - 增强上下文感知
  ipcMain.handle('ai:generate', async (
    _event: Electron.IpcMainInvokeEvent,
    tabId: string,
    prompt: string,
    context: AIContext
  ) => {
    const config = await db.getActiveAIConfig();

    // 合并数据库中的上下文信息
    const dbContext = db.getContext(tabId);
    const mergedContext: AIContext = {
      ...context,
      currentDirectory: dbContext.currentDirectory || context.currentDirectory,
      hostname: dbContext.hostname || context.hostname,
      recentCommands: dbContext.recentCommands || [],
      taskGoal: dbContext.taskGoal || prompt  // 记录当前任务目标
    };

    // 记录用户意图
    db.addTaskStep(tabId, {
      timestamp: new Date().toISOString(),
      action: 'intent',
      content: prompt
    });
    sessionLogger.log('user_intent', tabId, { prompt });

    // 更新任务目标
    db.updateContext(tabId, { taskGoal: prompt });

    const result = await aiEngine.generateCommand(prompt, mergedContext, config);

    // 追踪 Token 消耗
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    // 记录 AI 生成的命令
    sessionLogger.log('ai_command', tabId, { command: result.command, explanation: result.explanation });

    return result;
  });

  ipcMain.handle('ai:analyze', async (
    _event: Electron.IpcMainInvokeEvent,
    tabId: string,
    userPrompt: string,
    command: string,
    output: string,
    exitCode: number | undefined,
    context: AIContext
  ) => {
    const config = await db.getActiveAIConfig();

    // 合并数据库中的上下文信息
    const dbContext = db.getContext(tabId);
    const mergedContext: AIContext = {
      ...context,
      currentDirectory: dbContext.currentDirectory || context.currentDirectory,
      hostname: dbContext.hostname || context.hostname,
      recentCommands: dbContext.recentCommands || [],
      taskGoal: dbContext.taskGoal
    };

    const result = await aiEngine.analyzeResult(userPrompt, command, output, exitCode, mergedContext, config);

    // 追踪 Token 消耗
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    // 记录命令执行结果
    db.addTaskStep(tabId, {
      timestamp: new Date().toISOString(),
      action: 'result',
      content: output.substring(0, 500),  // 截取前500字符
      command,
      result: `退出码: ${exitCode}`
    });

    // 添加命令到历史
    const cmdHistory: CommandHistory = {
      command,
      output: output.substring(0, 1000),  // 截取前1000字符
      exitCode: exitCode ?? 1,
      timestamp: new Date().toISOString(),
      directory: dbContext.currentDirectory
    };
    db.addCommandToHistory(tabId, cmdHistory);

    return result;
  });

  // 上下文管理
  ipcMain.handle('context:get', (_event: Electron.IpcMainInvokeEvent, tabId: string) =>
    db.getContext(tabId)
  );
  ipcMain.handle('context:update', (_event: Electron.IpcMainInvokeEvent, tabId: string, updates: Partial<SessionContext>) =>
    db.updateContext(tabId, updates)
  );
  ipcMain.handle('context:clear', (_event: Electron.IpcMainInvokeEvent, tabId: string) =>
    db.clearContext(tabId)
  );

  // 获取历史摘要（用于 AI prompt）
  ipcMain.handle('context:summary', (_event: Electron.IpcMainInvokeEvent, tabId: string) =>
    db.buildHistorySummary(tabId)
  );

  // 添加任务步骤（自动限制长度）
  ipcMain.handle('context:addTaskStep', (
    _event: Electron.IpcMainInvokeEvent,
    tabId: string,
    step: TaskStep
  ) => {
    db.addTaskStep(tabId, step);
    return db.getContext(tabId);
  });

  // 添加命令历史（自动限制长度）
  ipcMain.handle('context:addCommand', (
    _event: Electron.IpcMainInvokeEvent,
    tabId: string,
    command: CommandHistory
  ) => {
    db.addCommandToHistory(tabId, command);
    return db.getContext(tabId);
  });

  // AI 配置管理（增删改查）
  ipcMain.handle('ai:listConfigs', () => db.getAIConfigs());
  ipcMain.handle('ai:getConfig', async (_event: Electron.IpcMainInvokeEvent, id: number) =>
    await db.getAIConfig(id)
  );
  ipcMain.handle('ai:getActiveConfig', async () =>
    await db.getActiveAIConfig()
  );
  ipcMain.handle('ai:addConfig', async (_event: Electron.IpcMainInvokeEvent, config: Omit<AIConfigItem, 'id'>) =>
    await db.addAIConfig(config)
  );
  ipcMain.handle('ai:updateConfig', async (_event: Electron.IpcMainInvokeEvent, id: number, config: Omit<AIConfigItem, 'id'>) =>
    await db.updateAIConfig(id, config)
  );
  ipcMain.handle('ai:deleteConfig', async (_event: Electron.IpcMainInvokeEvent, id: number) =>
    await db.deleteAIConfig(id)
  );
  ipcMain.handle('ai:setActiveConfig', (_event: Electron.IpcMainInvokeEvent, id: number) =>
    db.setActiveAIConfig(id)
  );
  ipcMain.handle('ai:getActiveConfigId', () =>
    db.getActiveAIConfigId()
  );

  // 聊天记录
  ipcMain.handle('message:list', (_event: Electron.IpcMainInvokeEvent, tabId: string) =>
    db.getMessages(tabId)
  );
  ipcMain.handle('message:save', (_event: Electron.IpcMainInvokeEvent, tabId: string, message: any) =>
    db.saveMessage(tabId, message)
  );
  ipcMain.handle('message:clear', (_event: Electron.IpcMainInvokeEvent, tabId: string) =>
    db.deleteServerMessages(tabId)
  );

  // Token 预算管理
  ipcMain.handle('budget:state', () => budgetTracker.getState());

  ipcMain.handle('budget:reset', () => {
    budgetTracker.reset();
    return budgetTracker.getState();
  });

  ipcMain.handle('budget:compact', (_event: Electron.IpcMainInvokeEvent, tabId: string) => {
    const context = db.getContext(tabId);
    const result = compactEngine.compact(context);
    const newContext = compactEngine.applyCompact(context, result);
    db.updateContext(tabId, newContext);
    budgetTracker.reduceUsage(result.tokenReduction);
    return { budgetState: budgetTracker.getState(), compactResult: result };
  });

  // 会话恢复
  ipcMain.handle('recovery:check', () => sessionRecovery.checkRecovery());

  ipcMain.handle('recovery:getData', (_event: Electron.IpcMainInvokeEvent, tabId: string) =>
    sessionRecovery.getServerRecoveryData(tabId)
  );

  ipcMain.handle('recovery:confirm', () => {
    sessionRecovery.confirmRecovery();
    // 开始新会话
    sessionLogger.log('session_start', 0, { recovered: true });
  });

  ipcMain.handle('recovery:dismiss', () => {
    sessionRecovery.dismissRecovery();
    sessionLogger.log('session_start', 0, { recovered: false });
  });

  // 权限管理
  ipcMain.handle('permission:getConfig', () => permissionManager.getConfig());

  ipcMain.handle('permission:setMode', (_event: Electron.IpcMainInvokeEvent, mode: 'standard' | 'cautious' | 'strict') => {
    permissionManager.setMode(mode);
    return permissionManager.getConfig();
  });

  ipcMain.handle('permission:addRule', (_event: Electron.IpcMainInvokeEvent, rule: { pattern: string; action: 'allow' | 'deny' | 'confirm'; description?: string }) => {
    return permissionManager.addRule(rule);
  });

  ipcMain.handle('permission:removeRule', (_event: Electron.IpcMainInvokeEvent, id: string) => {
    return permissionManager.removeRule(id);
  });

  // Agent 系统 API
  ipcMain.handle('agent:list', () => {
    return agentCoordinator.getAvailableAgents();
  });

  ipcMain.handle('agent:decompose', async (
    _event: Electron.IpcMainInvokeEvent,
    prompt: string,
    context: ToolUseContext
  ) => {
    const tabId = context.sessionId;
    const config = await db.getActiveAIConfig();

    // 设置 AI 配置给 CompactEngine（用于智能摘要）
    compactEngine.setAIConfig(config);

    // Claude Code 方案：每次 AI 调用前检查预算，自动触发压缩
    const budgetState = budgetTracker.getState();
    if (budgetState.shouldCompact) {
      console.log(`[AutoCompact] Token 使用 ${budgetState.percentUsed}%，触发自动压缩`);

      // 获取当前上下文
      const currentContext = db.getContext(tabId);

      // 执行压缩（带 AI 智能摘要）
      const compactResult = await compactEngine.compactWithAISummary(
        currentContext,
        currentContext.taskGoal || prompt
      );

      // 应用压缩后的上下文
      const newContext = compactEngine.applyCompact(currentContext, compactResult);
      db.updateContext(tabId, newContext);

      // 更新预算（减去已压缩的 Token）
      budgetTracker.reduceUsage(compactResult.tokenReduction);

      console.log(`[AutoCompact] 完成，节省 ${compactResult.tokenReduction} Token`);

      // 如果 AI 智能摘要消耗了 Token，也需要追踪
      // （generateContextSummary 内部已返回 tokenUsage，但这里暂时不单独追踪）
    }

    // 获取最新上下文（可能在压缩后已更新）
    const latestContext = db.getContext(tabId);
    const updatedToolContext = {
      ...context,
      sessionContext: latestContext
    };

    const result = agentCoordinator.decomposeTask(prompt, updatedToolContext, config);

    // 等待结果并追踪 Token 消耗
    const decomposeResult = await result;
    if (decomposeResult.tokenUsage) {
      budgetTracker.trackUsage(decomposeResult.tokenUsage.promptTokens, decomposeResult.tokenUsage.completionTokens);
    }

    return decomposeResult;
  });

  ipcMain.handle('agent:execute', async (
    _event: Electron.IpcMainInvokeEvent,
    agentName: string,
    subTasks: SubTask[],
    context: ToolUseContext,
    userPrompt: string
  ) => {
    const tabId = context.sessionId; // 暂时用 sessionId 作为 tabId
    const config = await db.getActiveAIConfig();

    const result = await agentCoordinator.executeTask(
      agentName,
      subTasks,
      context,
      config,
      userPrompt,
      (updatedSubTasks) => {
        // 通过实时事件向前端推送执行进度
        mainWindow?.webContents.send('agent:progress', {
          tabId,
          subTasks: updatedSubTasks
        });
      }
    );

    // 追踪 Token 消耗
    if (result.tokenUsage) {
      budgetTracker.trackUsage(result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);
    }

    return result;
  });

  ipcMain.handle('agent:confirm', (
    _event: Electron.IpcMainInvokeEvent,
    tabId: string,
    taskId: string,
    isConfirmed: boolean
  ) => {
    return agentCoordinator.resolveConfirmation(tabId, taskId, isConfirmed);
  });
}