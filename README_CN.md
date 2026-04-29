# Ops Claw

> 像猫爪一样精准抓取服务器 - 聊天式 SSH 运维桌面应用

[![许可证](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-28.x-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61dafb.svg)](https://reactjs.org/)

**中文文档** | [English](README.md)

## ✨ 功能特性

### 核心功能

- 🖥️ **服务器管理** - 添加、编辑、删除 SSH 服务器配置
- 🔌 **SSH 连接** - 支持 Linux/Windows，密码和私钥认证
- 💬 **人工命令模式** - 直接执行 Shell 命令
- 🤖 **AI 自然语言模式** - 用自然语言描述操作，AI 生成命令
- 📑 **多标签页** - 同时连接多台服务器，支持同一服务器多开终端
- 💾 **本地存储** - 聊天记录本地持久化，重启恢复
- 🔐 **密码安全存储** - Electron safeStorage 加密（Windows DPAPI，macOS Keychain）
- 🌙 **暗色模式** - Catppuccin 主题，一键切换

### AI 增强功能

- 🧠 **Agent 任务分解** - 复杂任务拆解为子任务步骤
- 📊 **实时进度追踪** - 执行状态实时推送到前端
- 🛡️ **命令安全分析** - 自动检测危险命令（rm -rf、mkfs 等）
- ⚙️ **权限模式控制** - 标准/谨慎/严格三档控制
- 📝 **自定义安全规则** - 用户自定义命令拦截规则
- 🔄 **会话上下文管理** - 记录工作目录、主机名、任务目标
- 💰 **Token 预算追踪** - 监控 API 调用成本
- 📦 **上下文压缩** - 自动压缩历史节省 Token（Claude Code 风格）
- 🔁 **会话恢复** - 崩溃后恢复连接和状态
- 📈 **AI 结果分析** - 分析命令结果，提供后续建议

## 🛠️ 技术栈

| 层级     | 技术                            |
| -------- | ------------------------------- |
| 框架     | Electron 28.x                   |
| 构建工具 | electron-vite 5.x               |
| 前端     | React 18 + TypeScript 5.x       |
| 状态管理 | Zustand 4.x                     |
| 样式     | TailwindCSS 3.x（支持暗色模式） |
| SSH 连接 | ssh2 1.x                        |
| AI 集成  | OpenAI SDK（兼容各厂商 API）    |
| 终端渲染 | xterm.js + xterm-addon-fit 5.x  |

## 🚀 快速开始

```bash
# 克隆仓库
git clone https://github.com/se7enfive/ops-claw.git
cd ops-claw

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建打包
npm run build

# 预览构建产物
npm run preview

# 打包发布
npm run package:win   # Windows
npm run package:mac   # macOS
npm run package:linux # Linux
```

## 📁 项目结构

```
ops-claw/
├── src/
│   ├── main/                     # Electron 主进程
│   │   ├── index.ts              # 入口、窗口管理、IPC
│   │   ├── database.ts           # 数据持久层
│   │   ├── server-manager.ts     # SSH 连接池
│   │   ├── ai-engine.ts          # AI 命令生成与分析
│   │   ├── agents/               # Agent 系统
│   │   ├── tools/                # 工具系统
│   │   ├── context/              # 上下文管理
│   │   └── recovery/             # 会话恢复
│   ├── preload/
│   │   └── index.ts              # IPC 桥接层
│   └── renderer/                 # React 渲染进程
│       ├── App.tsx               # 主组件
│       ├── store.ts              # Zustand 状态
│       └── components/           # UI 组件
├── docs/                         # 设计文档
└── package.json
```

## 🔒 安全设计

### 密码保护

1. **加密存储** - Electron `safeStorage` API
2. **密码不入 JSON** - 配置保存时剥离密码字段

### 命令安全分析

| 风险级别     | 示例命令              | 默认行为         |
| ------------ | --------------------- | ---------------- |
| **Critical** | `rm -rf /`, `mkfs`    | 阻止执行         |
| **High**     | `rm -rf`, `chmod 777` | 要求确认         |
| **Medium**   | `kill`, `shutdown`    | 标准模式自动执行 |
| **Low**      | `ls`, `cat`           | 自动执行         |

## 🤖 AI 配置

支持 OpenAI 兼容 API：

- OpenAI
- Azure OpenAI
- Anthropic Claude（通过代理）
- DeepSeek
- 本地 LLM（如 Ollama）

## 📊 数据存储位置

| 数据类型   | 存储位置                                |
| ---------- | --------------------------------------- |
| 服务器配置 | `%APPDATA%/ops-claw/ops-claw-data.json` |
| 加密密码   | `%APPDATA%/ops-claw/credentials.json`   |
| 应用日志   | `%APPDATA%/ops-claw/logs/`              |

## 📖 设计文档

- [架构增强总览](docs/architecture-enhancement-overview.md)
- [安全分析器设计](docs/security-analyzer-design.md)
- [工具系统设计](docs/tool-system-design.md)
- [上下文压缩设计](docs/context-compression-design.md)
- [Agent 系统设计](docs/agent-system-design.md)

## 🤝 贡献指南

欢迎提交 Pull Request！

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📝 许可证

本项目采用 MIT 许可证 -详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Electron](https://electronjs.org/) - 桌面应用框架
- [xterm.js](https://xtermjs.org/) - 终端模拟器
- [ssh2](https://github.com/mscdex/ssh2) - SSH 客户端
- [Claude Code](https://claude.ai/code) - 上下文管理设计灵感

---
