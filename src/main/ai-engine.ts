import OpenAI from 'openai';
import { AIConfigItem, SessionContext, CommandHistory } from './database';

export interface AIGenerateResult {
  command: string;
  explanation: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export interface AIAnalyzeResult {
  analysis: string;
  suggestions: string[];
  nextCommand?: string;
  nextCommandReason?: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export interface AIDecomposeResult {
  subTasks: {
    id: string;
    description: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    dependencies: string[];
    expectedOutput?: string;
  }[];
  reasoning: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

// 扩展的 AI 上下文
export interface AIContext {
  os: string;
  history?: string;
  // 新增工作上下文
  currentDirectory?: string;
  hostname?: string;
  recentCommands?: CommandHistory[];
  taskGoal?: string;
  // 新增任务历史摘要（AI 生成的智能摘要）
  taskHistorySummary?: string;
}

/** 智能摘要请求 */
export interface AISummaryRequest {
  taskHistory: Array<{
    action: string;
    content: string;
    command?: string;
    result?: string;
  }>;
  recentCommands: CommandHistory[];
  currentGoal?: string;
}

/** 智能摘要结果 */
export interface AISummaryResult {
  summary: string;
  keyFindings: string[];     // 关键发现（如发现的路径、重要结果）
  successfulCommands: string[]; // 成功执行的命令摘要
  failedCommands: string[];    // 失败的命令
  tokenUsage?: { promptTokens: number; completionTokens: number };
}

export class AIEngine {
  async generateCommand(
    prompt: string,
    context: AIContext,
    config: AIConfigItem
  ): Promise<AIGenerateResult> {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
      });

      const commandStylePrompt = context.os === 'windows'
        ? '4. 当前目标服务器是 Windows，请优先生成 PowerShell 命令，避免使用 Linux shell 语法、bash 工具链和 Unix 路径格式。'
        : '4. 当前目标服务器是 Linux，请生成标准 shell 命令，避免使用 PowerShell 语法。';

      // 构建上下文信息
      const contextParts: string[] = [];
      if (context.currentDirectory) {
        contextParts.push(`当前工作目录: ${context.currentDirectory}`);
      }
      if (context.hostname) {
        contextParts.push(`主机名: ${context.hostname}`);
      }
      if (context.recentCommands && context.recentCommands.length > 0) {
        contextParts.push('最近执行的命令:');
        for (const cmd of context.recentCommands.slice(-3)) {
          const status = cmd.exitCode === 0 ? '成功' : '失败';
          contextParts.push(`  - ${cmd.command} (退出码: ${cmd.exitCode}, 目录: ${cmd.directory || context.currentDirectory || '未知'})`);
        }
      }
      if (context.taskGoal) {
        contextParts.push(`当前任务目标: ${context.taskGoal}`);
      }
      if (context.history) {
        contextParts.push(context.history);
      }

      const contextInfo = contextParts.length > 0
        ? `\n当前环境上下文:\n${contextParts.join('\n')}`
        : '';

      const systemPrompt = `你是一个专业的服务器运维助手。用户会通过自然语言描述他们想执行的操作，你需要将其转换为准确的 shell 命令。

规则：
1. 只输出命令，不要输出多余解释
2. 命令必须安全，不要使用 rm -rf / 等危险命令
3. 如果是复杂操作，拆分成多行命令（用 && 连接）
${commandStylePrompt}
5. 操作系统：${context.os}
${contextInfo}

重要提示：
- 如果用户提到"进入目录"或相对路径操作，请使用当前工作目录作为基准路径
- 如果之前的命令已经切换了目录，后续命令应基于新的目录位置
- 使用绝对路径可以避免路径混淆问题

返回 JSON 格式：
{
  "command": "实际执行的命令",
  "explanation": "用中文简要解释这个命令的作用"
}`;

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      return {
        ...parsed,
        tokenUsage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        } : undefined,
      };
    } catch (error: any) {
      throw new Error(`AI 命令生成失败：${error.message}`);
    }
  }

  async analyzeResult(
    userPrompt: string,
    command: string,
    output: string,
    exitCode: number | undefined,
    context: AIContext,
    config: AIConfigItem
  ): Promise<AIAnalyzeResult> {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
      });

      const commandStylePrompt = context.os === 'windows'
        ? '- 当前目标服务器是 Windows，如有后续命令请使用 PowerShell 语法'
        : '- 当前目标服务器是 Linux，如有后续命令请使用标准 shell 语法';

      // 构建上下文信息
      const contextParts: string[] = [];
      if (context.currentDirectory) {
        contextParts.push(`当前工作目录: ${context.currentDirectory}`);
      }
      if (context.hostname) {
        contextParts.push(`主机名: ${context.hostname}`);
      }
      if (context.recentCommands && context.recentCommands.length > 0) {
        contextParts.push('之前执行的命令:');
        for (const cmd of context.recentCommands.slice(-2)) {
          contextParts.push(`  - ${cmd.command} (退出码: ${cmd.exitCode})`);
        }
      }
      if (context.taskGoal) {
        contextParts.push(`当前任务目标: ${context.taskGoal}`);
      }

      const contextInfo = contextParts.length > 0
        ? `\n当前环境上下文:\n${contextParts.join('\n')}`
        : '';

      const systemPrompt = `你是一个专业的服务器运维助手。用户刚才提出了一个运维需求，你给出了执行命令，现在需要你分析命令执行结果并给出专业建议。

你的任务是：
1. 分析命令输出结果，判断是否达到用户目标
2. 如果有问题，给出具体建议和解决方案
3. 如果需要进一步操作，给出后续命令建议

分析要点：
- 仔细阅读输出内容，识别关键信息
- 注意错误信息、异常状态、关键数值
- 结合用户原始需求判断是否需要继续操作
${commandStylePrompt}
${contextInfo}

重要提示：
- 如果后续命令涉及路径操作，请使用当前工作目录作为基准
- 保持任务的连贯性，后续命令应该基于当前状态继续推进

返回 JSON 格式：
{
  "analysis": "用中文分析命令执行结果，告诉用户当前状态",
  "suggestions": ["建议1", "建议2", "建议3"],
  "nextCommand": "如果需要继续操作的后续命令（可选）",
  "nextCommandReason": "为什么需要执行这个后续命令（可选）"
}`;

      const userMessage = `用户原始需求：${userPrompt}

执行的命令：${command}

命令输出：
${output}

退出码：${exitCode ?? '未知'}

请分析结果并给出建议。`;

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const result = JSON.parse(content);
      return {
        analysis: result.analysis || '命令已执行完成。',
        suggestions: result.suggestions || [],
        nextCommand: result.nextCommand,
        nextCommandReason: result.nextCommandReason,
        tokenUsage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        } : undefined,
      };
    } catch (error: any) {
      throw new Error(`AI 结果分析失败：${error.message}`);
    }
  }

  async decomposeTask(
    prompt: string,
    context: AIContext,
    config: AIConfigItem,
    options: { allowedTools: string[]; maxSteps: number }
  ): Promise<AIDecomposeResult> {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
      });

      const osHint = context.os === 'windows'
        ? '目标服务器是 Windows，请使用 PowerShell 命令。'
        : '目标服务器是 Linux，请使用标准 bash/shell 命令。';

      // 构建上下文信息
      const contextParts: string[] = [];
      if (context.currentDirectory) {
        contextParts.push(`当前工作目录: ${context.currentDirectory}`);
      }
      if (context.hostname) {
        contextParts.push(`主机名: ${context.hostname}`);
      }
      if (context.taskGoal) {
        contextParts.push(`当前任务目标: ${context.taskGoal}`);
      }
      // 任务历史摘要（最重要：包含之前任务的结果）
      if (context.taskHistorySummary) {
        contextParts.push(`\n之前的操作历史:\n${context.taskHistorySummary}`);
      }
      if (context.recentCommands && context.recentCommands.length > 0) {
        contextParts.push('最近执行的命令:');
        for (const cmd of context.recentCommands.slice(-3)) {
          const status = cmd.exitCode === 0 ? '成功' : '失败';
          contextParts.push(`  - ${cmd.command} (退出码: ${cmd.exitCode}, 目录: ${cmd.directory || context.currentDirectory || '未知'})`);
        }
      }

      const contextInfo = contextParts.length > 0
        ? `\n当前环境上下文:\n${contextParts.join('\n')}`
        : '';

      const systemPrompt = `你是一个专业的服务器运维架构师。你的职责是协助用户管理服务器。
1. 如果用户的问题涉及具体的服务器运维任务（如检查资源、部署应用、修复错误等），请将其分解为具体的 shell 命令步骤。
2. 如果用户的问题是通用的对话、身份询问或与服务器操作无关，请在 reasoning 字段中直接给出你的回答，并将 subTasks 设为空数组 []。

${osHint}
${contextInfo}

可用工具：
${options.allowedTools.map(t => `- ${t}`).join('\n')}

任务分解规则：
1. 每个步骤必须包含一个真实的、可执行的 shell 命令。
2. toolInput.command 字段必须是真实命令。
3. description 用中文描述这一步的目的。
4. id 使用 "step1", "step2" 等格式。
5. 最多分解为 ${options.maxSteps} 个步骤。
6. toolName 统一填 "ssh:execute"。
7. **重要**: 参考之前的操作历史，如果用户提到"进入目录"、"继续"等，请使用已知的路径信息。

必须返回纯 JSON 格式：
{
  "subTasks": [],
  "reasoning": "如果是通用对话，直接在这里回答；如果是运维任务，描述分解思路",
  "suggestedAgent": "general"
}`;

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      // 如果没有 subTasks，则视为通用对话，返回空数组
      const subTasksRaw = Array.isArray(parsed.subTasks) ? parsed.subTasks : [];

      return {
        subTasks: subTasksRaw.map((st: any) => ({
          id: st.id || `step${Math.random().toString(36).slice(2, 8)}`,
          description: st.description,
          toolName: st.toolName || 'ssh:execute',
          toolInput: st.toolInput || {},
          dependencies: st.dependencies || [],
          expectedOutput: st.expectedOutput || '',
        })),
        reasoning: parsed.reasoning || '',
        suggestedAgent: parsed.suggestedAgent || 'general',
        tokenUsage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        } : undefined,
      };
    } catch (error: any) {
      throw new Error(`AI 任务分解失败：${error.message}`);
    }
  }

  /**
   * 生成智能上下文摘要（Claude Code 方案）
   * 不是简单截取，而是让 AI 提取关键信息
   */
  async generateContextSummary(
    request: AISummaryRequest,
    context: AIContext,
    config: AIConfigItem
  ): Promise<AISummaryResult> {
    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.endpoint,
      });

      // 构建历史内容（限制总长度避免 Token 过多）
      const maxHistoryLength = 3000; // 最大历史字符数
      let historyContent = request.taskHistory.map(step => {
        if (step.action === 'intent') {
          return `用户意图: ${step.content}`;
        } else if (step.action === 'command') {
          return `执行命令: ${step.command || step.content}`;
        } else if (step.action === 'result') {
          // 结果智能截取：保留关键行
          const resultContent = step.result || step.content;
          const lines = resultContent.split('\n').filter(l => l.trim().length > 0 && l.trim().length < 200);
          return `执行结果: ${lines.slice(0, 10).join('; ')}`;
        } else if (step.action === 'analysis') {
          return `AI分析: ${step.content}`;
        }
        return step.content;
      }).join('\n');

      // 如果历史过长，从前面截断（保留最近的）
      if (historyContent.length > maxHistoryLength) {
        historyContent = historyContent.slice(-maxHistoryLength);
      }

      const systemPrompt = `你是一个上下文摘要助手。你的任务是从操作历史中提取关键信息，生成简洁但信息完整的摘要。

摘要要求：
1. **关键发现** - 提取所有发现的重要路径、文件、配置信息（必须保留完整路径！）
2. **成功操作** - 记录成功执行的命令及其关键结果
3. **失败操作** - 记录失败的命令及原因
4. **当前状态** - 总结当前工作目录、任务进展

重要规则：
- 保留具体的路径信息（如 /data/dify、/home/user/project）- 这是最重要的信息！
- 保留重要的数值信息（如容器 ID、端口、版本号）
- 不要丢失上下文依赖的关键信息
- 摘要应该让后续任务能够感知之前的结果

返回 JSON 格式：
{
  "summary": "一段简洁的摘要，描述之前做了什么",
  "keyFindings": ["发现的关键信息列表，如路径、配置等"],
  "successfulCommands": ["成功执行的命令摘要"],
  "failedCommands": ["失败的命令及原因"]
}`;

      const userMessage = `当前任务目标: ${request.currentGoal || '未知'}
当前工作目录: ${context.currentDirectory || '未知'}

操作历史:
${historyContent}

请生成智能摘要。`;

      const response = await client.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      // 追踪 Token 消耗
      if (response.usage) {
        // 摘要生成的 Token 也计入预算
      }

      return {
        summary: parsed.summary || '',
        keyFindings: parsed.keyFindings || [],
        successfulCommands: parsed.successfulCommands || [],
        failedCommands: parsed.failedCommands || [],
        tokenUsage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        } : undefined,
      };
    } catch (error: any) {
      // 摘要失败时返回空摘要，不影响主流程
      console.error('AI 摘要生成失败:', error.message);
      return {
        summary: '',
        keyFindings: [],
        successfulCommands: [],
        failedCommands: [],
      };
    }
  }
}
