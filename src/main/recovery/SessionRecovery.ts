import { SessionLogger, TranscriptEntry } from './SessionLogger';

/** 恢复信息 */
export interface RecoveryInfo {
  hasRecovery: boolean;
  tabIds: string[];
  lastActivity?: string;
  entryCount: number;
}

/** 恢复数据（某个标签页的） */
export interface ServerRecoveryData {
  tabId: string;
  lastIntent?: string;
  lastCommand?: string;
  lastResult?: string;
  contextUpdates: Record<string, unknown>;
  entries: TranscriptEntry[];
}

/** 崩溃恢复服务 */
export class SessionRecovery {
  private logger: SessionLogger;

  constructor(logger: SessionLogger) {
    this.logger = logger;
  }

  /** 检查是否有可恢复的会话 */
  checkRecovery(): RecoveryInfo {
    const hasRecovery = this.logger.hasUnfinishedSession();
    const tabIds = hasRecovery ? this.logger.getRecoverableTabIds() : [];
    const entries = hasRecovery ? this.logger.readEntries() : [];

    const lastEntry = entries[entries.length - 1];

    return {
      hasRecovery,
      tabIds,
      lastActivity: lastEntry?.timestamp,
      entryCount: entries.length,
    };
  }

  /** 获取某个标签页的恢复数据 */
  getServerRecoveryData(tabId: string): ServerRecoveryData {
    const entries = this.logger.readTabEntries(tabId);
    const contextUpdates: Record<string, unknown> = {};

    let lastIntent: string | undefined;
    let lastCommand: string | undefined;
    let lastResult: string | undefined;

    for (const entry of entries) {
      if (entry.type === 'user_intent') {
        lastIntent = entry.data.prompt as string;
      } else if (entry.type === 'ai_command') {
        lastCommand = entry.data.command as string;
      } else if (entry.type === 'command_result') {
        lastResult = entry.data.output as string;
      } else if (entry.type === 'context_update') {
        Object.assign(contextUpdates, entry.data);
      }
    }

    return {
      tabId,
      lastIntent,
      lastCommand,
      lastResult,
      contextUpdates,
      entries,
    };
  }

  /** 确认恢复完成，清空日志 */
  confirmRecovery(): void {
    this.logger.clear();
  }

  /** 拒绝恢复，清空日志 */
  dismissRecovery(): void {
    this.logger.clear();
  }
}
