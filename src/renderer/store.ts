import { create } from 'zustand';

interface ServerConfig {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  type: 'linux' | 'windows';
}

interface Tab {
  id: string;
  serverId: number;
  serverName: string;
  serverType: 'linux' | 'windows';
  messages: Message[];
  isConnected: boolean;
  connectionId?: string;
  shellSessionId?: string;
  shellStatus?: 'idle' | 'creating' | 'ready' | 'closed' | 'error';
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  command?: string;
  output?: string;
  exitCode?: number;
  timestamp: Date;
  analysis?: string;
  suggestions?: string[];
  nextCommand?: string;
  nextCommandReason?: string;
  agentResult?: any;
}

interface AppState {
  servers: ServerConfig[];
  tabs: Tab[];
  activeTabId: string | null;
  inputValue: string;
  mode: 'manual' | 'ai';

  // Actions
  setServers: (servers: ServerConfig[]) => void;
  addTab: (tab: Tab) => void;
  setTabs: (tabs: Tab[]) => void;
  removeTab: (tabId: string) => void;
  clearTabs: () => void;
  setActiveTab: (tabId: string | null) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  clearMessages: (tabId: string) => void;
  addMessage: (tabId: string, message: Message) => void;
  updateLastMessage: (tabId: string, updates: Partial<Message>) => void;
  setInputValue: (value: string) => void;
  setMode: (mode: 'manual' | 'ai') => void;
}

export const useAppStore = create<AppState>((set) => ({
  servers: [],
  tabs: [],
  activeTabId: null,
  inputValue: '',
  mode: 'manual',

  setServers: (servers) => set({ servers }),
  addTab: (tab) => set((state) => ({
    tabs: [...state.tabs, tab],
    activeTabId: tab.id
  })),
  setTabs: (tabs) => set({ tabs }),
  removeTab: (tabId) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== tabId);
    return {
      tabs: newTabs,
      activeTabId: state.activeTabId === tabId
        ? (newTabs.length > 0 ? newTabs[0].id : null)
        : state.activeTabId
    };
  }),
  clearTabs: () => set({ tabs: [], activeTabId: null }),
  setActiveTab: (tabId) => set({ activeTabId: tabId }),
  updateTab: (tabId, updates) => set((state) => ({
    tabs: state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, ...updates } : tab
    )
  })),
  clearMessages: (tabId) => set((state) => ({
    tabs: state.tabs.map(tab =>
      tab.id === tabId ? { ...tab, messages: [] } : tab
    )
  })),
  addMessage: (tabId, message) => set((state) => ({
    tabs: state.tabs.map(tab =>
      tab.id === tabId
        ? { ...tab, messages: [...tab.messages, message] }
        : tab
    )
  })),
  updateLastMessage: (tabId: string, updates) => set((state) => ({
    tabs: state.tabs.map(tab => {
      if (tab.id !== tabId || tab.messages.length === 0) return tab;
      const newMessages = [...tab.messages];
      const lastMessage = newMessages[newMessages.length - 1];
      newMessages[newMessages.length - 1] = { ...lastMessage, ...updates };
      return { ...tab, messages: newMessages };
    })
  })),
  setInputValue: (value) => set({ inputValue: value }),
  setMode: (mode) => set({ mode }),
}));
