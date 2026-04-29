import React from 'react';

interface SecurityWarningProps {
  analysis: SecurityAnalysisResult;
  command: string;
  onConfirm: () => void;
  onCancel: () => void;
  onUseAlternative?: (alternative: string) => void;
}

const RISK_COLORS: Record<string, string> = {
  safe: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-400 dark:border-green-600',
  low: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-600',
  medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-400 dark:border-yellow-600',
  high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-400 dark:border-orange-600',
  critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-400 dark:border-red-600',
};

const RISK_LABELS: Record<string, string> = {
  safe: '安全',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '极高风险',
};

const RISK_ICONS: Record<string, string> = {
  safe: '✅',
  low: '🔵',
  medium: '⚠️',
  high: '🔶',
  critical: '🔴',
};

export const SecurityWarning: React.FC<SecurityWarningProps> = ({
  analysis,
  command,
  onConfirm,
  onCancel,
  onUseAlternative,
}) => {
  const colorClass = RISK_COLORS[analysis.level] || RISK_COLORS.medium;
  const label = RISK_LABELS[analysis.level] || '未知';
  const icon = RISK_ICONS[analysis.level] || '⚠️';

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
      <div className={`max-w-lg w-full mx-4 p-6 rounded-xl border-2 bg-white dark:bg-gray-800 ${colorClass} shadow-2xl`}>
        {/* 标题 */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">{icon}</span>
          <div className={`px-3 py-1 rounded-full text-sm font-bold ${colorClass}`}>
            {label}
          </div>
          <h3 className="font-bold text-lg text-gray-800 dark:text-white">命令安全警告</h3>
        </div>

        {/* 命令显示 */}
        <div className="bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 p-3 rounded-lg mb-4 font-mono text-sm overflow-x-auto border border-gray-200 dark:border-gray-700">
          <code>{command}</code>
        </div>

        {/* 原因 */}
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{analysis.reason}</p>

        {/* 警告列表 */}
        {analysis.warnings.length > 0 && (
          <ul className="mb-4 space-y-1">
            {analysis.warnings.map((warning, i) => (
              <li key={i} className="text-sm flex items-start gap-2 text-gray-600 dark:text-gray-300">
                <span className="text-yellow-500 dark:text-yellow-400 shrink-0">⚠</span>
                {warning}
              </li>
            ))}
          </ul>
        )}

        {/* 受影响路径 */}
        {analysis.affectedPaths && analysis.affectedPaths.length > 0 && (
          <div className="mb-4 p-2 bg-gray-100/50 dark:bg-gray-900/50 rounded border border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">受影响路径：</div>
            {analysis.affectedPaths.map((p, i) => (
              <div key={i} className="font-mono text-xs text-gray-700 dark:text-gray-300">{p}</div>
            ))}
          </div>
        )}

        {/* 安全替代 */}
        {analysis.saferAlternative && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg">
            <div className="text-sm font-medium text-green-600 dark:text-green-400 mb-1">
              💡 建议使用安全替代：
            </div>
            <div className="font-mono text-sm text-green-700 dark:text-green-300">
              {analysis.saferAlternative}
            </div>
            {onUseAlternative && (
              <button
                onClick={() => onUseAlternative(analysis.saferAlternative!)}
                className="mt-2 px-3 py-1 bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-500 dark:hover:bg-green-600 transition text-sm"
              >
                使用替代命令
              </button>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg transition"
          >
            取消执行
          </button>
          {!analysis.blocked && (
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-lg transition font-medium ${
                analysis.level === 'high' || analysis.level === 'critical'
                  ? 'bg-red-600 dark:bg-red-700 hover:bg-red-500 dark:hover:bg-red-600 text-white'
                  : 'bg-yellow-600 dark:bg-yellow-700 hover:bg-yellow-500 dark:hover:bg-yellow-600 text-white'
              }`}
            >
              确认执行
            </button>
          )}
          {analysis.blocked && (
            <div className="text-sm text-red-600 dark:text-red-400 flex items-center">
              🚫 此命令已被安全策略禁止
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
