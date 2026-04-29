# 架构增强方案总览

> 基于 Claude Code 设计分析，结合项目现状的可落地改进方案
> 创建日期：2026-04-28

## 一、设计理念（源自 Claude Code）

| 核心信条 | 说明 | 项目应用 |
|---------|------|---------|
| 可组合性胜过单体 | 通过轻量原语构建系统，而非庞大单体 | 工具系统采用泛型接口 + 动态注册 |
| 失败关闭（默认拒绝） | 权限检查是架构起点而非附加组件 | 命令执行前强制安全分析 |
| 成本是一等约束 | Token 预算管理，上下文压缩 | 实现 TokenBudgetTracker |
| 上下文是最宝贵资源 | 精准注入、智能裁剪、分层摘要 | CompactEngine 自动压缩历史 |
| 渐进式复杂性 | 新用户接触基础功能，高级功能逐步解锁 | 权限分级 UI，安全 → 危险需确认 |

## 二、实施方案清单

| 优先级 | 方案名称 | 文档位置 | 预计工作量 |
|--------|---------|---------|-----------|
| P0 | 命令安全语义分析 | `security-analyzer-design.md` | 2-3 天 |
| P1 | 工具系统重构 | `tool-system-design.md` | 3-5 天 |
| P2 | 分层上下文压缩 | `context-compression-design.md` | 2 天 |
| P2 | Agent 协作模式 | `agent-system-design.md` | 3 天 |
| P3 | 会话恢复机制 | `session-recovery-design.md` | 1 天 |
| P3 | 渐进式权限 UI | `permission-ui-design.md` | 1 天 |

## 三、架构演进路线图

```
阶段 1（P0）：安全基座
├── 命令安全分析器
├── 危险命令拦截
└── 安全替代建议

阶段 2（P1）：工具系统
├── 泛型工具接口
├── 动态注册池
├── 权限分层
└── 上下文修改器

阶段 3（P2）：智能能力
├── Token 预算追踪
├── 上下文压缩引擎
├── Agent 任务分解
└── 工具白名单

阶段 4（P3）：体验优化
├── 会话恢复
├── 渐进式权限 UI
└── 操作回滚
```

## 四、目标代码结构

```
src/
├── main/
│   ├── tools/                    # [新增] 工具系统
│   │   ├── Tool.ts               # 泛型接口定义
│   │   ├── ToolRegistry.ts       # 工具注册池
│   │   ├── ToolExecutor.ts       # 执行调度器
│   │   ├── SecurityAnalyzer.ts   # 命令安全分析
│   │   ├── PermissionLevel.ts    # 权限分级枚举
│   │   ├── implementations/      # 具体工具实现
│   │   │   ├── SSHExecuteTool.ts
│   │   │   ├── SSHConnectTool.ts
│   │   │   ├── FileReadTool.ts
│   │   │   └── AIGenerateTool.ts
│   │   └── hooks/                # 工具生命周期钩子
│   │       ├── PreToolUseHook.ts
│   │       └── PostToolUseHook.ts
│   │
│   ├── agents/                   # [新增] Agent 系统
│   │   ├── Agent.ts              # Agent 接口定义
│   │   ├── AgentCoordinator.ts   # Agent 协调器
│   │   ├── TaskDecomposer.ts     # 任务分解器
│   │   └── implementations/      # 具体 Agent 实现
│   │   │   ├── DeploymentCheckAgent.ts
│   │   │   ├── LogAnalysisAgent.ts
│   │   │   └── NetworkDebugAgent.ts
│   │
│   ├── context/                  # [重构] 上下文管理
│   │   ├── SessionContext.ts     # 会话上下文（现有）
│   │   ├── TokenBudget.ts        # Token 预算追踪
│   │   ├── CompactEngine.ts      # 压缩引擎
│   │   ├── ContextModifier.ts    # 上下文修改器
│   │   └── HistoryManager.ts     # 命令历史管理
│   │
│   ├── recovery/                 # [新增] 会话恢复
│   │   ├── SessionLogger.ts      # 只追加日志
│   │   ├── SessionRecovery.ts    # 恢复机制
│   │   └── TranscriptEntry.ts    # 日志条目类型
│   │
│   ├── services/                 # [现有] 服务层
│   │   ├── AIEngine.ts           # AI 引擎（需适配工具系统）
│   │   ├── ServerManager.ts      # SSH 连接管理
│   │   └── DatabaseManager.ts    # 数据持久化
│   │
│   ├── types/                    # [新增] 类型定义
│   │   ├── ids.ts                # Brand ID 类型
│   │   ├── permissions.ts        # 权限枚举
│   │   ├── security.ts           # 安全分析结果
│   │   └── tool-context.ts       # 工具上下文类型
│   │
│   ├── index.ts                  # 主进程入口
│   └── logger.ts                 # 日志工具
│
├── preload/
│   └── index.ts                  # API 暴露（适配工具系统）
│
├── renderer/
│   ├── components/
│   │   ├── SecurityWarning.tsx   # [新增] 安全警告组件
│   │   ├── PermissionPrompt.tsx  # [新增] 权限确认弹窗
│   │   ├── TerminalView.tsx
│   │   └── Toast.tsx
│   ├── App.tsx                   # 主应用（适配工具调用）
│   ├── store.ts                  # Zustand 状态
│   └── hooks/                    # [新增] React Hooks
│       └── useToolExecution.ts   # 工具执行 Hook
```

## 五、关键依赖

- `zod`: 运行时类型校验（工具输入验证）
- 无新增外部依赖，利用现有 TypeScript + React + Electron

## 六、风险与对策

| 风险 | 对策 |
|------|------|
| 重构影响现有功能 | 增量迁移，保留旧接口兼容期 |
| Token 计算精度 | 使用估算算法，设置安全阈值 |
| 安全分析误报 | 提供用户 Override 机制 |
| Agent 分解过度 | 设置分解深度上限 |

---

下一步：按优先级阅读具体设计文档，开始实施 P0 方案。