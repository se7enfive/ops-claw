# P3：渐进式权限 UI 设计

> 优先级：低（用户体验优化）
> 预计工作量：1 天
> 前置依赖：P0 命令安全分析器

## 一、设计目标

遵循 Claude Code 的"渐进式暴露"原则：
- **基础用户**：只需输入问题，AI 自动处理
- **中级用户**：可查看安全警告，选择是否继续
- **高级用户**：可配置安全策略，添加白名单/黑名单

核心原则：
- **信任维系**：所有潜在破坏性操作默认需人工确认
- **随时中断**：执行过程中可随时 Ctrl+C 中断
- **可逆操作**：提供文件快照回滚机制

## 二、权限模式定义

```typescript
// src/main/types/PermissionMode.ts

/** 权限模式枚举 */
export enum PermissionMode {
  /** 允许模式：安全命令自动执行，危险命令需确认 */
  ALLOW = 'allow',
  
  /** 确认模式：所有命令都需要确认 */
  CONFIRM = 'confirm',
  
  /** 拒绝模式：只允许安全命令，拒绝所有危险操作 */
  DENY = 'deny',
}

/** 权限规则 */
export interface PermissionRule {
  id: string;
  name: string;
  description: string;
  
  // 规则类型
  type: 'whitelist' | 'blacklist' | 'pattern' | 'category';
  
  // 规则内容
  value: string | RegExp | RiskLevel[];
  
  // 生效范围
  scope: 'global' | 'server' | 'session';
  serverId?: number;
  
  // 优先级（越高越优先）
  priority: number;
  
  // 创建时间
  createdAt: string;
  
  // 是否启用
  enabled: boolean;
}

/** 权限配置 */
export interface PermissionConfig {
  mode: PermissionMode;
  rules: PermissionRule[];
  
  // 热键设置
  hotkeys: {
    interrupt: string;      // 中断执行，默认 Ctrl+C
    override: string;       // Override 禁止，默认 Ctrl+Shift+Enter
  };
  
  // UI 设置
  ui: {
    showRiskIndicator: boolean;  // 显示风险指示器
    showAlternative: boolean;    // 显示安全替代
    autoHideWarning: number;     // 警告自动隐藏时间（秒）
  };
}
```

## 三、权限管理器

```typescript
// src/main/tools/PermissionManager.ts

import { PermissionMode, PermissionRule, PermissionConfig } from '../types/PermissionMode';
import { RiskLevel, SecurityAnalysisResult } from '../types/security';

/** 默认权限配置 */
const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  mode: PermissionMode.ALLOW,
  rules: [],
  hotkeys: {
    interrupt: 'Ctrl+C',
    override: 'Ctrl+Shift+Enter',
  },
  ui: {
    showRiskIndicator: true,
    showAlternative: true,
    autoHideWarning: 0,  // 不自动隐藏
  },
};

/** 权限管理器 */
export class PermissionManager {
  private config: PermissionConfig;
  private userRules: PermissionRule[] = [];

  constructor(initialConfig?: Partial<PermissionConfig>) {
    this.config = { ...DEFAULT_PERMISSION_CONFIG, ...initialConfig };
  }

  /**
   * 检查权限
   */
  checkPermission(
    command: string,
    analysis: SecurityAnalysisResult,
    serverId?: number
  ): PermissionDecision {
    // 1. 检查白名单规则
    if (this.matchWhitelistRule(command, serverId)) {
      return { allowed: true, reason: '白名单规则匹配', needsConfirmation: false };
    }

    // 2. 检查黑名单规则
    if (this.matchBlacklistRule(command, serverId)) {
      return { allowed: false, reason: '黑名单规则匹配', needsConfirmation: false };
    }

    // 3. 根据权限模式判断
    switch (this.config.mode) {
      case PermissionMode.DENY:
        // 只允许安全命令
        if (analysis.level === RiskLevel.SAFE) {
          return { allowed: true, reason: '安全命令', needsConfirmation: false };
        }
        return { allowed: false, reason: '权限模式禁止', needsConfirmation: false };

      case PermissionMode.CONFIRM:
        // 所有命令都需要确认
        return { allowed: true, reason: '需要确认', needsConfirmation: true };

      case PermissionMode.ALLOW:
        // 根据风险等级
        if (analysis.level === RiskLevel.SAFE) {
          return { allowed: true, reason: '安全命令', needsConfirmation: false };
        }
        if (analysis.level === RiskLevel.LOW) {
          return { allowed: true, reason: '低风险命令', needsConfirmation: false };
        }
        return { allowed: true, reason: `${analysis.level}风险需要确认`, needsConfirmation: true };
    }
  }

  /**
   * 添加规则
   */
  addRule(rule: Omit<PermissionRule, 'id' | 'createdAt'>): PermissionRule {
    const newRule: PermissionRule = {
      ...rule,
      id: `rule-${Date.now()}`,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
    
    this.userRules.push(newRule);
    return newRule;
  }

  /**
   * 删除规则
   */
  removeRule(ruleId: string): boolean {
    const index = this.userRules.findIndex(r => r.id === ruleId);
    if (index >= 0) {
      this.userRules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取所有规则
   */
  getRules(serverId?: number): PermissionRule[] {
    return this.userRules.filter(r => {
      if (!r.enabled) return false;
      if (serverId && r.serverId && r.serverId !== serverId) return false;
      return true;
    });
  }

  /**
   * 更新权限模式
   */
  setMode(mode: PermissionMode): void {
    this.config.mode = mode;
  }

  /**
   * 获取当前配置
   */
  getConfig(): PermissionConfig {
    return { ...this.config, rules: this.userRules };
  }

  // ===== 私有方法 =====

  private matchWhitelistRule(command: string, serverId?: number): boolean {
    const rules = this.getRules(serverId);
    const whitelistRules = rules.filter(r => r.type === 'whitelist' && r.enabled);
    
    for (const rule of whitelistRules) {
      if (this.matchRule(command, rule)) {
        return true;
      }
    }
    
    return false;
  }

  private matchBlacklistRule(command: string, serverId?: number): boolean {
    const rules = this.getRules(serverId);
    const blacklistRules = rules.filter(r => r.type === 'blacklist' && r.enabled);
    
    for (const rule of blacklistRules) {
      if (this.matchRule(command, rule)) {
        return true;
      }
    }
    
    return false;
  }

  private matchRule(command: string, rule: PermissionRule): boolean {
    if (typeof rule.value === 'string') {
      return command.includes(rule.value);
    }
    if (rule.value instanceof RegExp) {
      return rule.value.test(command);
    }
    return false;
  }
}

/** 权限决策 */
interface PermissionDecision {
  allowed: boolean;
  reason: string;
  needsConfirmation: boolean;
}
```

## 四、前端权限 UI 组件

### 权限模式切换

```tsx
// src/renderer/components/PermissionModeSelector.tsx

import React from 'react';
import { PermissionMode } from '../types/permission';

interface PermissionModeSelectorProps {
  currentMode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

const MODE_CONFIGS = {
  [PermissionMode.ALLOW]: {
    label: '标准模式',
    description: '安全命令自动执行，危险命令需确认',
    icon: '✓',
    color: 'bg-green-100 text-green-700',
  },
  [PermissionMode.CONFIRM]: {
    label: '谨慎模式',
    description: '所有命令都需要确认',
    icon: '?',
    color: 'bg-yellow-100 text-yellow-700',
  },
  [PermissionMode.DENY]: {
    label: '严格模式',
    description: '只允许安全命令',
    icon: '✗',
    color: 'bg-red-100 text-red-700',
  },
};

export const PermissionModeSelector: React.FC<PermissionModeSelectorProps> = ({
  currentMode,
  onChange,
}) => {
  return (
    <div className="flex gap-2">
      {Object.entries(MODE_CONFIGS).map(([mode, config]) => (
        <button
          key={mode}
          onClick={() => onChange(mode as PermissionMode)}
          className={`px-3 py-2 rounded-lg border transition ${
            currentMode === mode
              ? `${config.color} border-current`
              : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-bold">{config.icon}</span>
            <span>{config.label}</span>
          </div>
          {currentMode === mode && (
            <div className="text-xs mt-1">{config.description}</div>
          )}
        </button>
      ))}
    </div>
  );
};
```

### 风险等级指示器

```tsx
// src/renderer/components/RiskIndicator.tsx

import React from 'react';
import { RiskLevel } from '../types/security';

interface RiskIndicatorProps {
  level: RiskLevel;
  showLabel?: boolean;
}

const RISK_CONFIGS = {
  [RiskLevel.SAFE]: {
    label: '安全',
    icon: '🟢',
    color: 'text-green-500',
    bg: 'bg-green-50',
  },
  [RiskLevel.LOW]: {
    label: '低风险',
    icon: '🔵',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
  },
  [RiskLevel.MEDIUM]: {
    label: '中风险',
    icon: '🟡',
    color: 'text-yellow-500',
    bg: 'bg-yellow-50',
  },
  [RiskLevel.HIGH]: {
    label: '高风险',
    icon: '🟠',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
  },
  [RiskLevel.CRITICAL]: {
    label: '极高风险',
    icon: '🔴',
    color: 'text-red-500',
    bg: 'bg-red-50',
  },
};

export const RiskIndicator: React.FC<RiskIndicatorProps> = ({
  level,
  showLabel = true,
}) => {
  const config = RISK_CONFIGS[level];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${config.bg} ${config.color}`}>
      <span>{config.icon}</span>
      {showLabel && <span className="text-xs font-medium">{config.label}</span>}
    </span>
  );
};
```

### 权限规则管理

```tsx
// src/renderer/components/PermissionRulesPanel.tsx

import React, { useState } from 'react';
import { PermissionRule } from '../types/permission';

interface PermissionRulesPanelProps {
  rules: PermissionRule[];
  onAdd: (rule: Omit<PermissionRule, 'id' | 'createdAt'>) => void;
  onRemove: (ruleId: string) => void;
  onToggle: (ruleId: string, enabled: boolean) => void;
}

export const PermissionRulesPanel: React.FC<PermissionRulesPanelProps> = ({
  rules,
  onAdd,
  onRemove,
  onToggle,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '',
    type: 'whitelist' as 'whitelist' | 'blacklist',
    value: '',
    scope: 'global',
  });

  return (
    <div className="border border-gray-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-bold">权限规则</h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          添加规则
        </button>
      </div>

      {/* 添加表单 */}
      {showAddForm && (
        <div className="mb-4 p-3 bg-gray-50 rounded">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="规则名称"
              value={newRule.name}
              onChange={e => setNewRule({ ...newRule, name: e.target.value })}
              className="px-3 py-2 border rounded"
            />
            <select
              value={newRule.type}
              onChange={e => setNewRule({ ...newRule, type: e.target.value as any })}
              className="px-3 py-2 border rounded"
            >
              <option value="whitelist">白名单</option>
              <option value="blacklist">黑名单</option>
            </select>
            <input
              type="text"
              placeholder="命令/模式"
              value={newRule.value}
              onChange={e => setNewRule({ ...newRule, value: e.target.value })}
              className="col-span-2 px-3 py-2 border rounded"
            />
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                onAdd({
                  name: newRule.name,
                  type: newRule.type,
                  value: newRule.value,
                  scope: 'global',
                  priority: 100,
                });
                setShowAddForm(false);
                setNewRule({ name: '', type: 'whitelist', value: '', scope: 'global' });
              }}
              className="px-3 py-1 bg-green-500 text-white rounded"
            >
              保存
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1 bg-gray-200 rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 规则列表 */}
      <div className="space-y-2">
        {rules.map(rule => (
          <div key={rule.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={e => onToggle(rule.id, e.target.checked)}
            />
            <span className={`px-2 py-0.5 rounded text-xs ${
              rule.type === 'whitelist' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
            }`}>
              {rule.type === 'whitelist' ? '白名单' : '黑名单'}
            </span>
            <span className="font-medium">{rule.name}</span>
            <span className="text-sm text-gray-500">{rule.value}</span>
            <button
              onClick={() => onRemove(rule.id)}
              className="ml-auto px-2 py-1 text-red-500 hover:bg-red-50 rounded"
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 执行中断组件

```tsx
// src/renderer/components/ExecutionInterrupt.tsx

import React, { useEffect, useState } from 'react';

interface ExecutionInterruptProps {
  executing: boolean;
  onInterrupt: () => void;
}

export const ExecutionInterrupt: React.FC<ExecutionInterruptProps> = ({
  executing,
  onInterrupt,
}) => {
  useEffect(() => {
    if (!executing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c') {
        e.preventDefault();
        onInterrupt();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [executing, onInterrupt]);

  if (!executing) return null;

  return (
    <div className="fixed bottom-4 right-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg shadow-lg">
      <div className="flex items-center gap-3">
        <span className="animate-pulse">⏳</span>
        <span className="text-yellow-700">正在执行...</span>
        <button
          onClick={onInterrupt}
          className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Ctrl+C 中断
        </button>
      </div>
    </div>
  );
};
```

### 设置面板集成

```tsx
// src/renderer/components/SettingsPanel.tsx（扩展）

import React, { useState, useEffect } from 'react';
import { PermissionModeSelector } from './PermissionModeSelector';
import { PermissionRulesPanel } from './PermissionRulesPanel';
import { PermissionMode, PermissionRule, PermissionConfig } from '../types/permission';

export const SecuritySettingsTab: React.FC = () => {
  const [config, setConfig] = useState<PermissionConfig | null>(null);

  useEffect(() => {
    window.electronAPI.permissionGetConfig().then(setConfig);
  }, []);

  if (!config) return <div>加载中...</div>;

  const handleModeChange = async (mode: PermissionMode) => {
    await window.electronAPI.permissionSetMode(mode);
    setConfig({ ...config, mode });
  };

  const handleAddRule = async (rule: Omit<PermissionRule, 'id' | 'createdAt'>) => {
    const newRule = await window.electronAPI.permissionAddRule(rule);
    setConfig({ ...config, rules: [...config.rules, newRule] });
  };

  const handleRemoveRule = async (ruleId: string) => {
    await window.electronAPI.permissionRemoveRule(ruleId);
    setConfig({ ...config, rules: config.rules.filter(r => r.id !== ruleId) });
  };

  return (
    <div className="space-y-6">
      {/* 权限模式选择 */}
      <div>
        <h3 className="font-bold mb-3">权限模式</h3>
        <PermissionModeSelector
          currentMode={config.mode}
          onChange={handleModeChange}
        />
      </div>

      {/* 权限规则 */}
      <div>
        <PermissionRulesPanel
          rules={config.rules}
          onAdd={handleAddRule}
          onRemove={handleRemoveRule}
          onToggle={(id, enabled) => {
            // 实现启用/禁用切换
          }}
        />
      </div>

      {/* 快捷键设置 */}
      <div>
        <h3 className="font-bold mb-3">快捷键</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label className="w-24">中断执行:</label>
            <input
              type="text"
              value={config.hotkeys.interrupt}
              className="px-3 py-1 border rounded w-32"
              readOnly
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24">强制执行:</label>
            <input
              type="text"
              value={config.hotkeys.override}
              className="px-3 py-1 border rounded w-32"
              readOnly
            />
          </div>
        </div>
      </div>
    </div>
  );
};
```

## 五、IPC Handlers

```typescript
// src/main/index.ts（新增部分）

ipcMain.handle('permission:getConfig', () => permissionManager.getConfig());
ipcMain.handle('permission:setMode', (_event, mode: PermissionMode) => {
  permissionManager.setMode(mode);
});
ipcMain.handle('permission:addRule', (_event, rule: Omit<PermissionRule, 'id' | 'createdAt'>) => {
  return permissionManager.addRule(rule);
});
ipcMain.handle('permission:removeRule', (_event, ruleId: string) => {
  permissionManager.removeRule(ruleId);
});
ipcMain.handle('permission:toggleRule', (_event, ruleId: string, enabled: boolean) => {
  // 实现启用/禁用切换
});
```

## 六、实施步骤

**半天**：
- 创建 `PermissionMode.ts` 类型定义
- 创建 `PermissionManager.ts` 权限管理器
- 添加 IPC handlers

**半天**：
- 创建 `PermissionModeSelector.tsx`
- 创建 `RiskIndicator.tsx`
- 创建 `PermissionRulesPanel.tsx`
- 创建 `ExecutionInterrupt.tsx`
- 集成到设置面板
- 测试完整流程

---

## 总结

以上 6 个设计文档已完整落盘，可直接按优先级开始实施：

| 文档 | 路径 | 状态 |
|------|------|------|
| 总览 | `docs/architecture-enhancement-overview.md` | ✅ |
| P0 安全分析 | `docs/security-analyzer-design.md` | ✅ |
| P1 工具系统 | `docs/tool-system-design.md` | ✅ |
| P2 上下文压缩 | `docs/context-compression-design.md` | ✅ |
| P2 Agent系统 | `docs/agent-system-design.md` | ✅ |
| P3 会话恢复 | `docs/session-recovery-design.md` | ✅ |
| P3 权限UI | `docs/permission-ui-design.md` | ✅ |

**建议实施顺序**：P0 → P1 → P2 → P3

每个文档包含：
- 完整类型定义
- 核心实现代码
- IPC handlers
- 前端组件
- 测试用例（部分）
- 实施步骤