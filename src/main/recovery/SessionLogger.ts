import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/** 日志条目类型 */
export type TranscriptEntryType =
  | 'session_start'
  | 'session_end'
  | 'user_intent'
  | 'ai_command'
  | 'command_execute'
  | 'command_result'
  | 'context_update';

/** 日志条目 */
export interface TranscriptEntry {
  timestamp: string;
  type: TranscriptEntryType;
  tabId: string;
  data: Record<string, unknown>;
}

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES = 3;

/**
 * 只追加日志器（JSON Lines 格式）
 * 用于崩溃恢复：记录关键操作，应用重启后可回放
 */
export class SessionLogger {
  private logDir: string;
  private currentLogPath: string;
  private writeStream: fs.WriteStream | null = null;

  constructor() {
    this.logDir = path.join(app.getPath('userData'), 'session-logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.currentLogPath = path.join(this.logDir, 'session.jsonl');
    this.openStream();
  }

  /** 写入日志条目 */
  log(type: TranscriptEntryType, tabId: string, data: Record<string, unknown>): void {
    const entry: TranscriptEntry = {
      timestamp: new Date().toISOString(),
      type,
      tabId,
      data,
    };

    try {
      if (this.writeStream) {
        this.writeStream.write(JSON.stringify(entry) + '\n');
      }
    } catch {
      // 日志写入失败不影响主流程
    }

    this.checkRotation();
  }

  /** 读取所有日志条目 */
  readEntries(): TranscriptEntry[] {
    const entries: TranscriptEntry[] = [];

    try {
      if (!fs.existsSync(this.currentLogPath)) return entries;

      const content = fs.readFileSync(this.currentLogPath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch {
          // 跳过损坏的行
        }
      }
    } catch {
      // 读取失败返回空
    }

    return entries;
  }

  /** 读取指定标签页的最近 N 条日志 */
  readTabEntries(tabId: string, limit = 50): TranscriptEntry[] {
    return this.readEntries()
      .filter(e => e.tabId === tabId)
      .slice(-limit);
  }

  /** 清空日志（会话正常结束时） */
  clear(): void {
    this.closeStream();
    try {
      if (fs.existsSync(this.currentLogPath)) {
        fs.unlinkSync(this.currentLogPath);
      }
    } catch {
      // ignore
    }
    this.openStream();
  }

  /** 检查是否有未完成的会话（用于崩溃恢复检测） */
  hasUnfinishedSession(): boolean {
    const entries = this.readEntries();
    if (entries.length === 0) return false;

    // 检查最后一个 session_start 是否有对应的 session_end
    const lastStart = [...entries].reverse().find(e => e.type === 'session_start');
    if (!lastStart) return false;

    const lastEnd = [...entries].reverse().find(e => e.type === 'session_end');
    if (!lastEnd) return true;

    // start 晚于 end，说明有未结束的会话
    return new Date(lastStart.timestamp) > new Date(lastEnd.timestamp);
  }

  /** 获取可恢复的标签 ID 列表 */
  getRecoverableTabIds(): string[] {
    const entries = this.readEntries();
    const tabIds = new Set<string>();

    for (const entry of entries) {
      if (entry.type !== 'session_end') {
        tabIds.add(entry.tabId);
      }
    }

    return Array.from(tabIds);
  }

  /** 关闭流 */
  close(): void {
    this.closeStream();
  }

  // ===== 私有方法 =====

  private openStream(): void {
    try {
      this.writeStream = fs.createWriteStream(this.currentLogPath, { flags: 'a' });
    } catch {
      this.writeStream = null;
    }
  }

  private closeStream(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  private checkRotation(): void {
    try {
      if (!fs.existsSync(this.currentLogPath)) return;

      const stats = fs.statSync(this.currentLogPath);
      if (stats.size < MAX_LOG_SIZE) return;

      // 轮转
      this.closeStream();

      for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
        const src = path.join(this.logDir, `session.${i}.jsonl`);
        const dst = path.join(this.logDir, `session.${i + 1}.jsonl`);
        if (fs.existsSync(src)) {
          if (i + 1 >= MAX_LOG_FILES) {
            fs.unlinkSync(src);
          } else {
            fs.renameSync(src, dst);
          }
        }
      }

      fs.renameSync(this.currentLogPath, path.join(this.logDir, 'session.1.jsonl'));
      this.openStream();
    } catch {
      // 轮转失败不影响主流程
    }
  }
}
