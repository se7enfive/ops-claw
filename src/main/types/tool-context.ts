import { SessionContext } from '../database';

/** 工具执行上下文 */
export interface ToolUseContext {
  // ===== 会话信息 =====
  sessionId: string;
  serverId: number;
  connectionId?: string;
  shellSessionId?: string;

  // ===== 服务器信息 =====
  os: 'linux' | 'windows';

  // ===== 上下文信息 =====
  sessionContext: SessionContext;

  // ===== 用户信息 =====
  permissionMode: 'allow' | 'confirm' | 'deny';

  // ===== 可用工具列表 =====
  availableTools: string[];
}
