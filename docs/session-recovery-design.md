# P3：会话恢复机制设计

> 优先级：低（可靠性优化）
> 预计工作量：1 天
> 前置依赖：无

## 一、设计目标

防止进程崩溃导致会话数据丢失：
- **只追加日志**：每次操作写入日志文件，不修改已有内容
- **增量写入**：实时持久化，不依赖定时保存
- **崩溃恢复**：重启后从日志重建会话状态
- **日志轮转**：防止日志文件过大

## 二、核心类型定义

```typescript
// src/main/recovery/TranscriptEntry.ts

/** 日志条目类型 */
export type TranscriptAction = 
  | 'connect'
  | 'disconnect'
  | 'execute'
  | 'ai_generate'
  | 'ai_analyze'
  | 'context_update'
  | 'message_save';

/** 日志条目 */
export interface TranscriptEntry {
  // ===== 元数据 =====
  timestamp: string;           // ISO 时间戳
  sessionId: string;           // 会话 ID
  serverId: number;            // 服务器 ID
  sequence: number;            // 序号（递增）

  // ===== 操作信息 =====
  action: TranscriptAction;
  data: Record<string, unknown>;

  // ===== 结果信息 =====
  success?: boolean;
  error?: string;

  // ===== 校验信息 =====
  checksum?: string;           // 数据校验（可选）
}

/** 会话恢复状态 */
export interface RecoveryState {
  sessionId: string;
  serverId: number;
  recoveredFrom: string;       // 恢复来源日志文件
  recoveredAt: string;
  entriesCount: number;
  lastSequence: number;
  
  // 恢复后的状态
  state: {
    connected: boolean;
    connectionId?: string;
    messages: any[];
    context: SessionContext;
  };
}
```

## 三、会话日志器

```typescript
// src/main/recovery/SessionLogger.ts

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { TranscriptEntry, TranscriptAction } from './TranscriptEntry';
import { SessionContext } from '../context/SessionContext';
import { logError, logInfo } from '../logger';

/** 日志轮转配置 */
interface LogRotationConfig {
  maxFileSize: number;         // 最大文件大小（字节）
  maxFiles: number;            // 最大保留文件数
  rotateOnSize: boolean;       // 按大小轮转
}

/** 会话日志器 */
export class SessionLogger {
  private logDirectory: string;
  private currentLogFile: string;
  private sequence: number = 0;
  private rotationConfig: LogRotationConfig;

  private readonly DEFAULT_ROTATION_CONFIG: LogRotationConfig = {
    maxFileSize: 10 * 1024 * 1024,  // 10MB
    maxFiles: 10,
    rotateOnSize: true,
  };

  constructor(config?: Partial<LogRotationConfig>) {
    this.rotationConfig = { ...this.DEFAULT_ROTATION_CONFIG, ...config };
    
    // 日志目录：用户数据目录/session-logs/
    this.logDirectory = path.join(app.getPath('userData'), 'session-logs');
    this.ensureDirectory();
    
    // 当前日志文件：按日期命名
    this.currentLogFile = this.getLogFileName();
  }

  /**
   * 记录操作日志
   */
  recordTranscript(
    sessionId: string,
    serverId: number,
    action: TranscriptAction,
    data: Record<string, unknown>,
    success?: boolean,
    error?: string
  ): TranscriptEntry {
    const entry: TranscriptEntry = {
      timestamp: new Date().toISOString(),
      sessionId,
      serverId,
      sequence: ++this.sequence,
      action,
      data,
      success,
      error,
    };

    // 只追加写入
    this.appendLog(entry);

    return entry;
  }

  /**
   * 恢复会话状态
   */
  recoverSession(sessionId: string, serverId: number): RecoveryState | null {
    const logFiles = this.getLogFilesForSession(sessionId, serverId);
    
    if (logFiles.length === 0) {
      logInfo('recovery', `未找到会话日志: ${sessionId}`);
      return null;
    }

    const entries: TranscriptEntry[] = [];
    let lastSequence = 0;

    // 读取所有日志文件
    for (const file of logFiles) {
      const fileEntries = this.readLogFile(file);
      for (const entry of fileEntries) {
        if (entry.sessionId === sessionId && entry.serverId === serverId) {
          entries.push(entry);
          lastSequence = Math.max(lastSequence, entry.sequence);
        }
      }
    }

    // 按序号排序
    entries.sort((a, b) => a.sequence - b.sequence);

    // 重建状态
    const state = this.reconstructState(entries);

    return {
      sessionId,
      serverId,
      recoveredFrom: logFiles.join(','),
      recoveredAt: new Date().toISOString(),
      entriesCount: entries.length,
      lastSequence,
      state,
    };
  }

  /**
   * 清除会话日志
   */
  clearSessionLogs(sessionId: string, serverId: number): void {
    const logFiles = this.getLogFilesForSession(sessionId, serverId);
    for (const file of logFiles) {
      try {
        fs.unlinkSync(file);
      } catch (e) {
        logError('recovery', `删除日志文件失败: ${file}`);
      }
    }
  }

  /**
   * 获取日志统计
   */
  getLogStats(): {
    totalFiles: number;
    totalSize: number;
    oldestFile?: string;
    newestFile?: string;
  } {
    const files = this.getAllLogFiles();
    
    let totalSize = 0;
    for (const file of files) {
      try {
        totalSize += fs.statSync(file).size;
      } catch {}
    }

    return {
      totalFiles: files.length,
      totalSize,
      oldestFile: files[0],
      newestFile: files[files.length - 1],
    };
  }

  // ===== 私有方法 =====

  private ensureDirectory(): void {
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }
  }

  private getLogFileName(): string {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDirectory, `session-${date}.log`);
  }

  private appendLog(entry: TranscriptEntry): void {
    // 检查是否需要轮转
    if (this.rotationConfig.rotateOnSize) {
      this.checkRotation();
    }

    // 只追加写入
    const line = JSON.stringify(entry) + '\n';
    try {
      fs.appendFileSync(this.currentLogFile, line, 'utf-8');
    } catch (e) {
      logError('recovery', '写入日志失败', e);
    }
  }

  private checkRotation(): void {
    try {
      const stats = fs.statSync(this.currentLogFile);
      if (stats.size >= this.rotationConfig.maxFileSize) {
        this.rotateLog();
      }
    } catch {
      // 文件不存在，无需轮转
    }
  }

  private rotateLog(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedFile = path.join(
      this.logDirectory,
      `session-${timestamp}.log`
    );

    try {
      // 重命名当前文件
      fs.renameSync(this.currentLogFile, rotatedFile);
      
      // 更新当前文件名
      this.currentLogFile = this.getLogFileName();

      // 清理旧文件
      this.cleanOldFiles();

      logInfo('recovery', `日志轮转: ${rotatedFile}`);
    } catch (e) {
      logError('recovery', '日志轮转失败', e);
    }
  }

  private cleanOldFiles(): void {
    const files = this.getAllLogFiles();
    
    while (files.length > this.rotationConfig.maxFiles) {
      const oldest = files.shift();
      if (oldest) {
        try {
          fs.unlinkSync(oldest);
          logInfo('recovery', `删除旧日志: ${oldest}`);
        } catch (e) {
          logError('recovery', `删除旧日志失败: ${oldest}`);
        }
      }
    }
  }

  private getAllLogFiles(): string[] {
    const files = fs.readdirSync(this.logDirectory)
      .filter(f => f.startsWith('session-') && f.endsWith('.log'))
      .map(f => path.join(this.logDirectory, f))
      .sort();

    return files;
  }

  private getLogFilesForSession(sessionId: string, serverId: number): string[] {
    // 扫描所有日志文件，找出包含该会话的文件
    const allFiles = this.getAllLogFiles();
    const relevantFiles: string[] = [];

    for (const file of allFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.includes(sessionId) || content.includes(`"serverId":${serverId}`)) {
          relevantFiles.push(file);
        }
      } catch {}
    }

    return relevantFiles;
  }

  private readLogFile(filePath: string): TranscriptEntry[] {
    const entries: TranscriptEntry[] = [];
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as TranscriptEntry;
          entries.push(entry);
        } catch {
          // 忽略解析失败的行
        }
      }
    } catch (e) {
      logError('recovery', `读取日志文件失败: ${filePath}`);
    }

    return entries;
  }

  private reconstructState(entries: TranscriptEntry[]): RecoveryState['state'] {
    const state: RecoveryState['state'] = {
      connected: false,
      messages: [],
      context: {},
    };

    // 按序号重建状态
    for (const entry of entries) {
      switch (entry.action) {
        case 'connect':
          state.connected = entry.success === true;
          state.connectionId = entry.data.connectionId as string;
          break;

        case 'disconnect':
          state.connected = false;
          state.connectionId = undefined;
          break;

        case 'message_save':
          if (entry.success && entry.data.message) {
            state.messages.push(entry.data.message);
          }
          break;

        case 'context_update':
          if (entry.success && entry.data.updates) {
            state.context = { ...state.context, ...entry.data.updates as SessionContext };
          }
          break;

        // 其他操作不影响状态
      }
    }

    return state;
  }
}
```

## 四、会话恢复服务

```typescript
// src/main/recovery/SessionRecovery.ts

import { SessionLogger } from './SessionLogger';
import { RecoveryState } from './TranscriptEntry';
import { DatabaseManager } from '../services/DatabaseManager';
import { ServerManager } from '../services/ServerManager';
import { logInfo, logError } from '../logger';

/** 恢复选项 */
interface RecoveryOptions {
  reconnectIfConnected: boolean;  // 如果之前已连接，尝试重新连接
  restoreMessages: boolean;       // 恢复消息历史
  restoreContext: boolean;        // 恢复上下文
}

/** 会话恢复服务 */
export class SessionRecoveryService {
  private logger: SessionLogger;
  private db: DatabaseManager;
  private serverManager: ServerManager;

  private readonly DEFAULT_OPTIONS: RecoveryOptions = {
    reconnectIfConnected: false,  // 默认不自动重连（安全考虑）
    restoreMessages: true,
    restoreContext: true,
  };

  constructor(
    logger: SessionLogger,
    db: DatabaseManager,
    serverManager: ServerManager
  ) {
    this.logger = logger;
    this.db = db;
    this.serverManager = serverManager;
  }

  /**
   * 检查并恢复所有活跃会话
   */
  async recoverAll(options?: Partial<RecoveryOptions>): Promise<RecoveryState[]> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // 查找最近活跃的会话
    const activeSessions = this.findActiveSessions();
    
    const recovered: RecoveryState[] = [];
    
    for (const session of activeSessions) {
      try {
        const state = await this.recoverSession(session.sessionId, session.serverId, opts);
        if (state) {
          recovered.push(state);
          logInfo('recovery', `恢复会话成功: ${session.sessionId}`);
        }
      } catch (e) {
        logError('recovery', `恢复会话失败: ${session.sessionId}`, e);
      }
    }

    return recovered;
  }

  /**
   * 恢复单个会话
   */
  async recoverSession(
    sessionId: string,
    serverId: number,
    options?: Partial<RecoveryOptions>
  ): Promise<RecoveryState | null> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    // 从日志恢复状态
    const state = this.logger.recoverSession(sessionId, serverId);
    
    if (!state) {
      return null;
    }

    // 应用恢复的状态
    if (opts.restoreMessages && state.state.messages.length > 0) {
      // 消息已通过 DatabaseManager 保存，无需额外处理
    }

    if (opts.restoreContext) {
      this.db.updateContext(serverId, state.state.context);
    }

    // 如果之前已连接且启用了自动重连
    if (opts.reconnectIfConnected && state.state.connected) {
      try {
        const server = await this.db.getServerWithPassword(serverId);
        if (server) {
          await this.serverManager.connect(server);
        }
      } catch (e) {
        logError('recovery', `自动重连失败: ${serverId}`, e);
        state.state.connected = false;
      }
    }

    return state;
  }

  /**
   * 查找活跃会话
   */
  private findActiveSessions(): Array<{ sessionId: string; serverId: number }> {
    // 从最近的日志文件中找出活跃会话
    const stats = this.logger.getLogStats();
    
    if (!stats.newestFile) {
      return [];
    }

    // 简化实现：从数据库获取所有服务器
    const servers = this.db.getServers();
    return servers.map(s => ({
      sessionId: `session-${s.id}`,
      serverId: s.id,
    }));
  }

  /**
   * 获取恢复报告
   */
  getRecoveryReport(recovered: RecoveryState[]): string {
    const lines: string[] = [
      `会话恢复报告 (${new Date().toISOString()})`,
      `恢复会话数: ${recovered.length}`,
      '',
    ];

    for (const state of recovered) {
      lines.push(`服务器 ${state.serverId}:`);
      lines.push(`  - 恢复条目数: ${state.entriesCount}`);
      lines.push(`  - 消息数: ${state.state.messages.length}`);
      lines.push(`  - 连接状态: ${state.state.connected ? '已连接' : '未连接'}`);
    }

    return lines.join('\n');
  }
}
```

## 五、集成到主进程

```typescript
// src/main/index.ts（修改）

import { SessionLogger } from './recovery/SessionLogger';
import { SessionRecoveryService } from './recovery/SessionRecovery';

let sessionLogger: SessionLogger;
let recoveryService: SessionRecoveryService;

app.whenReady().then(() => {
  initializeLogger();
  logInfo('app', '应用启动');

  // 初始化
  db = new DatabaseManager();
  serverManager = new ServerManager();
  aiEngine = new AIEngine();

  // 初始化日志和恢复服务
  sessionLogger = new SessionLogger();
  recoveryService = new SessionRecoveryService(sessionLogger, db, serverManager);

  // 尝试恢复上次会话
  const recovered = recoveryService.recoverAll({ restoreMessages: true, restoreContext: true });
  if (recovered.length > 0) {
    logInfo('app', `恢复了 ${recovered.length} 个会话`);
  }

  createWindow();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 记录关键操作的日志钩子
function setupLoggingHooks(): void {
  // 连接
  ipcMain.handle('ssh:connect', async (_event, serverId: number) => {
    const result = await serverManager.connect(server);
    sessionLogger.recordTranscript(
      `session-${serverId}`,
      serverId,
      'connect',
      { serverId, connectionId: result.connectionId },
      result.success,
      result.error
    );
    return result;
  });

  // 断开
  ipcMain.handle('ssh:disconnect', async (_event, connectionId: string) => {
    const serverId = extractServerId(connectionId);
    sessionLogger.recordTranscript(
      `session-${serverId}`,
      serverId,
      'disconnect',
      { connectionId }
    );
    serverManager.disconnect(connectionId);
  });

  // 命令执行
  ipcMain.handle('ssh:execute', async (_event, connectionId: string, command: string) => {
    const serverId = extractServerId(connectionId);
    const result = serverManager.execute(connectionId, command);
    sessionLogger.recordTranscript(
      `session-${serverId}`,
      serverId,
      'execute',
      { command },
      result.success,
      result.error
    );
    return result;
  });

  // 消息保存
  ipcMain.handle('message:save', (_event, serverId: number, message: any) => {
    sessionLogger.recordTranscript(
      `session-${serverId}`,
      serverId,
      'message_save',
      { message },
      true
    );
    db.saveMessage(serverId, message);
  });

  // 上下文更新
  ipcMain.handle('context:update', (_event, serverId: number, updates: any) => {
    sessionLogger.recordTranscript(
      `session-${serverId}`,
      serverId,
      'context_update',
      { updates },
      true
    );
    db.updateContext(serverId, updates);
  });
}

// IPC handlers for recovery
ipcMain.handle('recovery:getStats', () => sessionLogger.getLogStats());
ipcMain.handle('recovery:recoverSession', (_event, sessionId: string, serverId: number) => 
  recoveryService.recoverSession(sessionId, serverId)
);
ipcMain.handle('recovery:clearLogs', (_event, sessionId: string, serverId: number) =>
  sessionLogger.clearSessionLogs(sessionId, serverId)
);
```

## 六、前端恢复提示

```tsx
// src/renderer/components/RecoveryPrompt.tsx

import React, { useEffect, useState } from 'react';

interface RecoveryPromptProps {
  recoveredSessions: RecoveryState[];
  onAccept: () => void;
  onReject: () => void;
}

export const RecoveryPrompt: React.FC<RecoveryPromptProps> = ({
  recoveredSessions,
  onAccept,
  onReject,
}) => {
  if (recoveredSessions.length === 0) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="max-w-md w-full mx-4 p-6 bg-white rounded-lg shadow-xl">
        <h3 className="font-bold text-lg mb-4">会话恢复</h3>
        
        <p className="text-gray-600 mb-4">
          发现上次未正常关闭的会话，是否恢复？
        </p>

        <ul className="mb-4 space-y-2">
          {recoveredSessions.map(s => (
            <li key={s.serverId} className="text-sm text-gray-500">
              服务器 {s.serverId}: {s.entriesCount} 条历史记录
            </li>
          ))}
        </ul>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onReject}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded"
          >
            不恢复
          </button>
          <button
            onClick={onAccept}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            恢复会话
          </button>
        </div>
      </div>
    </div>
  );
};

// App.tsx 中使用
useEffect(() => {
  // 应用启动时检查恢复
  window.electronAPI.recoveryGetStats().then(stats => {
    if (stats.totalFiles > 0) {
      setShowRecoveryPrompt(true);
    }
  });
}, []);
```

## 七、实施步骤

**半天**：
- 创建 `TranscriptEntry.ts` 类型
- 创建 `SessionLogger.ts` 日志器
- 创建 `SessionRecovery.ts` 恢复服务
- 集成到主进程
- 添加 IPC handlers

**半天**：
- 创建 `RecoveryPrompt.tsx` 前端组件
- 测试崩溃恢复流程
- 文档补充

---

下一步：实施 P3 渐进式权限 UI，见 `permission-ui-design.md`