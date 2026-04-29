# Ops Claw

> 像猫爪一样精准抓取服务器 - 聊天式 SSH 运维桌面应用

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-28.x-blue.svg)](https://electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61dafb.svg)](https://reactjs.org/)

**English** | [中文文档](README_CN.md)

## ✨ Features

### Core Features

- 🖥️ **Server Management** - Add, edit, delete SSH server configurations
- 🔌 **SSH Connection** - Support Linux/Windows with password and privateKey authentication
- 💬 **Manual Command Mode** - Directly execute Shell commands
- 🤖 **AI Natural Language Mode** - Describe operations in natural language, AI generates commands
- 📑 **Multi-tab Support** - Connect multiple servers simultaneously, multiple terminals per server
- 💾 **Local Storage** - Chat history persisted locally, survives restart
- 🔐 **Secure Password Storage** - Electron safeStorage encryption (DPAPI on Windows, Keychain on macOS)
- 🌙 **Dark Mode** - Catppuccin theme, one-click toggle

### AI-Enhanced Features

- 🧠 **Agent Task Decomposition** - Complex tasks broken into sub-task steps
- 📊 **Real-time Progress Tracking** - Execution status pushed to frontend
- 🛡️ **Command Security Analysis** - Auto-detect dangerous commands (rm -rf, mkfs, etc.)
- ⚙️ **Permission Modes** - Standard/Cautious/Strict three-level control
- 📝 **Custom Security Rules** - User-defined command blocking patterns
- 🔄 **Session Context Management** - Track working directory, hostname, task goals
- 💰 **Token Budget Tracking** - Monitor API costs
- 📦 **Context Compression** - Auto-compress history to save tokens (Claude Code style)
- 🔁 **Session Recovery** - Restore connections and state after crash
- 📈 **AI Result Analysis** - Analyze command results, provide next-step suggestions

## 📸 Screenshots

> Screenshots will be added after first release

## 🛠️ Tech Stack

| Layer      | Technology                                     |
| ---------- | ---------------------------------------------- |
| Framework  | Electron 28.x                                  |
| Build Tool | electron-vite 5.x                              |
| Frontend   | React 18 + TypeScript 5.x                      |
| State      | Zustand 4.x                                    |
| Style      | TailwindCSS 3.x (Dark mode supported)          |
| SSH        | ssh2 1.x                                       |
| AI         | OpenAI SDK (compatible with various providers) |
| Terminal   | xterm.js + xterm-addon-fit 5.x                 |

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/se7enfive/ops-claw.git
cd ops-claw

# Install dependencies
npm install

# Development mode
npm run dev

# Build for production
npm run build

# Preview build output
npm run preview

# Package for distribution
npm run package:win   # Windows
npm run package:mac   # macOS
npm run package:linux # Linux
```

## 📁 Project Structure

```
ops-claw/
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # Entry point, window management, IPC
│   │   ├── database.ts           # Data persistence (JSON file)
│   │   ├── server-manager.ts     # SSH connection pool
│   │   ├── ai-engine.ts          # AI command generation & analysis
│   │   ├── credential-manager.ts # Password encryption
│   │   ├── logger.ts             # Logging system
│   │   ├── agents/               # Agent system
│   │   │   ├── Agent.ts          # Agent base interface
│   │   │   ├── AgentCoordinator.ts
│   │   │   ├── TaskDecomposer.ts
│   │   │   └── implementations/
│   │   ├── tools/                # Tool system
│   │   │   ├── Tool.ts           # Tool base
│   │   │   ├── ToolRegistry.ts
│   │   │   ├── ToolExecutor.ts
│   │   │   ├── SecurityAnalyzer.ts
│   │   │   ├── PermissionManager.ts
│   │   │   └── implementations/
│   │   ├── context/              # Context management
│   │   │   ├── TokenBudget.ts    # Token budget tracker
│   │   │   └── CompactEngine.ts  # Context compression
│   │   ├── recovery/             # Session recovery
│   │   └── types/                # Type definitions
│   ├── preload/
│   │   └── index.ts              # IPC bridge (contextBridge)
│   └── renderer/                 # React renderer
│       ├── App.tsx               # Main component
│       ├── store.ts              # Zustand state
│       └── components/           # UI components
│           ├── TerminalView.tsx
│           ├── AgentTaskPanel.tsx
│           ├── SecurityWarning.tsx
│           ├── BudgetIndicator.tsx
│           ├── Toast.tsx
│           └── ...
├── docs/                         # Design documents
├── electron.vite.config.ts
├── tailwind.config.js
├── package.json
└── LICENSE
```

## 🔒 Security Design

### Password Protection

1. **Encrypted Storage** - Electron `safeStorage` API
   - Windows: DPAPI encryption
   - macOS: Keychain storage
2. **No Password in JSON** - Passwords stripped from config, only encrypted credential IDs stored

### Command Security Analysis

| Risk Level   | Example Commands      | Default Behavior      |
| ------------ | --------------------- | --------------------- |
| **Critical** | `rm -rf /`, `mkfs`    | Blocked               |
| **High**     | `rm -rf`, `chmod 777` | Require confirmation  |
| **Medium**   | `kill`, `shutdown`    | Auto in Standard mode |
| **Low**      | `ls`, `cat`           | Auto execute          |

### Permission Modes

| Mode         | Description                                     |
| ------------ | ----------------------------------------------- |
| **Standard** | Low-risk auto, medium/high require confirmation |
| **Cautious** | All commands require confirmation               |
| **Strict**   | High-risk commands blocked                      |

## 🤖 AI Configuration

Supports OpenAI-compatible APIs:

| Config       | Description                                        |
| ------------ | -------------------------------------------------- |
| **Endpoint** | `https://api.openai.com/v1` or compatible services |
| **API Key**  | Your API key                                       |
| **Model**    | `gpt-4`, `gpt-3.5-turbo`, or other models          |

Compatible with: OpenAI, Azure OpenAI, Anthropic Claude (via proxy), DeepSeek, local LLMs, etc.

## 📊 Data Storage

| Data                | Location                                      |
| ------------------- | --------------------------------------------- |
| Server configs      | `%APPDATA%/ops-claw/ops-claw-data.json` |
| Encrypted passwords | `%APPDATA%/ops-claw/credentials.json`   |
| Logs                | `%APPDATA%/ops-claw/logs/`              |
| Recovery data       | `%APPDATA%/ops-claw/recovery/`          |

## 📖 Documentation

- [Architecture Overview](docs/architecture-enhancement-overview.md)
- [Security Analyzer Design](docs/security-analyzer-design.md)
- [Tool System Design](docs/tool-system-design.md)
- [Context Compression Design](docs/context-compression-design.md)
- [Agent System Design](docs/agent-system-design.md)
- [Session Recovery Design](docs/session-recovery-design.md)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Development Guidelines

- Use TypeScript for all code
- Follow existing code style
- Add tests for new features
- Update documentation

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Electron](https://electronjs.org/) - Desktop app framework
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [ssh2](https://github.com/mscdex/ssh2) - SSH client
- [OpenAI](https://openai.com/) - AI API
- [Claude Code](https://claude.ai/code) - Context management design inspiration

## 📮 Contact

- Issues: [GitHub Issues](https://github.com/se7enfive/ops-claw/issues)
- Discussions: [GitHub Discussions](https://github.com/se7enfive/ops-claw/discussions)

---

**Note**: Replace `se7enfive` with your actual GitHub username before uploading.
