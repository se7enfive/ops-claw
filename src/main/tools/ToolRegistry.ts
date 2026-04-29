import { Tool, ToolInput, ToolOutput } from './Tool';
import { ToolUseContext } from '../types/tool-context';
import { RiskLevel } from '../types/security';

/** 工具注册项 */
interface ToolRegistryEntry {
  tool: Tool;
  enabled: boolean;
  priority: number;
}

/** 工具注册池 */
export class ToolRegistry {
  private tools: Map<string, ToolRegistryEntry> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();

  /**
   * 注册工具
   */
  register(
    tool: Tool,
    options?: { enabled?: boolean; priority?: number }
  ): void {
    const name = tool.metadata.name;

    const entry: ToolRegistryEntry = {
      tool,
      enabled: options?.enabled ?? true,
      priority: options?.priority ?? 100,
    };

    this.tools.set(name, entry);

    // 分类索引
    const category = tool.metadata.category;
    if (!this.categoryIndex.has(category)) {
      this.categoryIndex.set(category, new Set());
    }
    this.categoryIndex.get(category)!.add(name);
  }

  /**
   * 取消注册
   */
  unregister(name: string): boolean {
    const entry = this.tools.get(name);
    if (!entry) return false;

    this.tools.delete(name);
    const category = entry.tool.metadata.category;
    this.categoryIndex.get(category)?.delete(name);

    return true;
  }

  /**
   * 获取工具
   */
  getTool(name: string, context?: ToolUseContext): Tool | null {
    const entry = this.tools.get(name);
    if (!entry || !entry.enabled) return null;

    const tool = entry.tool;
    if (context && tool.isAvailable && !tool.isAvailable(context)) {
      return null;
    }

    return tool;
  }

  /**
   * 获取所有可用工具
   */
  getAvailableTools(context?: ToolUseContext): Tool[] {
    const available: Tool[] = [];

    for (const [_name, entry] of this.tools) {
      if (!entry.enabled) continue;

      const tool = entry.tool;
      if (context && tool.isAvailable && !tool.isAvailable(context)) {
        continue;
      }

      // deny 模式只允许安全工具
      if (context?.permissionMode === 'deny' && tool.security.riskLevel !== RiskLevel.SAFE) {
        continue;
      }

      available.push(tool);
    }

    // 按优先级排序
    return available.sort((a, b) => {
      const aPriority = this.tools.get(a.metadata.name)?.priority ?? 100;
      const bPriority = this.tools.get(b.metadata.name)?.priority ?? 100;
      return aPriority - bPriority;
    });
  }

  /**
   * 按分类获取工具
   */
  getToolsByCategory(category: string): Tool[] {
    const names = this.categoryIndex.get(category);
    if (!names) return [];

    return Array.from(names)
      .map(name => this.tools.get(name)?.tool)
      .filter((tool): tool is Tool => tool !== undefined);
  }

  /**
   * 获取工具描述（用于 AI prompt）
   */
  getToolDescriptionsForAI(context?: ToolUseContext): string {
    const tools = this.getAvailableTools(context);

    const descriptions = tools.map(tool =>
      `### ${tool.metadata.name}\n${tool.metadata.description}\n风险等级: ${tool.security.riskLevel}`
    );

    return descriptions.join('\n\n');
  }

  /**
   * 启用/禁用工具
   */
  setEnabled(name: string, enabled: boolean): void {
    const entry = this.tools.get(name);
    if (entry) {
      entry.enabled = enabled;
    }
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * 获取所有注册的工具名列表
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
