import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { CredentialManager } from './credential-manager';
import { logError, serializeError } from './logger';

export interface ServerConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  type: 'linux' | 'windows';
}

export interface AIConfigItem {
  id: number;
  name: string;
  endpoint: string;
  apiKey?: string;  // 存储时不保存，用 CredentialManager
  model: string;
  isDefault?: boolean;
  createdAt?: string;
}

interface AppData {
  servers: ServerConfig[];
  aiConfigs: AIConfigItem[];  // 多个 AI 配置
  activeAIConfigId: number;   // 当前激活的配置 ID
  messages: Record<string, ChatMessage[]>;
  contexts: Record<string, SessionContext>;
}

const AI_API_KEY_CREDENTIAL_PREFIX = 'ai_config_';

const DEFAULT_DATA: AppData = {
  servers: [],
  aiConfigs: [{
    id: 1,
    name: '默认配置',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo',
    isDefault: true,
  }],
  activeAIConfigId: 1,
  messages: {},
  contexts: {}
};

export class DatabaseManager {
  private dataPath: string;
  private data: AppData;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.dataPath = path.join(userDataPath, 'ops-claw-data.json');
    this.data = this.loadData();
  }

  private loadData(): AppData {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const loaded = JSON.parse(raw);
        return { ...JSON.parse(JSON.stringify(DEFAULT_DATA)), ...loaded };
      }
    } catch (e) {
      logError('database', '加载数据失败', serializeError(e));
    }
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }

  private saveData(): void {
    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      logError('database', '保存数据失败', serializeError(e));
    }
  }

  getServers(): ServerConfig[] {
    return this.data.servers.map(s => ({ ...s, password: undefined })); // 不返回密码
  }

  getServer(id: number): ServerConfig | undefined {
    return this.data.servers.find(s => s.id === id);
  }

  async addServer(config: Omit<ServerConfig, 'id'>): Promise<number> {
    const newId = this.data.servers.length > 0 ? Math.max(...this.data.servers.map(s => s.id)) + 1 : 1;
    const { password, ...safeConfig } = config;
    const newServer: ServerConfig = { ...safeConfig, id: newId };

    this.data.servers.push(newServer);

    if (password) {
      await CredentialManager.savePassword(`server_${newId}`, password);
    }

    this.saveData();
    return newId;
  }

  async getServerWithPassword(id: number): Promise<ServerConfig | undefined> {
    const server = this.data.servers.find(s => s.id === id);
    if (server) {
      server.password = await CredentialManager.getPassword(`server_${id}`) || undefined;
    }
    return server;
  }

  async deleteServer(id: number): Promise<void> {
    this.data.servers = this.data.servers.filter(s => s.id !== id);
    delete this.data.messages[id];
    await CredentialManager.deletePassword(`server_${id}`);
    this.saveData();
  }

  async updateServer(id: number, config: Omit<ServerConfig, 'id'>): Promise<void> {
    const idx = this.data.servers.findIndex(s => s.id === id);
    if (idx === -1) throw new Error('Server not found');
    const { password, ...safeConfig } = config;
    this.data.servers[idx] = { ...safeConfig, id };
    if (password) {
      await CredentialManager.savePassword(`server_${id}`, password);
    }
    this.saveData();
  }

  // ===== AI 配置管理（增删改查）=====

  /**
   * 获取所有 AI 配置列表
   */
  getAIConfigs(): AIConfigItem[] {
    return this.data.aiConfigs.map(c => ({ ...c, apiKey: undefined }));
  }

  /**
   * 获取单个 AI 配置（带 apiKey）
   */
  async getAIConfig(id: number): Promise<AIConfigItem | undefined> {
    const config = this.data.aiConfigs.find(c => c.id === id);
    if (!config) return undefined;

    // 从 CredentialManager 获取 apiKey
    const apiKey = await CredentialManager.getPassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${id}`) || '';
    return { ...config, apiKey };
  }

  /**
   * 获取当前激活的 AI 配置
   */
  async getActiveAIConfig(): Promise<AIConfigItem | undefined> {
    const activeId = this.data.activeAIConfigId;
    return this.getAIConfig(activeId);
  }

  /**
   * 添加 AI 配置
   */
  async addAIConfig(config: Omit<AIConfigItem, 'id'>): Promise<number> {
    const newId = this.data.aiConfigs.length > 0
      ? Math.max(...this.data.aiConfigs.map(c => c.id)) + 1
      : 1;

    const newConfig: AIConfigItem = {
      id: newId,
      name: config.name,
      endpoint: config.endpoint,
      model: config.model,
      isDefault: config.isDefault || false,
      createdAt: new Date().toISOString(),
    };

    this.data.aiConfigs.push(newConfig);

    // 保存 apiKey 到 CredentialManager
    if (config.apiKey) {
      await CredentialManager.savePassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${newId}`, config.apiKey);
    }

    // 如果是第一个配置，自动设为激活
    if (this.data.aiConfigs.length === 1) {
      this.data.activeAIConfigId = newId;
    }

    this.saveData();
    return newId;
  }

  /**
   * 更新 AI 配置
   */
  async updateAIConfig(id: number, config: Omit<AIConfigItem, 'id'>): Promise<void> {
    const idx = this.data.aiConfigs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error('AI config not found');

    const { apiKey, ...safeConfig } = config;
    this.data.aiConfigs[idx] = {
      ...safeConfig,
      id,
      createdAt: this.data.aiConfigs[idx].createdAt || new Date().toISOString(),
    };

    if (apiKey) {
      await CredentialManager.savePassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${id}`, apiKey);
    }

    this.saveData();
  }

  /**
   * 删除 AI 配置
   */
  async deleteAIConfig(id: number): Promise<void> {
    const config = this.data.aiConfigs.find(c => c.id === id);
    if (!config) return;

    // 不允许删除默认配置（至少保留一个）
    if (config.isDefault && this.data.aiConfigs.length === 1) {
      throw new Error('不能删除唯一的配置');
    }

    this.data.aiConfigs = this.data.aiConfigs.filter(c => c.id !== id);
    await CredentialManager.deletePassword(`${AI_API_KEY_CREDENTIAL_PREFIX}${id}`);

    // 如果删除的是当前激活的配置，切换到第一个
    if (this.data.activeAIConfigId === id && this.data.aiConfigs.length > 0) {
      this.data.activeAIConfigId = this.data.aiConfigs[0].id;
    }

    this.saveData();
  }

  /**
   * 设置激活的 AI 配置
   */
  setActiveAIConfig(id: number): void {
    const config = this.data.aiConfigs.find(c => c.id === id);
    if (!config) throw new Error('AI config not found');
    this.data.activeAIConfigId = id;
    this.saveData();
  }

  /**
   * 获取当前激活配置的 ID
   */
  getActiveAIConfigId(): number {
    return this.data.activeAIConfigId;
  }

  getMessages(tabId: string): ChatMessage[] {
    return this.data.messages[tabId] || [];
  }

  saveMessage(tabId: string, message: ChatMessage): void {
    if (!this.data.messages[tabId]) {
      this.data.messages[tabId] = [];
    }
    this.data.messages[tabId].push(message);
    this.saveData();
  }

  deleteServerMessages(tabId: string): void {
    delete this.data.messages[tabId];
    this.saveData();
  }

  // 会话上下文管理
  getContext(tabId: string): SessionContext {
    return this.data.contexts[tabId] || {
      recentCommands: [],
      taskHistory: [],
      environmentVars: {}
    };
  }

  updateContext(tabId: string, updates: Partial<SessionContext>): void {
    const current = this.getContext(tabId);
    this.data.contexts[tabId] = { ...current, ...updates };
    this.saveData();
  }

  // 添加命令到历史（保留最近10条）
  addCommandToHistory(tabId: string, command: CommandHistory): void {
    const context = this.getContext(tabId);
    const recentCommands = context.recentCommands || [];
    recentCommands.push(command);
    // 保留最近10条
    if (recentCommands.length > 10) {
      recentCommands.shift();
    }
    this.updateContext(tabId, { recentCommands });
  }

  // 添加任务步骤
  addTaskStep(tabId: string, step: TaskStep): void {
    const context = this.getContext(tabId);
    const taskHistory = context.taskHistory || [];
    taskHistory.push(step);
    // 保留最近20条步骤
    if (taskHistory.length > 20) {
      taskHistory.shift();
    }
    this.updateContext(tabId, { taskHistory });
  }

  // 清除上下文（开始新任务）
  clearContext(tabId: string): void {
    delete this.data.contexts[tabId];
    this.saveData();
  }

  // 构建用于 AI 的历史摘要
  buildHistorySummary(serverId: number): string {
    const context = this.getContext(serverId);
    const parts: string[] = [];

    // 当前目录
    if (context.currentDirectory) {
      parts.push(`当前工作目录: ${context.currentDirectory}`);
    }

    // 主机名
    if (context.hostname) {
      parts.push(`主机名: ${context.hostname}`);
    }

    // 任务历史
    if (context.taskHistory && context.taskHistory.length > 0) {
      parts.push('\n最近的操作历史:');
      const recentSteps = context.taskHistory.slice(-5);
      for (const step of recentSteps) {
        if (step.action === 'intent') {
          parts.push(`- 用户意图: ${step.content}`);
        } else if (step.action === 'command') {
          parts.push(`- 执行命令: ${step.command || step.content}`);
        } else if (step.action === 'result') {
          parts.push(`- 结果: ${step.result || step.content}`);
        }
      }
    }

    // 最近命令历史
    if (context.recentCommands && context.recentCommands.length > 0) {
      parts.push('\n最近执行的命令:');
      const recentCommands = context.recentCommands.slice(-3);
      for (const cmd of recentCommands) {
        const status = cmd.exitCode === 0 ? '成功' : '失败';
        parts.push(`- ${cmd.command} (${status}, 目录: ${cmd.directory || '未知'})`);
      }
    }

    return parts.join('\n');
  }
}
