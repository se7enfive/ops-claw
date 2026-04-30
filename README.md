# Ops Claw

> 像猫爪一样精准抓取服务器 - AI 增强的聊天式 SSH 运维桌面应用

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-28.x-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61dafb.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)

**English** | [中文文档](README_CN.md)

---

## 📖 目录

- [简介](#简介)
- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [安全设计](#安全设计)
- [AI 配置](#ai-配置)
- [数据存储](#数据存储)
- [开发指南](#开发指南)
- [IPC API 参考](#ipc-api-参考)
- [常见问题](#常见问题)
- [路线图](#路线图)
- [文档](#文档)
- [贡献指南](#贡献指南)
- [许可证](#许可证)
- [致谢](#致谢)

---

## 简介

Ops Claw 是一款创新的 SSH 运维工具，将 **AI 智能分析**、**安全命令审查**、**任务自动分解** 融合到聊天式交互界面中。用户只需用自然语言描述运维需求，AI 会自动生成安全可靠的命令序列，并在执行前进行风险评估。

**为什么选择 Ops Claw？**

- 🎯 **精准执行** - AI 理解上下文，生成符合当前环境的命令
- 🛡️ **安全优先** - 26 种危险命令模式自动检测，三级权限控制
- 🧠 **智能分解** - 复杂任务自动拆分为可执行步骤
- 💾 **成本可控** - Token 预算追踪，智能压缩历史节省成本
- 🔁 **容错恢复** - 崩溃后自动恢复连接和会话状态

---

## 核心特性

### 基础功能

| 功能 | 描述 |
|------|------|
| 🖥️ **服务器管理** | 添加、编辑、删除 SSH 服务器配置 |
| 🔌 **SSH 连接** | 支持 Linux/Windows，密码和私钥认证 |
| 💬 **手动命令模式** | 直接执行 Shell 命令，实时查看输出 |
| 🤖 **AI 自然语言模式** | 用自然语言描述操作，AI 生成命令 |
| 📑 **多标签页支持** | 同时连接多台服务器，每台支持多个终端 |
| 💾 **本地存储** | 聊天历史本地持久化，重启后保留 |
| 🔐 **密码安全存储** | Electron safeStorage 加密（Windows DPAPI，macOS Keychain） |
| 🌙 **暗色主题** | Catppuccin 主题，一键切换 |

### AI 增强功能

| 功能 | 描述 |
|------|------|
| 🧠 **Agent 任务分解** | 复杂运维任务自动拆分为子步骤 |
| 📊 **实时进度追踪** | 执行状态通过 IPC 推送到前端 |
| 🛡️ **命令安全分析** | 自动检测危险命令（rm -rf、mkfs 等） |
| ⚙️ **权限模式** | Standard/Cautious/Strict 三级控制 |
| 📝 **自定义安全规则** | 用户定义的命令拦截模式 |
| 🔄 **会话上下文管理** | 跟踪工作目录、主机名、任务目标 |
| 💰 **Token 预算追踪** | 监控 API 成本，设置预算上限 |
| 📦 **上下文压缩** | AI 智能摘要历史，节省 Token（Claude Code 方案） |
| 🔁 **会话恢复** | 崩溃后恢复连接和状态 |
| 📈 **结果分析** | 分析命令结果，提供下一步建议 |

---

## 系统架构

### 三进程架构 (Electron)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Main Process (Node.js)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ IPC Handlers│  │ Tool System │  │ Agent System│  │ AI Engine   │ │
│  │  40+ APIs   │  │ Registry    │  │ Coordinator │  │ OpenAI SDK  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │               │               │               │          │
│  ┌──────┴───────────────┴───────────────┴───────────────┴──────┐   │
│  │              Security Analyzer + Permission Manager          │   │
│  │                      (Command Safety Gate)                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │ SSH Manager │  │ TokenBudget │  │ Recovery    │                  │
│  │ ssh2 pool   │  │ Tracker     │  │ SessionLog  │                  │
│  └─────────────┘  └─────────────┘  └─────────────┘                  │
│  ┌─────────────┐                                                    │
│  │ Database    │  ← JSON File Storage (ops-claw-data.json)          │
│  │ Manager     │                                                    │
│  └─────────────┘                                                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ IPC (contextBridge)
┌─────────────────────────────────────────────────────────────────────┐
│                        Renderer Process (React)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Zustand     │  │ Terminal    │  │ AgentTask   │  │ Security    │ │
│  │ Store       │  │ xterm.js    │  │ Panel       │  │ Warning     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         └────────────────┴────────────────┴────────────────┘        │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      App.tsx (Main Component)                   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ contextBridge
┌─────────────────────────────────────────────────────────────────────┐
│                          Preload Script                              │
│  window.electronAPI = { ssh:*, ai:*, agent:*, tool:*, ... }         │
└─────────────────────────────────────────────────────────────────────┘
```

### 命令执行安全流程

```
用户输入自然语言
        │
        ▼
┌───────────────────┐
│   AI Engine       │  ← 生成命令 + 解释
│   generateCommand │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ SecurityAnalyzer  │  ← 分析风险级别
│   analyze()       │     - CRITICAL: 阻止
│                   │     - HIGH: 需确认
│                   │     - MEDIUM: 标准模式自动
│                   │     - LOW: 自动执行
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ PermissionManager │  ← 覆写决策
│   checkPermission │     - allow: 直接执行
│                   │     - confirm: 用户确认
│                   │     - deny: 阻止执行
└─────────┬─────────┘
          │
          ▼ (如果需要确认)
┌───────────────────┐
│   用户确认弹窗     │  ← SecurityWarning.tsx
│   [执行] [取消]   │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   SSH Manager     │  ← serverManager.execute()
│   execute command │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│   AI Engine       │  ← 分析结果 + 建议
│   analyzeResult   │     - 下一步建议
│                   │     - 后续命令推荐
└───────────────────┘
```

---

## 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **框架** | Electron | 28.x | 跨平台桌面应用 |
| **构建** | electron-vite | 5.x | Electron 专用 Vite 构建 |
| **前端** | React | 18.x | UI 组件库 |
| **类型** | TypeScript | 5.x | 类型安全 |
| **状态** | Zustand | 4.x | 轻量状态管理 |
| **样式** | TailwindCSS | 3.x | 原子化 CSS |
| **SSH** | ssh2 | 1.x | SSH 客户端库 |
| **AI** | OpenAI SDK | 4.x | AI API 调用 |
| **终端** | xterm.js | 5.x | Web 终端模拟器 |

---

## 快速开始

### 环境要求

- Node.js >= 18.x
- npm >= 9.x
- Git

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/se7enfive/ops-claw.git
cd ops-claw

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview

# 打包分发
npm run package:win   # Windows (.exe, portable)
npm run package:mac   # macOS (.dmg, .zip)
npm run package:linux # Linux (.AppImage, .deb)
```

### 开发模式热键

| 操作 | 热键 |
|------|------|
| 打开 DevTools | 自动打开（右侧面板） |
| 刷新页面 | Ctrl+R / Cmd+R |
| 强制刷新 | Ctrl+Shift+R / Cmd+Shift+R |

---

## 项目结构

```
ops-claw/
├── src/
│   ├── main/                     # Electron 主进程 (后端)
│   │   ├── index.ts              # 入口 + IPC handlers (40+ APIs)
│   │   ├── server-manager.ts     # SSH 连接池管理
│   │   ├── ai-engine.ts          # AI 命令生成/分析/摘要
│   │   ├── database.ts           # JSON 文件持久化
│   │   ├── credential-manager.ts # 密码加密存储
│   │   ├── logger.ts             # 结构化日志系统
│   │   │
│   │   ├── agents/               # Agent 任务分解系统
│   │   │   ├── Agent.ts          # Agent 接口定义
│   │   │   ├── AgentCoordinator.ts # 协调器
│   │   │   ├── TaskDecomposer.ts  # 任务分解
│   │   │   ├── index.ts           # 系统初始化
│   │   │   └── implementations/
│   │   │       └── GeneralAgent.ts # 通用运维 Agent
│   │   │
│   │   ├── tools/                # 工具执行系统
│   │   │   ├── Tool.ts           # 泛型工具接口
│   │   │   ├── ToolRegistry.ts   # 动态注册池
│   │   │   ├── ToolExecutor.ts   # 执行调度器
│   │   │   ├── SecurityAnalyzer.ts # 命令安全分析
│   │   │   ├── PermissionManager.ts # 权限管理
│   │   │   ├── DangerousPatterns.ts # 26 种危险模式
│   │   │   └── implementations/
│   │   │       ├── SSHExecuteTool.ts # SSH 命令执行
│   │   │       └── AIGenerateTool.ts  # AI 命令生成
│   │   │
│   │   ├── context/              # 上下文与成本管理
│   │   │   ├── TokenBudget.ts    # Token 预算追踪
│   │   │   └── CompactEngine.ts  # 智能压缩引擎
│   │   │
│   │   ├── recovery/             # 会话恢复
│   │   │   ├── SessionLogger.ts  # 只追加日志
│   │   │   └── SessionRecovery.ts # 恢复机制
│   │   │
│   │   └── types/                # 类型定义
│   │       ├── security.ts       # 安全分析结果类型
│   │       └── tool-context.ts   # 工具上下文类型
│   │
│   ├── preload/
│   │   └── index.ts              # IPC 桥接 (contextBridge)
│   │
│   └── renderer/                 # React 渲染进程 (前端)
│       ├── App.tsx               # 主应用组件
│       ├── main.tsx              # React 入口
│       ├── store.ts              # Zustand 状态 (113 行)
│       ├── vite-env.d.ts         # Vite 类型声明
│       │
│       └── components/           # UI 组件
│           ├── TerminalView.tsx      # xterm.js 终端
│           ├── AgentTaskPanel.tsx    # Agent 任务面板
│           ├── SecurityWarning.tsx   # 安全警告弹窗
│           ├── BudgetIndicator.tsx   # Token 预算指示器
│           ├── PermissionModeSelector.tsx # 权限模式选择
│           ├── RecoveryPrompt.tsx    # 恢复提示
│           ├── ThemeToggle.tsx       # 主题切换
│           ├── Toast.tsx             # 消息提示
│           └── AIConfigDialog.tsx    # AI 配置弹窗
│
├── docs/                         # 设计文档 (9 个)
│   ├── architecture-enhancement-overview.md
│   ├── security-analyzer-design.md
│   ├── tool-system-design.md
│   ├── context-compression-design.md
│   ├── agent-system-design.md
│   ├── session-recovery-design.md
│   ├── permission-ui-design.md
│   ├── AI_CONFIG_EXAMPLES.md
│   └── IMPLEMENTATION_PLAN.md
│
├── build/                        # 打包资源
│   ├── icon.ico                  # Windows 图标
│   ├── icon.icns                 # macOS 图标
│   └── icon.png                  # Linux 图标
│
├── out/                          # 构建输出 (生成)
├── release/                      # 打包输出 (生成)
│
├── electron.vite.config.ts       # Vite 配置
├── tailwind.config.js            # TailwindCSS 配置
├── postcss.config.js             # PostCSS 配置
├── package.json                  # 项目配置
├── tsconfig.main.json            # TypeScript 配置
├── CHANGELOG.md                  # 变更日志
├── CONTRIBUTING.md               # 贡献指南
├── README.md                     # 英文文档
├── README_CN.md                  # 中文文档
└── LICENSE                       # MIT 许可证
```

---

## 安全设计

### 密码保护

| 平台 | 加密机制 | 存储位置 |
|------|---------|---------|
| Windows | DPAPI (Data Protection API) | `%APPDATA%/ops-claw/credentials.json` |
| macOS | Keychain Services | `%APPDATA%/ops-claw/credentials.json` |
| Linux | libsecret (GNOME Keyring) | `%APPDATA%/ops-claw/credentials.json` |

**安全策略：**
- 密码从不以明文形式存储在 JSON 配置文件中
- 使用 Electron `safeStorage` API 加密敏感数据
- 只有当前用户账户可以解密存储的凭证

### 命令安全分析

系统内置 **26 种危险命令模式** 检测：

| 风险级别 | 命令示例 | 默认行为 | 原因 |
|---------|---------|---------|------|
| **CRITICAL** | `rm -rf /`, `mkfs`, `dd if=/dev/zero of=/dev/sda` | 阻止执行 | 系统毁灭级 |
| **HIGH** | `rm -rf`, `chmod 777`, `kill -9 -1` | 强制确认 | 高风险操作 |
| **MEDIUM** | `kill`, `shutdown`, `reboot`, `systemctl stop` | 标准模式自动/谨慎模式确认 | 服务影响 |
| **LOW** | `ls`, `cat`, `grep`, `find` | 自动执行 | 信息查看 |

### 权限模式

| 模式 | 低风险 | 中风险 | 高风险 | 严重风险 |
|------|--------|--------|--------|----------|
| **Standard** | 自动 | 自动 | 确认 | 阻止 |
| **Cautious** | 确认 | 确认 | 确认 | 阻止 |
| **Strict** | 自动 | 确认 | 阻止 | 阻止 |

### 自定义安全规则

用户可以添加自定义规则：

```typescript
interface SecurityRule {
  pattern: string;        // 正则表达式模式
  action: 'allow' | 'deny' | 'confirm';  // 行为
  description?: string;   // 规则说明
}
```

示例：
```typescript
// 阻止所有 docker 命令
{ pattern: '^docker', action: 'deny', description: '禁止 Docker 操作' }

// 允许特定目录的 rm 命令
{ pattern: '^rm /tmp/', action: 'allow', description: '允许清理临时目录' }
```

---

## AI 配置

### 支持的 API 提供商

| 提供商 | Endpoint | 模型示例 |
|--------|----------|---------|
| OpenAI | `https://api.openai.com/v1` | gpt-4, gpt-3.5-turbo |
| Azure OpenAI | `https://YOUR_RESOURCE.openai.azure.com` | gpt-4, gpt-35-turbo |
| Anthropic Claude (代理) | 代理服务地址 | claude-3-opus, claude-3-sonnet |
| DeepSeek | `https://api.deepseek.com/v1` | deepseek-chat |
| 本地 LLM (Ollama) | `http://localhost:11434/v1` | llama2, mistral |
| 其他 OpenAI 兼容服务 | 各服务商地址 | 各模型 |

### 配置参数

```typescript
interface AIConfigItem {
  id: number;
  name: string;              // 配置名称
  endpoint: string;          // API 端点
  apiKey: string;            // API 密钥（加密存储）
  model: string;             // 模型名称
  isActive: boolean;         // 是否激活
}
```

### Token 预算管理

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxBudget` | 100,000 | 最大 Token 预算 |
| `warningThreshold` | 50% | 警告阈值 |
| `compactThreshold` | 70% | 自动压缩阈值 |
| `emergencyThreshold` | 90% | 紧急停止阈值 |

当达到 70% 阈值时，系统会自动触发 **AI 智能摘要**，将历史命令压缩为关键信息，节省 Token 消耗。

---

## 数据存储

### 存储位置

| 数据类型 | Windows | macOS/Linux |
|---------|---------|-------------|
| 应用数据 | `%APPDATA%/ops-claw/` | `~/Library/Application Support/ops-claw/` 或 `~/.config/ops-claw/` |
| 服务器配置 | `ops-claw-data.json` | `ops-claw-data.json` |
| 加密凭证 | `credentials.json` | `credentials.json` |
| 日志文件 | `logs/app.log` | `logs/app.log` |
| 恢复数据 | `recovery/session.json` | `recovery/session.json` |

### 数据结构

```typescript
// ops-claw-data.json
{
  "servers": ServerConfig[],      // SSH 服务器列表
  "aiConfigs": AIConfigItem[],    // AI 配置列表
  "messages": Record<string, Message[]>,  // 聊天历史
  "contexts": Record<string, SessionContext>,  // 会话上下文
  "activeAIConfigId": number      // 当前激活的 AI 配置
}

// credentials.json (加密)
{
  "credentials": Record<string, EncryptedCredential>
}
```

---

## 开发指南

### 开发环境设置

```bash
# 1. 克隆仓库
git clone https://github.com/se7enfive/ops-claw.git
cd ops-claw

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run dev
```

### 代码规范

- **TypeScript 严格模式** - 所有代码使用 TypeScript
- **函数式组件** - React 使用 Hooks，无类组件
- **状态管理** - Zustand 单一 store
- **样式** - TailwindCSS 原子化类名
- **命名** - camelCase 函数，PascalCase 组件

### 目录结构约定

| 目录 | 用途 | 可修改 |
|------|------|--------|
| `src/main/` | 主进程代码 | ✅ 核心逻辑 |
| `src/renderer/` | 前端代码 | ✅ UI 组件 |
| `src/preload/` | IPC 桥接 | ⚠️ 添加新 API |
| `docs/` | 设计文档 | ✅ 更新设计 |

### 添加新工具

```typescript
// 1. 在 src/main/tools/implementations/ 创建工具类
import { Tool } from '../Tool';

export class MyCustomTool implements Tool<MyInput, MyOutput> {
  metadata = {
    name: 'my:custom',
    description: '自定义工具',
    category: 'custom',
  };

  security = {
    riskLevel: 'LOW',
    requiresConfirmation: false,
  };

  async execute(input: MyInput, context: ToolUseContext): Promise<MyOutput> {
    // 实现逻辑
  }
}

// 2. 在 src/main/index.ts 注册
toolRegistry.register(new MyCustomTool());
```

### 添加新 IPC API

```typescript
// 1. 在 src/main/index.ts 的 setupIpcHandlers() 添加
ipcMain.handle('my:newApi', async (_event, param) => {
  return myHandler(param);
});

// 2. 在 src/preload/index.ts 暴露
contextBridge.exposeInMainWorld('electronAPI', {
  // ...existing APIs
  myNewApi: (param) => ipcRenderer.invoke('my:newApi', param),
});
```

---

## IPC API 参考

### SSH 相关

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `server:list` | - | `ServerConfig[]` | 获取服务器列表 |
| `server:add` | `config` | `id` | 添加服务器 |
| `server:update` | `id, config` | - | 更新服务器 |
| `server:delete` | `id` | - | 删除服务器 |
| `ssh:connect` | `serverId` | `ConnectionResult` | 连接服务器 |
| `ssh:execute` | `connectionId, command` | `ExecuteResult` | 执行命令 |
| `ssh:disconnect` | `connectionId` | - | 断开连接 |
| `ssh:shell:create` | `connectionId, cols, rows` | `sessionId` | 创建 Shell 会话 |
| `ssh:shell:write` | `sessionId, data` | - | 写入数据 |
| `ssh:shell:resize` | `sessionId, cols, rows` | - | 调整大小 |
| `ssh:shell:close` | `sessionId` | - | 关闭会话 |

### AI 相关

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `ai:generate` | `tabId, prompt, context` | `AIGenerateResult` | 生成命令 |
| `ai:analyze` | `tabId, prompt, command, output, exitCode, context` | `AIAnalyzeResult` | 分析结果 |
| `ai:listConfigs` | - | `AIConfigItem[]` | 获取 AI 配置列表 |
| `ai:addConfig` | `config` | `id` | 添加 AI 配置 |
| `ai:setActiveConfig` | `id` | - | 设置激活配置 |

### Agent 相关

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `agent:list` | - | `AgentInfo[]` | 获取可用 Agent |
| `agent:decompose` | `prompt, context` | `DecomposeResult` | 任务分解 |
| `agent:execute` | `agentName, subTasks, context, userPrompt` | `ExecuteResult` | 执行任务 |
| `agent:confirm` | `tabId, taskId, isConfirmed` | - | 确认任务步骤 |

### 工具系统

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `tool:list` | - | `ToolInfo[]` | 获取可用工具 |
| `tool:execute` | `request` | `ToolResult` | 执行工具 |
| `command:analyze` | `command` | `SecurityAnalysis` | 安全分析 |

### 权限管理

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `permission:getConfig` | - | `PermissionConfig` | 获取配置 |
| `permission:setMode` | `mode` | `PermissionConfig` | 设置模式 |
| `permission:addRule` | `rule` | - | 添加规则 |
| `permission:removeRule` | `id` | - | 删除规则 |

### 上下文管理

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `context:get` | `tabId` | `SessionContext` | 获取上下文 |
| `context:update` | `tabId, updates` | - | 更新上下文 |
| `context:clear` | `tabId` | - | 清除上下文 |
| `context:summary` | `tabId` | `string` | 获取历史摘要 |

### Token 预算

| API | 参数 | 返回 | 说明 |
|-----|------|------|------|
| `budget:state` | - | `BudgetState` | 获取预算状态 |
| `budget:reset` | - | `BudgetState` | 重置预算 |
| `budget:compact` | `tabId` | `CompactResult` | 手动压缩 |

---

## 常见问题

### Q: 如何配置 AI API？

A: 在应用中点击右上角的 **"AI 配置"** 按钮，添加您的 API 端点、密钥和模型名称。支持所有 OpenAI 兼容的服务。

### Q: 命令被阻止了怎么办？

A: 检查权限模式设置。如果是 **Standard** 模式，高风险命令会需要确认；如果是 **Strict** 模式，高风险命令会被直接阻止。您可以：
1. 切换到 **Cautious** 模式获得确认机会
2. 添加自定义规则允许特定命令

### Q: 如何切换服务器操作系统类型？

A: AI 会根据服务器类型（Linux/Windows）自动生成对应命令。添加服务器时选择正确的类型即可。

### Q: Token 预算消耗太快？

A: 系统会在 70% 阈值自动触发压缩。您也可以：
1. 手动点击 **"压缩上下文"** 按钮
2. 减少历史消息保留量
3. 使用更便宜的模型（如 gpt-3.5-turbo）

### Q: 应用崩溃后数据丢失？

A: Ops Claw 有会话恢复机制。重启后会提示是否恢复之前的连接和状态。

### Q: 如何在多台服务器间切换？

A: 使用多标签页功能。每个标签页可以连接不同的服务器，点击标签页切换。

---

## 路线图

### v1.0 (当前版本)

- ✅ 核心 SSH 管理
- ✅ AI 命令生成
- ✅ 安全分析系统
- ✅ Agent 任务分解
- ✅ Token 预算追踪
- ✅ 会话恢复

### v1.1 (计划)

- 🔄 命令历史可视化图表
- 🔄 多 AI 配置热切换
- 🔄 自定义 Agent 模板
- 🔄 命令执行回滚机制

### v1.2 (计划)

- 📋 SFTP 文件传输支持
- 📋 批量服务器操作
- 📋 命令模板库
- 📋 日志导出与分析

### v2.0 (未来)

- 🌐 Web 版本（浏览器访问）
- 🔗 团队协作功能
- 📊 服务器资源监控
- 🤖 更多专业 Agent（部署检查、日志分析、网络调试）

---

## 文档

详细设计文档位于 `docs/` 目录：

| 文档 | 内容 |
|------|------|
| [架构总览](docs/architecture-enhancement-overview.md) | 系统架构、设计理念、演进路线 |
| [安全分析器设计](docs/security-analyzer-design.md) | 命令安全检测机制 |
| [工具系统设计](docs/tool-system-design.md) | 工具注册、执行、安全流程 |
| [上下文压缩设计](docs/context-compression-design.md) | Token 预算与智能摘要 |
| [Agent 系统设计](docs/agent-system-design.md) | 任务分解与协调机制 |
| [会话恢复设计](docs/session-recovery-design.md) | 崩溃恢复机制 |
| [权限 UI 设计](docs/permission-ui-design.md) | 权限模式界面 |

---

## 贡献指南

我们欢迎所有形式的贡献！

### 贡献方式

1. **报告问题** - 在 [GitHub Issues](https://github.com/se7enfive/ops-claw/issues) 提交 Bug 或功能请求
2. **提交代码** - Fork → Branch → Commit → Push → Pull Request
3. **完善文档** - 修正错误、补充说明、翻译文档
4. **分享使用经验** - 在 Discussions 中分享

### 开发流程

```bash
# 1. Fork 并克隆
git clone https://github.com/YOUR_USERNAME/ops-claw.git

# 2. 创建分支
git checkout -b feature/YourAmazingFeature

# 3. 编写代码 + 测试
npm run dev

# 4. 提交（使用语义化提交）
git commit -m "feat: add amazing feature"

# 5. 推送
git push origin feature/YourAmazingFeature

# 6. 创建 Pull Request
```

### 提交信息规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

| 类型 | 说明 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `docs:` | 文档更新 |
| `style:` | 代码格式（不影响逻辑） |
| `refactor:` | 重构（不新增功能） |
| `test:` | 测试相关 |
| `chore:` | 构建、配置相关 |

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

```
MIT License

Copyright (c) 2024 Ops Claw Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

---

## 致谢

感谢以下开源项目：

- [Electron](https://electronjs.org/) - 跨平台桌面应用框架
- [xterm.js](https://xtermjs.org/) - Web 终端模拟器
- [ssh2](https://github.com/mscdex/ssh2) - 纯 JavaScript SSH2 客户端
- [OpenAI](https://openai.com/) - AI API 服务
- [Claude Code](https://claude.ai/code) - 上下文管理设计灵感
- [React](https://reactjs.org/) - UI 框架
- [TailwindCSS](https://tailwindcss.com/) - 原子化 CSS
- [Zustand](https://github.com/pmndrs/zustand) - 轻量状态管理

---

## 联系方式

- **Issues**: [GitHub Issues](https://github.com/se7enfive/ops-claw/issues)
- **Discussions**: [GitHub Discussions](https://github.com/se7enfive/ops-claw/discussions)

---

<p align="center">
  Made with ❤️ by Ops Claw Contributors
</p>