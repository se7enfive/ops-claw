import React from 'react';

interface RecoveryPromptProps {
  tabIds: string[];
  lastActivity?: string;
  entryCount: number;
  onRecover: () => void;
  onDismiss: () => void;
}

export const RecoveryPrompt: React.FC<RecoveryPromptProps> = ({
  tabIds,
  lastActivity,
  entryCount,
  onRecover,
  onDismiss,
}) => {
  const timeAgo = lastActivity
    ? formatTimeAgo(new Date(lastActivity))
    : '未知时间';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
      <div className="max-w-md w-full mx-4 p-6 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 shadow-2xl">
        {/* 图标 + 标题 */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-3xl">🔄</span>
          <div>
            <h3 className="font-bold text-lg text-gray-800 dark:text-white">检测到未完成的会话</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">应用上次可能未正常关闭</p>
          </div>
        </div>

        {/* 信息 */}
        <div className="bg-gray-100/50 dark:bg-gray-900/50 rounded-lg p-3 mb-4 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">涉及标签页</span>
            <span>{tabIds.length} 个</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">操作记录</span>
            <span>{entryCount} 条</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">最后活动</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          恢复将还原上次会话的上下文信息（工作目录、任务目标等），帮助 AI 续接之前的工作。
        </p>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition text-sm"
          >
            忽略，开始新会话
          </button>
          <button
            onClick={onRecover}
            className="flex-1 px-4 py-2 bg-green-600 dark:bg-green-700 hover:bg-green-500 dark:hover:bg-green-600 text-white rounded-lg transition text-sm font-medium"
          >
            恢复会话
          </button>
        </div>
      </div>
    </div>
  );
};

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;

  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}
