import React, { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-preference';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export const ThemeToggle: React.FC = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);

    // 监听系统主题变化
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  const cycle = () => {
    setTheme((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'system';
      return 'light';
    });
  };

  const icon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '💻';
  const label = theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统';

  return (
    <button
      onClick={cycle}
      title={label}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
    >
      <span className="text-sm">{icon}</span>
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
};

/** 在 App 挂载前立即应用主题，避免闪白 */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
  const theme = saved || 'system';
  applyTheme(theme);
}
