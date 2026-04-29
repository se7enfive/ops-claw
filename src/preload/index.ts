import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 服务器管理
  serverList: () => ipcRenderer.invoke('server:list'),
  serverAdd: (config: any) => ipcRenderer.invoke('server:add', config),
  serverDelete: (id: number) => ipcRenderer.invoke('server:delete', id),
  serverUpdate: (id: number, config: any) => ipcRenderer.invoke('server:update', id, config),
  
  // SSH 连接
  sshConnect: (serverId: number) => ipcRenderer.invoke('ssh:connect', serverId),
  sshExecute: (connectionId: string, command: string) => ipcRenderer.invoke('ssh:execute', connectionId, command),
  sshDisconnect: (connectionId: string) => ipcRenderer.invoke('ssh:disconnect', connectionId),
  sshShellCreate: (connectionId: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:shell:create', connectionId, cols, rows),
  sshShellWrite: (sessionId: string, data: string) => ipcRenderer.invoke('ssh:shell:write', sessionId, data),
  sshShellResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:shell:resize', sessionId, cols, rows),
  sshShellClose: (sessionId: string) => ipcRenderer.invoke('ssh:shell:close', sessionId),
  logWrite: (level: 'info' | 'warn' | 'error', scope: string, message: string, meta?: any) => ipcRenderer.invoke('log:write', level, scope, message, meta),
  logPaths: () => ipcRenderer.invoke('log:paths'),
  onSshShellData: (callback: (payload: { sessionId: string; data: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; data: string }) => callback(payload);
    ipcRenderer.on('ssh:shell:data', listener);
    return () => ipcRenderer.removeListener('ssh:shell:data', listener);
  },
  onSshShellClose: (callback: (payload: { sessionId: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string }) => callback(payload);
    ipcRenderer.on('ssh:shell:close', listener);
    return () => ipcRenderer.removeListener('ssh:shell:close', listener);
  },
  onSshShellError: (callback: (payload: { sessionId: string; error: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; error: string }) => callback(payload);
    ipcRenderer.on('ssh:shell:error', listener);
    return () => ipcRenderer.removeListener('ssh:shell:error', listener);
  },

  // 命令安全分析
  commandAnalyze: (command: string) => ipcRenderer.invoke('command:analyze', command),

  // 工具系统
  toolExecute: (request: any) => ipcRenderer.invoke('tool:execute', request),
  toolList: () => ipcRenderer.invoke('tool:list'),

  // AI 功能
  aiGenerate: (tabId: string, prompt: string, context: any) => ipcRenderer.invoke('ai:generate', tabId, prompt, context),
  aiAnalyze: (tabId: string, userPrompt: string, command: string, output: string, exitCode: number | undefined, context: any) => ipcRenderer.invoke('ai:analyze', tabId, userPrompt, command, output, exitCode, context),

  // AI 配置管理
  aiListConfigs: () => ipcRenderer.invoke('ai:listConfigs'),
  aiGetConfig: (id: number) => ipcRenderer.invoke('ai:getConfig', id),
  aiGetActiveConfig: () => ipcRenderer.invoke('ai:getActiveConfig'),
  aiAddConfig: (config: any) => ipcRenderer.invoke('ai:addConfig', config),
  aiUpdateConfig: (id: number, config: any) => ipcRenderer.invoke('ai:updateConfig', id, config),
  aiDeleteConfig: (id: number) => ipcRenderer.invoke('ai:deleteConfig', id),
  aiSetActiveConfig: (id: number) => ipcRenderer.invoke('ai:setActiveConfig', id),
  aiGetActiveConfigId: () => ipcRenderer.invoke('ai:getActiveConfigId'),

  // 上下文管理
  contextGet: (serverId: number) => ipcRenderer.invoke('context:get', serverId),
  contextUpdate: (serverId: number, updates: any) => ipcRenderer.invoke('context:update', serverId, updates),
  contextClear: (serverId: number) => ipcRenderer.invoke('context:clear', serverId),
  contextSummary: (serverId: number) => ipcRenderer.invoke('context:summary', serverId),
  // 新增：带自动长度限制的历史添加
  contextAddTaskStep: (tabId: string, step: any) => ipcRenderer.invoke('context:addTaskStep', tabId, step),
  contextAddCommand: (tabId: string, command: any) => ipcRenderer.invoke('context:addCommand', tabId, command),

  // 聊天记录
  messageList: (serverId: number) => ipcRenderer.invoke('message:list', serverId),
  messageSave: (serverId: number, message: any) => ipcRenderer.invoke('message:save', serverId, message),
  messageClear: (serverId: number) => ipcRenderer.invoke('message:clear', serverId),

  // Token 预算管理
  budgetState: () => ipcRenderer.invoke('budget:state'),
  budgetReset: () => ipcRenderer.invoke('budget:reset'),
  budgetCompact: (serverId: number) => ipcRenderer.invoke('budget:compact', serverId),

  // 会话恢复
  recoveryCheck: () => ipcRenderer.invoke('recovery:check'),
  recoveryGetData: (serverId: number) => ipcRenderer.invoke('recovery:getData', serverId),
  recoveryConfirm: () => ipcRenderer.invoke('recovery:confirm'),
  recoveryDismiss: () => ipcRenderer.invoke('recovery:dismiss'),

  // 权限管理
  permissionGetConfig: () => ipcRenderer.invoke('permission:getConfig'),
  permissionSetMode: (mode: string) => ipcRenderer.invoke('permission:setMode', mode),
  permissionAddRule: (rule: any) => ipcRenderer.invoke('permission:addRule', rule),
  permissionRemoveRule: (id: string) => ipcRenderer.invoke('permission:removeRule', id),

  // Agent 系统
  agentList: () => ipcRenderer.invoke('agent:list'),
  agentDecompose: (prompt: string, context: any) => ipcRenderer.invoke('agent:decompose', prompt, context),
  agentExecute: (agentName: string, subTasks: any[], context: any, userPrompt: string) => ipcRenderer.invoke('agent:execute', agentName, subTasks, context, userPrompt),
  agentConfirm: (tabId: string, taskId: string, isConfirmed: boolean) => ipcRenderer.invoke('agent:confirm', tabId, taskId, isConfirmed),
  onAgentProgress: (callback: (payload: { tabId: string; subTasks: any[] }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { tabId: string; subTasks: any[] }) => callback(payload);
    ipcRenderer.on('agent:progress', listener);
    return () => ipcRenderer.removeListener('agent:progress', listener);
  },
});
