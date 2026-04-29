# ops-claw 功能补齐实施方案

## 1. 文档目标

本文档用于梳理当前 `ops-claw` 项目中已发现的未实现、半实现或未完全打通的能力，并给出一份可执行的补齐方案。

目标不是做长期理想化架构设计，而是围绕当前代码结构，优先把产品补到"可稳定演示、可持续迭代"的状态。

---

## 2. 当前项目状态概览

当前项目已经具备完整 MVP 能力：

- Electron 主进程 / preload / React renderer 已打通
- 服务器增删改查已实现
- SSH 连接与交互式终端已实现
- AI 生成命令与两种执行模式已实现
- 聊天记录本地持久化已实现
- 服务器密码与 AI API Key 安全存储已实现
- 工作区状态恢复已实现
- 聊天式 UI 已具备完整可用性
- 统一日志管理已实现

---

## 3. 实现进度总览

| 编号 | 功能项 | 当前状态 | 实现批次 | 备注 |
|---|---|---|---|---|
| F1 | AI 执行模式 `confirm/auto` | ✅ 已实现 | Milestone 1 | 确认模式下生成命令后等待用户确认执行 |
| F2 | SSH 断开连接与资源释放 | ✅ 已实现 | Milestone 1 | tab 关闭、删除服务器、应用退出时均会断连 |
| F3 | AI API Key 安全存储 | ✅ 已实现 | Milestone 1 | 使用 CredentialManager + safeStorage 加密存储 |
| F4 | 交互式终端 / 持续会话 | ✅ 已实现 | Milestone 4 | 人工模式使用 conn.shell() 实现真正的 PTY 终端 |
| F5 | 标签页 / 会话状态恢复 | ✅ 已实现 | Milestone 2 | localStorage 持久化，重启后恢复工作区 |
| F6 | Windows 服务器执行策略 | ✅ 已实现 | Milestone 3 | AI prompt 按 OS 类型生成 PowerShell 或 Shell 命令 |
| F7 | 清空聊天记录 / 会话管理 UI | ✅ 已实现 | Milestone 2 | 服务器列表 hover 菜单中有"清空"入口 |
| F8 | 调试日志与临时展示清理 | ✅ 已实现 | Milestone 2 | 删除所有 debug 输出和临时 UI |
| F9 | 私钥认证支持 | 📋 待实现 | - | 数据结构支持，UI 与安全存储未实现 |
| F10 | 终端复制行为 | ✅ 已实现 | Milestone 4 | Ctrl/Cmd+C 复制选中内容 |
| F11 | 模式切换终端保持 | ✅ 已实现 | 本次会话 | TerminalView 常驻，切换模式不清空内容 |
| F12 | AI 任务卡片化 | ✅ 已实现 | 本次会话 | 从聊天气泡改为任务流卡片，支持摘要、折叠输出、命令操作 |
| F13 | 项目结构清理 | ✅ 已实现 | 本次会话 | 删除临时测试文件，新增 .gitignore |
| F14 | 统一日志管理 | ✅ 已实现 | 本次会话 | app.log + error.log 统一落盘 |

---

## 4. 已实现功能详细说明

### F1. AI 执行模式落地（BL-01）

**实现文件**
- `src/renderer/App.tsx` - 增加 `pendingCommands` 状态、确认/取消按钮

**验收状态**
- ✅ confirm 模式下 AI 返回命令后不会自动执行
- ✅ 用户点击"执行"后才真正调用 sshExecute
- ✅ 用户点击"取消"后不会执行命令
- ✅ auto 模式下维持自动执行行为

---

### F2. SSH 断开连接与资源释放（BL-02, BL-03）

**实现文件**
- `src/renderer/App.tsx` - `disconnectServer`、`closeTab` 函数
- `src/main/server-manager.ts` - `disconnectAll()` 方法
- `src/main/index.ts` - 应用退出时调用 disconnectAll

**验收状态**
- ✅ 关闭 tab 后对应 SSH 连接被释放
- ✅ 删除服务器后不会保留悬挂连接
- ✅ 应用退出时连接会关闭

---

### F3. AI API Key 安全存储（BL-04）

**实现文件**
- `src/main/database.ts` - getAIConfig/setAIConfig 改为异步，拆分 apiKey 存储逻辑
- `src/main/credential-manager.ts` - 复用已有安全存储机制

**验收状态**
- ✅ 保存 AI 设置后，本地 JSON 不再出现明文 apiKey
- ✅ 重启应用后仍能正确读取并使用 API Key
- ✅ 旧数据自动迁移成功

---

### F4. 交互式终端 / 持续会话（BL-10）

**实现文件**
- `src/main/server-manager.ts` - 新增 ShellSession 管理、createShellSession、writeToShell、resizeShell、closeShell
- `src/main/index.ts` - 新增 shell 相关 IPC handlers
- `src/preload/index.ts` - 暴露 shell API 与事件订阅
- `src/renderer/App.tsx` - 人工模式切换为交互式终端，sendMessage 写入 shell
- `src/renderer/components/TerminalView.tsx` - 支持交互模式、onData 输入、ResizeObserver 尺寸同步

**验收状态**
- ✅ pwd -> cd -> pwd 能看到上下文变化
- ✅ vim、top 等交互式命令可正常使用
- ✅ 终端输出支持增量刷新
- ✅ 关闭 tab 时 shell session 会关闭

---

### F5. 标签页与会话状态恢复（BL-05）

**实现文件**
- `src/renderer/App.tsx` - WorkspaceState、localStorage 持久化、restoreWorkspace
- `src/renderer/store.ts` - 新增 setTabs、clearTabs

**验收状态**
- ✅ 重启应用后能恢复上次打开的 tab 列表
- ✅ 能恢复 active tab
- ✅ 不会错误显示为"已连接"

---

### F6. Windows 服务器执行策略落地（BL-08）

**实现文件**
- `src/main/ai-engine.ts` - 按 context.os 分支生成不同风格命令

**验收状态**
- ✅ Windows 类型服务器的 AI 命令默认生成 PowerShell 风格
- ✅ Linux 类型继续生成 shell 命令

---

### F7. 清空聊天记录 / 会话管理 UI（BL-06）

**实现文件**
- `src/main/index.ts` - message:clear IPC
- `src/preload/index.ts` - messageClear API
- `src/renderer/App.tsx` - clearServerMessages 函数，服务器列表 hover 菜单增加"清空"按钮

**验收状态**
- ✅ 清空后 UI 立即刷新
- ✅ 重启后消息仍为空

---

### F8. 调试日志与临时展示清理（BL-07）

**实现文件**
- `src/renderer/App.tsx` - 删除所有 console.log debug 输出，删除 [DEBUG] UI 文案

**验收状态**
- ✅ 页面不再出现 debug 文案
- ✅ 控制台只保留有意义错误信息

---

### F10. 终端复制行为

**实现文件**
- `src/renderer/components/TerminalView.tsx` - Ctrl/Cmd+C 时复制选中内容

**验收状态**
- ✅ 选中终端文本后按 Ctrl/Cmd+C 可复制
- ✅ 无选中时 Ctrl+C 不拦截，保持终端中断行为

---

### F11. 模式切换终端保持

**实现文件**
- `src/renderer/App.tsx` - TerminalView 常驻，用 CSS class 切换显示而非卸载重建
- `src/renderer/components/TerminalView.tsx` - 新增 active prop，切回人工时重新 fit + focus + resize

**验收状态**
- ✅ 切换到 AI 再切回人工，终端历史内容保留
- ✅ 切回人工时自动聚焦终端

---

### F12. AI 任务卡片化

**实现文件**
- `src/renderer/App.tsx` - 大幅重构 AI 模式渲染区：
  - 消息气泡改为任务卡片流
  - 输出默认预览 8 行，支持折叠展开
  - 每条结果提供"复制命令"、"再次执行"、"转人工终端执行"操作
  - AI 顶部工作区：快捷意图按钮、执行模式状态、终端状态提示
  - 底部输入区升级为多行 textarea 工作台

**验收状态**
- ✅ AI 模式信息密度明显提升，不再大面积黑框输出
- ✅ 快捷意图按钮可用
- ✅ 命令操作按钮可用

---

### F13. 项目结构清理

**实现文件**
- 根目录删除：test-app/、test-electron.js、test-minimal.js、test-pkg.json、test-run、err.txt、out.txt、stderr.log、stderr.txt、stdout.txt、test-err*.log、test-out*.log
- 删除过期构建产物：dist/、out/、根目录 index.html
- 新增：`.gitignore`

**验收状态**
- ✅ 根目录干净，只保留必要项目文件
- ✅ 临时日志文件不会再回到项目目录

---

### F14. 统一日志管理

**实现文件**
- `src/main/logger.ts` - 新增统一日志模块
- `src/main/index.ts` - 启动、退出、未捕获异常、未处理 Promise 拒绝均记日志
- `src/main/database.ts` - 错误改为统一日志
- `src/main/credential-manager.ts` - 错误改为统一日志
- `src/preload/index.ts` - 暴露 logWrite、logPaths API
- `src/renderer/App.tsx` - 前端错误上报到主进程日志

**日志位置**
- `%APPDATA%/ops-claw/logs/app.log`
- `%APPDATA%/ops-claw/logs/error.log`

**验收状态**
- ✅ 主进程运行日志统一落盘
- ✅ 渲染进程关键错误上报到主进程
- ✅ 日志不再散落在项目根目录

---

## 5. 待实现功能

### F9. 私钥认证支持

**当前状态**
- 数据结构已支持 privateKey 字段
- UI 未支持录入
- 安全存储未实现

**涉及文件**
- `src/renderer/App.tsx` - 添加服务器对话框增加认证方式选择
- `src/main/database.ts` - 私钥存储逻辑
- `src/main/credential-manager.ts` - 私钥安全存储
- `src/main/server-manager.ts` - 连接时使用私钥

**建议提交名**
- `feat: support SSH private key authentication`

---

## 6. 推荐后续增强

以下为已实现功能的基础上，可进一步提升体验的方向：

### R1. AI 任务实时状态指示

**目标**
- AI 生成命令时显示"正在生成..."
- 命令执行时显示"正在执行..."
- 执行完成后状态切换为"已完成"或"执行失败"

**涉及文件**
- `src/renderer/App.tsx` - 任务卡片增加实时状态
- `src/main/index.ts` - 可能需要事件推送或轮询机制

---

### R2. AI 结果后续建议

**目标**
- AI 执行完成后，在结果区显示"下一步建议"
- 例如："建议查看 Nginx 日志"、"建议检查服务状态"

**涉及文件**
- `src/main/ai-engine.ts` - AI prompt 增加后续建议输出
- `src/renderer/App.tsx` - 任务卡片增加后续建议区

---

### R3. 日志查看入口

**目标**
- 在设置页增加"打开日志目录"按钮
- 或直接在应用内提供简单日志查看器

**涉及文件**
- `src/renderer/App.tsx` - 设置对话框增加按钮
- `src/preload/index.ts` - 可能需要 shell.openPath API

---

### R4. AI 命令编辑后再执行

**目标**
- confirm 模式下，用户可先编辑 AI 生成的命令，再执行

**涉及文件**
- `src/renderer/App.tsx` - 命令区改为可编辑输入框

---

### R5. 多命令批量执行

**目标**
- AI 生成多行命令时，支持逐条或批量执行

**涉及文件**
- `src/main/ai-engine.ts` - AI 可返回命令数组
- `src/renderer/App.tsx` - 执行逻辑调整

---

### R6. 命令历史与收藏

**目标**
- 保存常用命令，一键执行

**涉及文件**
- `src/main/database.ts` - 新增命令历史/收藏数据结构
- `src/renderer/App.tsx` - UI 入口

---

### R7. SFTP 文件传输

**目标**
- 支持简单的文件上传/下载

**涉及文件**
- `src/main/server-manager.ts` - SFTP 功能
- `src/renderer/App.tsx` - 文件传输 UI

---

## 7. 核心文件清单

### 主进程
- `src/main/index.ts`
- `src/main/server-manager.ts`
- `src/main/database.ts`
- `src/main/credential-manager.ts`
- `src/main/ai-engine.ts`
- `src/main/logger.ts`

### preload
- `src/preload/index.ts`

### 前端
- `src/renderer/App.tsx`
- `src/renderer/store.ts`
- `src/renderer/components/TerminalView.tsx`

### 配置
- `package.json`
- `.gitignore`

---

## 8. 数据存储位置

- **服务器配置 & AI 配置**: `%APPDATA%/ops-claw/ops-claw-data.json`
- **加密密码**: `%APPDATA%/ops-claw/credentials.json` (通过 Electron safeStorage 加密)
- **应用日志**: `%APPDATA%/ops-claw/logs/app.log`
- **错误日志**: `%APPDATA%/ops-claw/logs/error.log`

---

## 9. 最终建议

当前项目已完成核心功能闭环，具备完整可用性：

1. ✅ 安全性补齐（密码、API Key 加密存储）
2. ✅ 正确性补齐（AI 执行模式、SSH 生命周期）
3. ✅ 核心交互闭环（交互式终端、工作区恢复、任务卡片化）
4. ✅ 日志与项目结构规范化

推荐下一步优先级：

1. **私钥认证支持**（补齐认证能力）
2. **AI 命令编辑**（提升 confirm 模式灵活性）
3. **日志查看入口**（便于排查问题）

如果需要继续迭代，建议按照 R1-R7 顺序逐步增强体验。