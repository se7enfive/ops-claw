import React from 'react';

type PermissionMode = 'standard' | 'cautious' | 'strict';

interface PermissionModeSelectorProps {
  currentMode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
}

const MODES: { value: PermissionMode; label: string; icon: string; description: string }[] = [
  { value: 'standard', label: '标准', icon: '🟢', description: '仅高危命令需确认' },
  { value: 'cautious', label: '谨慎', icon: '🟡', description: '中风险以上需确认' },
  { value: 'strict', label: '严格', icon: '🔴', description: '所有非只读命令需确认' },
];

export const PermissionModeSelector: React.FC<PermissionModeSelectorProps> = ({
  currentMode,
  onModeChange,
}) => {
  return (
    <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800">
      {MODES.map(({ value, label, icon }) => (
        <button
          key={value}
          onClick={() => onModeChange(value)}
          title={MODES.find(m => m.value === value)?.description}
          className={`px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1 ${
            currentMode === value
              ? 'bg-green-600 dark:bg-green-500 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <span className="text-[10px]">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
};
