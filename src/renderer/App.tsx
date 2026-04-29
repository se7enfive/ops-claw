import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAppStore } from './store';
import { TerminalView } from './components/TerminalView';
import { ToastContainer, toast } from './components/Toast';
import { SecurityWarning } from './components/SecurityWarning';
import { BudgetIndicator } from './components/BudgetIndicator';
import { RecoveryPrompt } from './components/RecoveryPrompt';
import { PermissionModeSelector } from './components/PermissionModeSelector';
import { ThemeToggle, initTheme } from './components/ThemeToggle';
import { AgentTaskPanel } from './components/AgentTaskPanel';
import { AIConfigDialog } from './components/AIConfigDialog';
import './App.css';

// 在 React 渲染前应用主题，避免闪白
initTheme();

type PendingCommand = {
  command: string;
  explanation: string;
};

type WorkspaceState = {
  openTabs?: { id: string, serverId: number }[];
  openServerIds?: number[];
  activeTabId: string | null;
  mode: 'manual' | 'ai';
};

type AIRequestCard = {
  id: string;
  prompt: string;
  timestamp: Date;
  explanation?: string;
  command?: string;
  result?: {
    id: string;
    status: 'success' | 'error';
    content: string;
    output?: string;
    exitCode?: number;
    timestamp: Date;
  };
  analysis?: string;
  suggestions?: string[];
  nextCommand?: string;
  nextCommandReason?: string;
};

const WORKSPACE_STORAGE_KEY = 'ops-claw-workspace';
const AI_OUTPUT_PREVIEW_LINES = 8;
const AI_QUICK_PROMPTS: Record<'linux' | 'windows', string[]> = {
  linux: [
    '查看系统信息',
    '检查磁盘使用情况',
    '查看内存和 CPU 占用',
    '查看最近登录用户',
    '查看最近 100 行系统日志',
  ],
  windows: [
    '查看系统信息',
    '检查磁盘使用情况',
    '查看内存和 CPU 占用',
    '查看最近启动的服务',
    '查看最近系统事件日志',
  ],
};

const copyText = async (text: string) => {
  if (!text) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
};

const logRendererError = async (scope: string, message: string, error?: unknown) => {
  try {
    await window.electronAPI.logWrite('error', scope, message, error);
  } catch {
    // ignore
  }
};

function App() {
  const {
    servers,
    tabs,
    activeTabId,
    inputValue,
    mode,
    setServers,
    addTab,
    setTabs,
    removeTab,
    setActiveTab,
    addMessage,
    clearMessages,
    updateTab,
    setInputValue,
    setMode,
  } = useAppStore();

  const messagesEndRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingServer, setEditingServer] = useState<any>(null);
  const [form, setForm] = useState({ name: '', host: '', port: 22, username: '', password: '', type: 'linux' as 'linux' | 'windows' });
  const [submitting, setSubmitting] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<Record<number, PendingCommand>>({});
  const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({});
  const [aiAnalyzingCards, setAiAnalyzingCards] = useState<Record<string, boolean>>({});
  const [currentPrompt, setCurrentPrompt] = useState<string>('');
  // 安全分析状态
  const [securityWarning, setSecurityWarning] = useState<{
    analysis: SecurityAnalysisResult;
    command: string;
    tabId: string;
    connectionId: string;
    userPrompt: string;
    os: 'linux' | 'windows';
  } | null>(null);
  // 会话上下文状态
  const [sessionContexts, setSessionContexts] = useState<Record<number, SessionContext>>({});
  // 会话恢复状态
  const [recoveryInfo, setRecoveryInfo] = useState<RecoveryInfo | null>(null);
  // 权限模式
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('standard');

  // Agent 执行状态
  const [executingAgentTabIds, setExecutingAgentTabIds] = useState<Set<string>>(new Set());
  const [decomposingTabIds, setDecomposingTabIds] = useState<Set<string>>(new Set());

  // Sidebar Resize Logic
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return parseInt(localStorage.getItem('sidebarWidth') || '288', 10);
  });
  const isResizing = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(e.clientX, 800)); // Constraint: 200px - 800px
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        localStorage.setItem('sidebarWidth', sidebarWidth.toString());
        document.body.style.cursor = '';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [sidebarWidth]);

  useEffect(() => { loadServers(); }, []);

  // 启动时检查会话恢复 + 加载权限配置
  useEffect(() => {
    window.electronAPI.recoveryCheck().then(info => {
      if (info.hasRecovery) setRecoveryInfo(info);
    }).catch(() => {});
    window.electronAPI.permissionGetConfig().then(config => {
      setPermissionMode(config.mode);
    }).catch(() => {});

    // 监听 Agent 进度更新
    const removeAgentListener = window.electronAPI.onAgentProgress(({ tabId, subTasks }) => {
      const state = useAppStore.getState();
      const lastMsg = state.tabs.find(t => t.id === tabId)?.messages.slice(-1)[0];
      if (lastMsg && lastMsg.agentResult) {
        state.updateLastMessage(tabId, { 
          agentResult: { 
            ...lastMsg.agentResult, 
            subTasks 
          } 
        });
      }
    });

    return () => {
      removeAgentListener();
    };
  }, []);

  useEffect(() => {
    if (!showAddDialog) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') resetForm(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [showAddDialog]);

  useEffect(() => {
    if (activeTabId && messagesEndRefs.current[activeTabId]) {
      messagesEndRefs.current[activeTabId]?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [tabs, activeTabId]);

  useEffect(() => {
    const workspace: WorkspaceState = {
      openTabs: tabs.map((tab) => ({ id: tab.id, serverId: tab.serverId })),
      activeTabId,
      mode,
    };
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  }, [tabs, activeTabId, mode]);

  useEffect(() => {
    const disposeClose = window.electronAPI.onSshShellClose(({ sessionId }) => {
      const tab = tabs.find((item) => item.shellSessionId === sessionId);
      if (!tab) return;
      updateTab(tab.id, { shellSessionId: undefined, shellStatus: 'closed' });
    });

    const disposeError = window.electronAPI.onSshShellError(({ sessionId, error }) => {
      const tab = tabs.find((item) => item.shellSessionId === sessionId);
      if (!tab) return;
      updateTab(tab.id, { shellStatus: 'error' });
      toast.error(`终端错误：${error}`);
    });

    return () => {
      disposeClose();
      disposeError();
    };
  }, [tabs, updateTab]);

  const restoreWorkspace = async (serverList: any[]) => {
    try {
      const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (!raw) return;

      const workspace = JSON.parse(raw) as WorkspaceState;
      let tabConfigs: { id: string, serverId: number }[] = [];

      if (workspace.openTabs) {
        tabConfigs = workspace.openTabs;
      } else if (workspace.openServerIds) {
        tabConfigs = workspace.openServerIds.map(id => ({ id: String(id), serverId: id }));
      }

      const restoredTabs = await Promise.all(
        tabConfigs
          .map((tabCfg) => {
            const server = serverList.find((s) => s.id === tabCfg.serverId);
            return server ? { ...tabCfg, server } : null;
          })
          .filter(Boolean)
          .map(async ({ id, serverId, server }: any) => ({
            id,
            serverId: server.id,
            serverName: server.name,
            serverType: server.type || 'linux',
            messages: (await window.electronAPI.messageList(id)).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
            isConnected: false,
            connectionId: undefined,
            shellSessionId: undefined,
            shellStatus: 'idle' as const,
          }))
      );

      setTabs(restoredTabs);
      
      const activeTabIdStr = String(workspace.activeTabId);
      if (workspace.activeTabId && restoredTabs.some((tab) => tab.id === activeTabIdStr)) {
        setActiveTab(activeTabIdStr);
      } else {
        setActiveTab(restoredTabs.length > 0 ? restoredTabs[0].id : null);
      }
      setMode(workspace.mode || 'manual');
    } catch (e) {
      void logRendererError('renderer:app', '恢复工作区失败', e);
    }
  };

  const loadServers = async () => {
    try {
      const list = await window.electronAPI.serverList();
      setServers(list);
      await restoreWorkspace(list);
    } catch (e) {
      void logRendererError('renderer:app', '加载服务器列表失败', e);
      toast.error('加载服务器列表失败');
    }
  };

  const resetForm = () => {
    setForm({ name: '', host: '', port: 22, username: '', password: '', type: 'linux' });
    setEditingServer(null);
    setShowAddDialog(false);
  };

  const openAddDialog = () => { resetForm(); setShowAddDialog(true); };

  const openSettings = () => {
    setShowSettings(true);
  };

  const openEditDialog = (server: any) => {
    setForm({
      name: server.name, host: server.host, port: server.port || 22,
      username: server.username, password: '', type: server.type || 'linux',
    });
    setEditingServer(server);
    setShowAddDialog(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast.error('请填写名称、主机地址和用户名');
      return;
    }
    setSubmitting(true);
    try {
      if (editingServer) {
        const d: any = { ...form };
        if (!d.password) delete d.password;
        await window.electronAPI.serverUpdate(editingServer.id, d);
        toast.success('服务器已更新');
      } else {
        await window.electronAPI.serverAdd(form);
        toast.success('服务器已添加');
      }
      resetForm();
      await loadServers();
    } catch (e: any) {
      toast.error(`操作失败：${e.message}`);
    }
    setSubmitting(false);
  };

  const deleteServer = async (serverId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个服务器吗？')) return;
    try {
      // Disconnect and remove all tabs belonging to this server
      const serverTabs = tabs.filter(t => t.serverId === serverId);
      for (const tab of serverTabs) {
        await disconnectServer(tab.id);
        removeTab(tab.id);
      }
      
      await window.electronAPI.serverDelete(serverId);
      setPendingCommands((current) => {
        const next = { ...current };
        // Clean up pending commands for all related tabs
        serverTabs.forEach(t => delete next[t.id]);
        return next;
      });
      await loadServers();
      toast.success('服务器已删除');
    } catch (e: any) {
      toast.error(`删除失败：${e.message}`);
    }
  };

  const createShellSession = async (tabId: string, connectionId: string) => {
    updateTab(tabId, { shellStatus: 'creating' });
    const result = await window.electronAPI.sshShellCreate(connectionId, 120, 30);
    if (!result.success || !result.sessionId) {
      updateTab(tabId, { shellStatus: 'error' });
      throw new Error(result.error || '创建终端会话失败');
    }

    updateTab(tabId, {
      shellSessionId: result.sessionId,
      shellStatus: 'ready'
    });

    // 初始化上下文：获取主机名和当前目录
    try {
      const hostnameResult = await window.electronAPI.sshExecute(connectionId, 'hostname');
      const pwdResult = await window.electronAPI.sshExecute(connectionId, 'pwd');

      const hostname = hostnameResult.success ? hostnameResult.stdout?.trim() : undefined;
      const currentDirectory = pwdResult.success ? pwdResult.stdout?.trim() : undefined;

      await window.electronAPI.contextUpdate(tabId, {
        hostname,
        currentDirectory
      });

      const updatedContext = await window.electronAPI.contextGet(tabId);
      setSessionContexts((current) => ({ ...current, [tabId]: updatedContext }));
    } catch {
      // 初始化上下文失败不影响连接
    }

    return result.sessionId;
  };

  const connectServer = async (server: any, forceNewTab = false) => {
    try {
      const existingTab = !forceNewTab ? tabs.find((t) => t.serverId === server.id) : undefined;
      if (existingTab && existingTab.isConnected) {
        setActiveTab(existingTab.id);
        return;
      }
      
      const result = await window.electronAPI.sshConnect(server.id);
      if (result.success) {
        const tabId = existingTab ? existingTab.id : `tab-${server.id}-${Date.now()}`;
        const savedMessages = await window.electronAPI.messageList(tabId);
        const savedContext = await window.electronAPI.contextGet(tabId);
        setSessionContexts((current) => ({ ...current, [tabId]: savedContext }));

        if (existingTab) {
          updateTab(tabId, {
            serverName: server.name,
            serverType: server.type || 'linux',
            messages: savedMessages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
            isConnected: true,
            connectionId: result.connectionId,
            shellStatus: 'idle',
          });
          setActiveTab(tabId);
        } else {
          addTab({
            id: tabId,
            serverId: server.id, serverName: server.name,
            serverType: server.type || 'linux',
            messages: savedMessages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
            isConnected: true,
            connectionId: result.connectionId,
            shellStatus: 'idle',
          });
        }
        await createShellSession(tabId, result.connectionId);
        toast.success(`已连接 ${server.name}`);
      } else {
        toast.error(`连接失败：${result.error}`);
      }
    } catch (e: any) {
      toast.error(`连接失败：${e.message}`);
    }
  };

  const disconnectServer = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.shellSessionId) {
      await window.electronAPI.sshShellClose(tab.shellSessionId);
    }

    if (tab.connectionId) {
      await window.electronAPI.sshDisconnect(tab.connectionId);
    }

    updateTab(tabId, {
      isConnected: false,
      connectionId: undefined,
      shellSessionId: undefined,
      shellStatus: 'closed'
    });
  };

  const executeCommandAndAnalyze = async (
    tabId: string,
    connectionId: string,
    command: string,
    userPrompt: string,
    os: 'linux' | 'windows',
    skipSecurityCheck = false
  ) => {
    // 安全分析：仅在 AI 模式下且未跳过时检查
    if (!skipSecurityCheck) {
      try {
        const analysis = await window.electronAPI.commandAnalyze(command);
        if (analysis.blocked) {
          setSecurityWarning({ analysis, command, tabId, connectionId, userPrompt, os });
          return;
        }
        if (analysis.requiresConfirmation) {
          setSecurityWarning({ analysis, command, tabId, connectionId, userPrompt, os });
          return;
        }
      } catch {
        // 安全分析失败不阻止执行
      }
    }

    const execResult = await window.electronAPI.sshExecute(connectionId, command);
    const resultContent = execResult.success ? '执行成功' : '执行失败';
    const output = execResult.stdout || execResult.stderr || execResult.error;
    const sysId = Date.now().toString() + '-sys';

    addMessage(tabId, {
      id: sysId,
      role: 'system',
      content: resultContent,
      command,
      output,
      exitCode: execResult.exitCode,
      timestamp: new Date()
    });
    window.electronAPI.messageSave(tabId, {
      id: sysId,
      role: 'system',
      content: resultContent,
      command,
      output,
      exitCode: execResult.exitCode,
      timestamp: new Date().toISOString()
    });

    // 更新上下文：尝试从命令输出中提取当前目录
    let newDirectory: string | undefined;
    if (command.includes('pwd') || command.includes('cd')) {
      // 对于 pwd 命令，输出本身就是目录
      if (command.trim() === 'pwd' || command.startsWith('pwd ')) {
        newDirectory = output.trim().split('\n').pop();
      }
      // 对于 cd 命令，可能需要后续 pwd 来确认
      // 暂时不处理复杂的 cd 情况
    }

    // 更新上下文到后端
    await window.electronAPI.contextUpdate(tabId, {
      lastExitCode: execResult.exitCode,
      ...(newDirectory ? { currentDirectory: newDirectory } : {})
    });

    // 获取最新上下文
    const updatedContext = await window.electronAPI.contextGet(tabId);
    setSessionContexts((current) => ({ ...current, [tabId]: updatedContext }));

    setAiAnalyzingCards((current) => ({ ...current, [sysId]: true }));

    try {
      const analyzeResult = await window.electronAPI.aiAnalyze(
        tabId,
        userPrompt,
        command,
        output,
        execResult.exitCode,
        {
          os,
          currentDirectory: updatedContext.currentDirectory,
          hostname: updatedContext.hostname,
          taskGoal: updatedContext.taskGoal
        }
      );

      const analyzeId = Date.now().toString() + '-analyze';
      addMessage(tabId, {
        id: analyzeId,
        role: 'assistant',
        content: analyzeResult.analysis,
        suggestions: analyzeResult.suggestions,
        nextCommand: analyzeResult.nextCommand,
        nextCommandReason: analyzeResult.nextCommandReason,
        timestamp: new Date()
      });
      window.electronAPI.messageSave(tabId, {
        id: analyzeId,
        role: 'assistant',
        content: analyzeResult.analysis,
        suggestions: analyzeResult.suggestions,
        nextCommand: analyzeResult.nextCommand,
        nextCommandReason: analyzeResult.nextCommandReason,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      toast.error(`AI 分析失败：${error.message}`);
    } finally {
      setAiAnalyzingCards((current) => {
        const next = { ...current };
        delete next[sysId];
        return next;
      });
    }
  };

  const sendMessage = async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? inputValue).trim();
    if (!prompt || !activeTabId) return;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.connectionId) {
      toast.error('请先连接到服务器');
      return;
    }

    if (decomposingTabIds.has(activeTabId) || executingAgentTabIds.has(activeTabId)) {
      toast.warn('请等待当前任务处理完成');
      return;
    }

    const uid = Date.now().toString();
    addMessage(activeTabId, { id: uid, role: 'user', content: prompt, timestamp: new Date() });
    window.electronAPI.messageSave(activeTabId, { id: uid, role: 'user', content: prompt, timestamp: new Date().toISOString() });
    setInputValue('');

    try {
      if (mode === 'ai') {
        setCurrentPrompt(prompt);
        setDecomposingTabIds(prev => new Set(prev).add(activeTabId));

        try {
          // 获取当前上下文
          const activeTab = tabs.find(t => t.id === activeTabId)!;
          const currentContext = await window.electronAPI.contextGet(activeTabId);

          // 使用 Agent 分解任务
          const decomposition = await window.electronAPI.agentDecompose(
            prompt,
            {
              sessionId: activeTabId,
              serverId: activeTab.serverId,
              connectionId: activeTab.connectionId,
              shellSessionId: activeTab.shellSessionId,
              os: activeTab.serverType,
              sessionContext: currentContext,
              permissionMode: permissionMode,
              availableTools: [] // 让后端自己加载
            }
          );

          const agentMsgId = Date.now().toString() + '-agent';
        const agentMessage = {
          id: agentMsgId,
          role: 'assistant' as const,
          content: decomposition.reasoning || '正在制定计划...',
          agentResult: {
            agentName: decomposition.suggestedAgent || 'general',
            subTasks: decomposition.subTasks,
            userPrompt: prompt,  // 保存用户原始意图，用于执行和分析
            success: false,
            errors: [],
            durationMs: 0
          },
          timestamp: new Date()
        };

        addMessage(activeTabId, agentMessage);
        window.electronAPI.messageSave(activeTabId, {
          ...agentMessage,
          timestamp: agentMessage.timestamp.toISOString()
        });

        // 只有在有子任务时才自动开始执行计划
        if (agentMessage.agentResult.subTasks.length > 0) {
          handleExecuteAgentPlan(activeTabId, agentMessage.agentResult.agentName, agentMessage.agentResult.subTasks, prompt);
        } else {
          // 如果没有子任务，则任务执行视为“成功”（仅为了结束加载状态）
          useAppStore.getState().updateLastMessage(activeTabId, {
            agentResult: {
              ...agentMessage.agentResult,
              success: true
            }
          });
        }
      } finally {
        setDecomposingTabIds(prev => {
          const next = new Set(prev);
          next.delete(activeTabId);
          return next;
        });
      }

      return;
    }
      
    if (!activeTab.shellSessionId) {
        toast.error('交互式终端尚未就绪');
        return;
      }

      await window.electronAPI.sshShellWrite(activeTab.shellSessionId, `${prompt}\n`);
    } catch (error: any) {
      toast.error(`发送失败：${error.message}`);
    }
  };

  const handleExecuteAgentPlan = async (tabId: string, agentName: string, subTasks: SubTask[], userPrompt: string) => {
    if (executingAgentTabIds.has(tabId)) return;

    setExecutingAgentTabIds(prev => new Set(prev).add(tabId));

    try {
      const activeTab = tabs.find(t => t.id === tabId)!;
      const currentContext = await window.electronAPI.contextGet(tabId);

      const result = await window.electronAPI.agentExecute(
        agentName,
        subTasks,
        {
          sessionId: tabId,
          serverId: activeTab.serverId,
          connectionId: activeTab.connectionId,
          shellSessionId: activeTab.shellSessionId,
          os: activeTab.serverType,
          sessionContext: currentContext,
          permissionMode: permissionMode,
          availableTools: []
        },
        userPrompt
      );

      // 执行完成后，更新最后一条消息
      useAppStore.getState().updateLastMessage(tabId, {
        agentResult: result,
        content: result.overallOutput || (result.success ? '任务执行成功。' : '任务执行遇到错误。')
      });

      // 更新上下文：保存任务历史和结果摘要（使用后端方法自动限制长度）
      const completedTasks = result.subTasks.filter(t => t.status === 'completed' && t.result);
      if (completedTasks.length > 0) {
        // 构建结果摘要
        const resultSummary = completedTasks.map(t => {
          const output = t.result?.stdout || t.result?.stderr || '';
          // 智能截取：提取关键信息而非简单截断
          const meaningfulLines = output.split('\n')
            .filter(line => {
              const trimmed = line.trim();
              return trimmed.length > 0 && trimmed.length < 200;
            })
            .slice(0, 5);
          return `[${t.description}]\n${meaningfulLines.join('\n')}`;
        }).join('\n');

        // 使用后端的 contextAddTaskStep 方法（自动限制在 20 条）
        await window.electronAPI.contextAddTaskStep(tabId, {
          timestamp: new Date().toISOString(),
          action: 'intent',
          content: userPrompt
        });

        await window.electronAPI.contextAddTaskStep(tabId, {
          timestamp: new Date().toISOString(),
          action: 'result',
          content: resultSummary.substring(0, 500), // 限制单条结果长度
          result: result.analysis?.summary || result.overallOutput?.substring(0, 200)
        });

        // 更新任务目标
        await window.electronAPI.contextUpdate(tabId, {
          taskGoal: userPrompt
        });

        // 获取更新后的上下文
        const updatedContext = await window.electronAPI.contextGet(tabId);
        setSessionContexts((current) => ({ ...current, [tabId]: updatedContext }));
      }

      if (result.success) {
        toast.success('Agent 任务执行完成');
      } else {
        toast.error('Agent 任务执行失败');
      }
    } catch (e: any) {
      toast.error(`执行出错: ${e.message}`);
    } finally {
      setExecutingAgentTabIds(prev => {
        const next = new Set(prev);
        next.delete(tabId);
        return next;
      });
    }
  };

  const confirmPendingCommand = async () => {
    if (!activeTabId) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const pending = pendingCommands[activeTabId];
    if (!activeTab?.connectionId || !pending) return;

    try {
      await executeCommandAndAnalyze(activeTabId, activeTab.connectionId, pending.command, currentPrompt, activeTab.serverType, true);
      setPendingCommands((current) => {
        const next = { ...current };
        delete next[activeTabId];
        return next;
      });
    } catch (error: any) {
      toast.error(`执行失败：${error.message}`);
    }
  };

  const cancelPendingCommand = () => {
    if (!activeTabId) return;
    setPendingCommands((current) => {
      const next = { ...current };
      delete next[activeTabId];
      return next;
    });
  };

  const closeTab = async (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await disconnectServer(tabId);
    } catch (error: any) {
      toast.error(`断开连接失败：${error.message}`);
    }
    setPendingCommands((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    removeTab(tabId);
  };

  const clearServerMessages = async (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要清空这个标签页的聊天记录吗？')) return;
    try {
      await window.electronAPI.messageClear(tabId);
      await window.electronAPI.contextClear(tabId);  // 同时清除上下文
      clearMessages(tabId);
      setSessionContexts((current) => {
        const next = { ...current };
        delete next[tabId];
        return next;
      });
      setPendingCommands((current) => {
        const next = { ...current };
        delete next[tabId];
        return next;
      });
      setExpandedOutputs({});
      toast.success('聊天记录已清空');
    } catch (error: any) {
      toast.error(`清空失败：${error.message}`);
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activePendingCommand = activeTabId ? pendingCommands[activeTabId] : undefined;
  const terminalStatusText = !activeTab?.isConnected
    ? '未连接'
    : activeTab.shellStatus === 'creating'
      ? '终端连接中'
      : activeTab.shellStatus === 'ready'
        ? '终端已连接'
        : activeTab.shellStatus === 'closed'
          ? '终端已关闭'
          : activeTab.shellStatus === 'error'
            ? '终端异常'
            : '终端待初始化';

  const aiCards = useMemo<AIRequestCard[]>(() => {
    if (!activeTab) return [];

    const cards: AIRequestCard[] = [];
    for (const message of activeTab.messages) {
      if (message.role === 'user') {
        cards.push({
          id: message.id,
          prompt: message.content,
          timestamp: message.timestamp,
        });
        continue;
      }

      const currentCard = cards[cards.length - 1];
      if (!currentCard) continue;

      if (message.role === 'assistant') {
        if (message.command) {
          currentCard.explanation = message.content;
          currentCard.command = message.command;
        } else if (message.analysis || message.suggestions || message.nextCommand) {
          currentCard.analysis = message.analysis || message.content;
          currentCard.suggestions = message.suggestions;
          currentCard.nextCommand = message.nextCommand;
          currentCard.nextCommandReason = message.nextCommandReason;
        } else {
          currentCard.explanation = message.content;
        }
        continue;
      }

      if (message.role === 'system') {
        currentCard.result = {
          id: message.id,
          status: message.content === '执行成功' ? 'success' : 'error',
          content: message.content,
          output: message.output,
          exitCode: message.exitCode,
          timestamp: message.timestamp,
        };
        if (message.command) currentCard.command = message.command;
      }
    }

    return cards;
  }, [activeTab]);

  const pendingCardId = useMemo(() => {
    if (!activePendingCommand) return undefined;
    const pendingCard = [...aiCards].reverse().find((card) => !card.result && card.command === activePendingCommand.command);
    return pendingCard?.id;
  }, [activePendingCommand, aiCards]);

  const quickPrompts = activeTab ? AI_QUICK_PROMPTS[activeTab.serverType] : AI_QUICK_PROMPTS.linux;

  const toggleOutput = (cardId: string) => {
    setExpandedOutputs((current) => ({
      ...current,
      [cardId]: !current[cardId],
    }));
  };

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await copyText(text);
      toast.success(successMessage);
    } catch (error: any) {
      toast.error(`复制失败：${error.message}`);
    }
  };

  const repeatAiCommand = async (command: string, prompt?: string) => {
    if (!activeTabId) return;
    const currentTab = tabs.find((tab) => tab.id === activeTabId);
    if (!currentTab?.connectionId) {
      toast.error('请先连接到服务器');
      return;
    }

    const repeatPrompt = prompt || `再次执行：${command}`;
    const uid = Date.now().toString();
    setCurrentPrompt(repeatPrompt);
    addMessage(activeTabId, { id: uid, role: 'user', content: repeatPrompt, timestamp: new Date() });
    window.electronAPI.messageSave(activeTabId, { id: uid, role: 'user', content: repeatPrompt, timestamp: new Date().toISOString() });
    addMessage(activeTabId, { id: uid + '-ai', role: 'assistant', content: '复用命令执行。', command, timestamp: new Date() });
    window.electronAPI.messageSave(activeTabId, { id: uid + '-ai', role: 'assistant', content: '复用命令执行。', command, timestamp: new Date().toISOString() });

    if (aiConfig.executionMode === 'confirm') {
      try {
        const analysis = await window.electronAPI.commandAnalyze(command);
        if (analysis.blocked) {
          setSecurityWarning({
            analysis, command,
            tabId: activeTabId,
            connectionId: currentTab.connectionId,
            userPrompt: repeatPrompt,
            os: currentTab.serverType,
          });
          return;
        }
        if (analysis.requiresConfirmation) {
          setPendingCommands((current) => ({
            ...current,
            [activeTabId]: { command, explanation: '复用命令执行。' }
          }));
          return;
        }
      } catch {
        setPendingCommands((current) => ({
          ...current,
          [activeTabId]: { command, explanation: '复用命令执行。' }
        }));
        return;
      }
    }

    try {
      await executeCommandAndAnalyze(activeTabId, currentTab.connectionId, command, repeatPrompt, currentTab.serverType, true);
    } catch (error: any) {
      toast.error(`执行失败：${error.message}`);
    }
  };

  const continueInTerminal = async (command: string) => {
    if (!activeTabId) return;
    const currentTab = tabs.find((tab) => tab.id === activeTabId);
    if (!currentTab?.connectionId) {
      toast.error('请先连接到服务器');
      return;
    }

    try {
      let sessionId = currentTab.shellSessionId;
      if (!sessionId) {
        sessionId = await createShellSession(activeTabId, currentTab.connectionId);
      }
      setMode('manual');
      await window.electronAPI.sshShellWrite(sessionId, `${command}\n`);
    } catch (error: any) {
      toast.error(`转到人工终端失败：${error.message}`);
    }
  };

  const handleSecurityConfirm = async () => {
    if (!securityWarning) return;
    const { tabId, connectionId, command, userPrompt, os } = securityWarning;
    setSecurityWarning(null);
    try {
      await executeCommandAndAnalyze(tabId, connectionId, command, userPrompt, os, true);
    } catch (error: any) {
      toast.error(`执行失败：${error.message}`);
    }
  };

  const handleSecurityCancel = () => {
    setSecurityWarning(null);
    toast.info('已取消执行');
  };

  const handleSecurityUseAlternative = (alternative: string) => {
    if (!securityWarning) return;
    const { tabId, connectionId, userPrompt, os } = securityWarning;
    setSecurityWarning(null);
    // 将替代命令作为新命令执行（仍要安全检查）
    executeCommandAndAnalyze(tabId, connectionId, alternative, userPrompt, os).catch((error: any) => {
      toast.error(`执行失败：${error.message}`);
    });
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <ToastContainer />

      {/* 安全警告弹窗 */}
      {securityWarning && (
        <SecurityWarning
          analysis={securityWarning.analysis}
          command={securityWarning.command}
          onConfirm={handleSecurityConfirm}
          onCancel={handleSecurityCancel}
          onUseAlternative={securityWarning.analysis.saferAlternative ? handleSecurityUseAlternative : undefined}
        />
      )}

      {/* 会话恢复弹窗 */}
      {recoveryInfo && (
        <RecoveryPrompt
          tabIds={recoveryInfo.tabIds}
          lastActivity={recoveryInfo.lastActivity}
          entryCount={recoveryInfo.entryCount}
          onRecover={async () => {
            await window.electronAPI.recoveryConfirm();
            setRecoveryInfo(null);
            toast.success('会话已恢复');
          }}
          onDismiss={async () => {
            await window.electronAPI.recoveryDismiss();
            setRecoveryInfo(null);
          }}
        />
      )}

      <aside className="bg-gray-800 text-white flex flex-col shrink-0 relative" style={{ width: sidebarWidth }}>
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold tracking-wide">服务器</h2>
          <div className="flex gap-1.5">
            <ThemeToggle />
            <button onClick={openSettings} title="AI 设置"
              className="w-7 h-7 rounded-full bg-gray-600 hover:bg-gray-500 flex items-center justify-center text-xs transition-colors">AI</button>
            <button onClick={openAddDialog}
              className="w-7 h-7 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center text-lg leading-none transition-colors">+</button>
          </div>
        </header>
        <nav className="flex-1 overflow-y-auto">
          {servers.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-500 text-sm">
              <div>暂无服务器</div>
              <div className="mt-1 text-xs">点击 + 添加</div>
            </div>
          )}
          {servers.map((server) => (
            <div key={server.id}
              className={`group flex items-center justify-between px-4 py-3 cursor-pointer border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors ${tabs.find(t => t.id === activeTabId)?.serverId === server.id ? 'bg-gray-700' : ''}`}
              onClick={() => {
                const existingTab = tabs.find((t) => t.serverId === server.id);
                if (existingTab) {
                  setActiveTab(existingTab.id);
                  if (!existingTab.isConnected) {
                    connectServer(server);
                  } else if (!existingTab.shellSessionId && existingTab.connectionId) {
                    void createShellSession(existingTab.id, existingTab.connectionId);
                  }
                } else {
                  connectServer(server);
                }
              }}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{server.name}</div>
                <div className="text-xs text-gray-400 mt-0.5 truncate">{server.host}</div>
              </div>
              <div className="hidden group-hover:flex gap-1 ml-2 shrink-0">
                <button onClick={(e) => { e.stopPropagation(); connectServer(server, true); }}
                  className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-green-400 hover:bg-white/10 rounded transition-colors" title="多开终端">+</button>
                <button onClick={(e) => { e.stopPropagation(); openEditDialog(server); }}
                  className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors">编辑</button>
                <button onClick={(e) => deleteServer(server.id, e)}
                  className="px-1.5 py-0.5 text-xs text-gray-400 hover:text-red-400 hover:bg-white/10 rounded transition-colors">删除</button>
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Sidebar Resizer Handle */}
      <div
        className="w-1 bg-gray-300 hover:bg-green-500 cursor-col-resize shrink-0 transition-colors z-10"
        onMouseDown={(e) => {
          e.preventDefault();
          isResizing.current = true;
          document.body.style.cursor = 'col-resize';
        }}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {activeTab ? (
          <>
            <div className="flex bg-white border-b border-gray-200 overflow-x-auto shrink-0">
              {tabs.map((tab) => (
                <div key={tab.id}
                  className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer border-r border-gray-100 text-sm transition-colors ${activeTabId === tab.id ? 'bg-gray-50 border-b-2 border-b-green-500' : 'hover:bg-gray-50'}`}
                  onClick={() => setActiveTab(tab.id)}>
                  <span className={activeTabId === tab.id ? 'text-green-600 font-medium' : 'text-gray-600'}>
                    {tab.serverName} {tabs.filter(t => t.serverId === tab.serverId).length > 1 ? `(${tabs.filter(t => t.serverId === tab.serverId).indexOf(tab) + 1})` : ''}
                  </span>
                  <button onClick={(e) => closeTab(tab.id, e)}
                    className="text-gray-400 hover:text-red-500 text-base leading-none">&times;</button>
                </div>
              ))}
            </div>

            {tabs.map((tab) => {
              const isTabActive = activeTabId === tab.id;
              const tabAiCards = tab.messages.filter((m) => m.role === 'assistant' || m.role === 'user');

              return (
                <div key={tab.id} className={`${isTabActive ? 'flex' : 'hidden'} flex-1 min-h-0 flex-col`}>
                  <div className={`${mode === 'manual' ? 'flex' : 'hidden'} flex-1 min-h-0 p-4 bg-white flex-col gap-3`}>
                    <div className="flex-1 min-h-0">
                      <TerminalView
                        interactive
                        active={isTabActive && mode === 'manual'}
                        sessionId={tab.shellSessionId}
                        status={tab.shellStatus}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 shrink-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex rounded-md overflow-hidden border border-gray-300 shrink-0 bg-white">
                          <button onClick={() => setMode('manual')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'manual' ? 'bg-green-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>人工</button>
                          <button onClick={() => setMode('ai')}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'ai' ? 'bg-green-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>AI</button>
                        </div>
                        <span className="truncate">状态：{tab.shellStatus === 'ready' ? '已连接' : tab.shellStatus === 'creating' ? '连接中...' : tab.shellStatus === 'error' ? '错误' : '未连接'}</span>
                      </div>
                      <div className="text-right text-gray-500 shrink-0">直接在终端内输入；选中文本后按 Ctrl/Cmd+C 复制</div>
                    </div>
                  </div>

                  <div className={`${mode === 'ai' ? 'flex' : 'hidden'} flex-1 min-h-0 bg-gray-50 flex-col`}>
                    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                      {tabAiCards.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-gray-500">
                          <div className="text-base font-medium text-gray-700">让 AI 帮你完成服务器操作</div>
                          <div className="mt-2 text-sm">可以直接提问，也可以点下方快捷任务。AI 会给出命令、执行结果和后续动作。</div>
                        </div>
                      ) : (
                        tabAiCards.map((card, index) => {
                          const isAnalyzing = aiAnalyzingCards[card.id];
                          const hasAgentResult = !!card.agentResult && card.agentResult.subTasks.length > 0;
                          const isUserMessage = card.role === 'user';
                          const isAIMessage = card.role === 'assistant';

                          return (
                            <div key={card.id} className={`rounded-2xl border shadow-sm overflow-hidden ${isUserMessage ? 'border-gray-200 bg-white' : 'border-blue-200 bg-blue-50/30'}`}>
                              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-gray-50">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`text-sm font-semibold ${isUserMessage ? 'text-gray-800' : 'text-blue-800'}`}>
                                    {isUserMessage ? '任务意图' : 'AI 响应'}
                                  </span>
                                  {card.agentResult && !isAnalyzing && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${card.agentResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                      {card.agentResult.success ? '已完成' : '已制定计划'}
                                    </span>
                                  )}
                                  {isAnalyzing && (
                                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">AI 分析中</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 shrink-0">
                                  {card.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              </div>

                              <div className="px-4 py-4 space-y-4">
                                {/* 用户消息：显示意图 */}
                                {isUserMessage && (
                                  <div className={`rounded-xl px-3 py-3 text-sm ${hasAgentResult ? 'bg-green-50 text-gray-800' : 'bg-gray-100 text-gray-700'}`}>
                                    {card.content}
                                  </div>
                                )}

                                {/* AI 消息有任务计划：显示 AgentTaskPanel */}
                                {isAIMessage && hasAgentResult && (
                                  <AgentTaskPanel
                                    agentName={card.agentResult.agentName}
                                    subTasks={card.agentResult.subTasks}
                                    isExecuting={executingAgentTabIds.has(tab.id)}
                                    isCompleted={card.agentResult.success}
                                    overallOutput={card.agentResult.overallOutput}
                                    analysis={card.agentResult.analysis}
                                    onExecute={() => handleExecuteAgentPlan(tab.id, card.agentResult.agentName, card.agentResult.subTasks, card.agentResult.userPrompt || card.content)}
                                    onExecuteNext={(command) => {
                                      sendMessage(command);
                                    }}
                                    onConfirmTask={(taskId, isConfirmed) => {
                                      window.electronAPI.agentConfirm(tab.id, taskId, isConfirmed);
                                    }}
                                  />
                                )}

                                {/* AI 消息无任务计划（对话场景）：显示 AI 响应 */}
                                {isAIMessage && !hasAgentResult && (
                                  <div className="rounded-xl bg-blue-100/50 px-3 py-3 text-sm leading-6 text-gray-700">
                                    {card.content}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })

                      )}
                      <div ref={(el) => { messagesEndRefs.current[tab.id] = el; }} />
                    </div>
                  </div>
                </div>
              );
            })}

            {mode === 'ai' && (
              <div className="bg-white border-t border-gray-200 shrink-0">
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex rounded-md overflow-hidden border border-gray-300 shrink-0 bg-white">
                        <button onClick={() => setMode('manual')}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'manual' ? 'bg-green-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>人工</button>
                        <button onClick={() => setMode('ai')}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'ai' ? 'bg-green-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>AI</button>
                      </div>
                      <PermissionModeSelector
                        currentMode={permissionMode}
                        onModeChange={async (m) => {
                          await window.electronAPI.permissionSetMode(m);
                          setPermissionMode(m);
                        }}
                      />
                      <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium shrink-0">
                        终端：{terminalStatusText}
                      </span>
                      <BudgetIndicator tabId={activeTabId} visible={mode === 'ai'} />
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0 justify-end">
                      {quickPrompts.slice(0, 3).map((prompt) => (
                        <button 
                          key={prompt} 
                          onClick={() => void sendMessage(prompt)}
                          disabled={decomposingTabIds.has(activeTabId) || executingAgentTabIds.has(activeTabId)}
                          className="px-2.5 py-1 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-xs text-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-4 pt-1">
                  <div className="flex items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <textarea value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        disabled={decomposingTabIds.has(activeTabId) || executingAgentTabIds.has(activeTabId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void sendMessage();
                          }
                        }}
                        placeholder={decomposingTabIds.has(activeTabId) || executingAgentTabIds.has(activeTabId) ? "任务处理中..." : "描述你的目标，按 Enter 发送..."}
                        rows={2}
                        className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-colors disabled:bg-gray-100 disabled:text-gray-400" />
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button 
                        onClick={() => void sendMessage()}
                        disabled={decomposingTabIds.has(activeTabId) || executingAgentTabIds.has(activeTabId)}
                        className="px-5 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white text-sm font-medium rounded-md transition-colors">
                        {decomposingTabIds.has(activeTabId) ? '分解中' : executingAgentTabIds.has(activeTabId) ? '执行中' : '发送'}
                      </button>
                      <button onClick={() => setMode('manual')}
                        className="px-5 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium rounded-md transition-colors">转到人工终端</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            <div className="text-center">
              <div className="text-4xl mb-3">💬</div>
              <div>选择左侧服务器开始聊天</div>
              <div className="mt-1 text-xs">或点击 + 添加新服务器</div>
            </div>
          </div>
        )}
      </main>

      {showAddDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-5">{editingServer ? '编辑服务器' : '添加服务器'}</h3>
            <div className="space-y-3">
              <label className="block text-xs text-gray-500">名称
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="我的服务器"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500" />
              </label>
              <label className="block text-xs text-gray-500">主机地址
                <input type="text" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.100"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500" />
              </label>
              <div className="flex gap-3">
                <label className="block text-xs text-gray-500 flex-1">端口
                  <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500" />
                </label>
                <label className="block text-xs text-gray-500 flex-1">系统类型
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'linux' | 'windows' })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 bg-white">
                    <option value="linux">Linux</option>
                    <option value="windows">Windows</option>
                  </select>
                </label>
              </div>
              <label className="block text-xs text-gray-500">用户名
                <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="root"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500" />
              </label>
              <label className="block text-xs text-gray-500">密码
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingServer ? '留空则保留原密码' : '输入 SSH 密码'}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500" />
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={resetForm} disabled={submitting}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors">取消</button>
              <button onClick={handleSubmit} disabled={submitting}
                className="px-4 py-2 text-sm text-white bg-green-500 hover:bg-green-600 rounded-md disabled:opacity-50 transition-colors">
                {submitting ? '提交中...' : editingServer ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <AIConfigDialog onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

export default App;
