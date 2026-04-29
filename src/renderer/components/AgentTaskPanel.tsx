import React from 'react';

interface AgentTaskPanelProps {
  agentName: string;
  subTasks: SubTask[];
  onExecute: () => void;
  onExecuteNext?: (command: string) => void;
  onConfirmTask?: (taskId: string, isConfirmed: boolean) => void;
  isExecuting: boolean;
  isCompleted: boolean;
  overallOutput?: string;
  analysis?: {
    summary: string;
    suggestions: string[];
    nextCommand?: string;
    nextCommandReason?: string;
  };
}

const STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-500 border-gray-200',
  running: 'bg-blue-50 text-blue-600 border-blue-200 animate-pulse',
  completed: 'bg-green-50 text-green-600 border-green-200',
  failed: 'bg-red-50 text-red-600 border-red-200',
  skipped: 'bg-yellow-50 text-yellow-600 border-yellow-200',
  awaiting_confirmation: 'bg-orange-50 text-orange-600 border-orange-200 animate-pulse',
};

const STATUS_LABELS = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  failed: '已失败',
  skipped: '已跳过',
  awaiting_confirmation: '等待确认',
};

export const AgentTaskPanel: React.FC<AgentTaskPanelProps> = ({
  agentName,
  subTasks,
  onExecute,
  onExecuteNext,
  isExecuting,
  isCompleted,
  analysis,
}) => {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500"></div>
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Agent 任务计划: <span className="text-blue-600 dark:text-blue-400">{agentName}</span>
          </span>
        </div>
        {!isExecuting && !isCompleted && (
          <button
            onClick={onExecute}
            className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md transition-colors shadow-sm active:scale-95"
          >
            开始执行
          </button>
        )}
        {isExecuting && (
          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
            <svg className="animate-spin h-3 w-3 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            执行中...
          </span>
        )}
        {isCompleted && (
          <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
            任务已完成
          </span>
        )}
      </div>

      {/* SubTasks List */}
      <div className="p-2 space-y-1">
        {subTasks.map((task) => (
          <div key={task.id} className="flex flex-col">
            <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors group">
              <div className={`w-16 text-[10px] text-center py-0.5 rounded-full border ${STATUS_COLORS[task.status]}`}>
                {STATUS_LABELS[task.status]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                  {task.description}
                </div>
                {task.toolName && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    工具: <code className="bg-gray-100 dark:bg-gray-900 px-1 rounded text-gray-500">{task.toolName}</code>
                  </div>
                )}
              </div>
              {task.error && task.status !== 'awaiting_confirmation' && (
                <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded max-w-[200px] truncate" title={task.error}>
                  {task.error}
                </div>
              )}
            </div>
            
            {/* Awaiting Confirmation Buttons */}
            {task.status === 'awaiting_confirmation' && (
              <div className="ml-16 mr-2 mb-2 p-2 bg-orange-50/50 dark:bg-orange-900/10 rounded border border-orange-100 dark:border-orange-800 flex items-center justify-between">
                <div className="text-[11px] text-orange-700 dark:text-orange-400">
                  {task.error || '该命令需要您确认执行'}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onConfirmTask && onConfirmTask(task.id, false)}
                    className="px-2 py-1 text-[10px] text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded shadow-sm"
                  >
                    拒绝
                  </button>
                  <button
                    onClick={() => onConfirmTask && onConfirmTask(task.id, true)}
                    className="px-2 py-1 text-[10px] text-white bg-orange-500 hover:bg-orange-600 rounded shadow-sm"
                  >
                    允许执行
                  </button>
                </div>
              </div>
            )}
            
            {/* SubTask Output Display */}
            {task.status === 'completed' && task.result && (
              <div className="ml-16 mr-2 mb-2 p-2 bg-gray-900 rounded border border-gray-800 text-gray-100 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-48 custom-scrollbar">
                {task.result.stdout || task.result.stderr || '执行成功，无输出'}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* AI Analysis Section */}
      {analysis && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {/* Summary */}
          <div className="px-4 py-3 bg-purple-50/50 dark:bg-purple-900/10">
            <div className="text-[10px] font-bold text-purple-600 dark:text-purple-400 mb-1.5 uppercase tracking-wider">AI 分析与总结</div>
            <div className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
              {analysis.summary}
            </div>
          </div>

          {/* Suggestions */}
          {analysis.suggestions && analysis.suggestions.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-blue-50/30 dark:bg-blue-900/5">
              <div className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mb-1.5 uppercase tracking-wider">建议</div>
              <div className="space-y-1.5">
                {analysis.suggestions.map((suggestion, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <span className="shrink-0 w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-[10px] font-semibold mt-0.5">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed">{suggestion}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Step */}
          {analysis.nextCommand && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-amber-50/30 dark:bg-amber-900/5">
              <div className="text-[10px] font-bold text-amber-600 dark:text-amber-400 mb-1.5 uppercase tracking-wider">推荐下一步</div>
              {analysis.nextCommandReason && (
                <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 leading-relaxed">{analysis.nextCommandReason}</div>
              )}
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-gray-900 dark:bg-gray-950 text-gray-100 px-3 py-2 rounded-md break-all">
                  {analysis.nextCommand}
                </code>
                {onExecuteNext && (
                  <button
                    onClick={() => onExecuteNext(analysis.nextCommand!)}
                    className="shrink-0 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium rounded-md transition-colors shadow-sm active:scale-95"
                  >
                    执行
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
