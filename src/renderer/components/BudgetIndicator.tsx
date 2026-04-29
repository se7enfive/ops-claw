import React, { useEffect, useState, useCallback } from 'react';

interface BudgetIndicatorProps {
  tabId: string | null;
  visible: boolean;
}

const WARNING_COLORS: Record<string, string> = {
  none: 'bg-green-500',
  warning: 'bg-yellow-500',
  critical: 'bg-orange-500',
  exceeded: 'bg-red-500',
};

const WARNING_BG: Record<string, string> = {
  none: 'bg-green-100/50 dark:bg-green-500/20 border-green-300 dark:border-green-600/50',
  warning: 'bg-yellow-100/50 dark:bg-yellow-500/20 border-yellow-300 dark:border-yellow-600/50',
  critical: 'bg-orange-100/50 dark:bg-orange-500/20 border-orange-300 dark:border-orange-600/50',
  exceeded: 'bg-red-100/50 dark:bg-red-500/20 border-red-300 dark:border-red-600/50',
};

export const BudgetIndicator: React.FC<BudgetIndicatorProps> = ({ tabId, visible }) => {
  const [budgetState, setBudgetState] = useState<BudgetState | null>(null);
  const [compacting, setCompacting] = useState(false);

  const fetchBudget = useCallback(async () => {
    try {
      const state = await window.electronAPI.budgetState();
      setBudgetState(state);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    fetchBudget();
    const interval = setInterval(fetchBudget, 10000); // 每 10 秒刷新
    return () => clearInterval(interval);
  }, [visible, fetchBudget]);

  const handleCompact = async () => {
    if (!tabId || compacting) return;
    setCompacting(true);
    try {
      const { budgetState: newState } = await window.electronAPI.budgetCompact(tabId);
      setBudgetState(newState);
    } catch {
      // ignore
    }
    setCompacting(false);
  };

  if (!visible || !budgetState) return null;

  const { percentUsed, warningLevel, inputUsed, inputBudget, remaining } = budgetState;
  const barColor = WARNING_COLORS[warningLevel] || 'bg-green-500';
  const bgClass = WARNING_BG[warningLevel] || WARNING_BG.none;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${bgClass}`}>
      {/* 进度条 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">Token</span>
        <div className="w-20 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(100, percentUsed)}%` }}
          />
        </div>
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {percentUsed}%
        </span>
      </div>

      {/* 数值 */}
      <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap hidden sm:inline">
        {(inputUsed / 1000).toFixed(1)}k / {(inputBudget / 1000).toFixed(0)}k
      </span>

      {/* 压缩按钮 */}
      {budgetState.shouldCompact && (
        <button
          onClick={handleCompact}
          disabled={compacting}
          className="px-2 py-0.5 bg-yellow-600 dark:bg-yellow-700 hover:bg-yellow-500 dark:hover:bg-yellow-600 text-yellow-100 dark:text-yellow-200 rounded text-xs transition whitespace-nowrap disabled:opacity-50"
        >
          {compacting ? '压缩中...' : '压缩'}
        </button>
      )}
    </div>
  );
};
