import { AgentCoordinator } from './AgentCoordinator';
import { GeneralAgent } from './implementations/GeneralAgent';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ToolRegistry } from '../tools/ToolRegistry';
import { AIEngine } from '../ai-engine';

export function initializeAgentSystem(toolExecutor: ToolExecutor, toolRegistry: ToolRegistry, aiEngine: AIEngine): AgentCoordinator {
  const coordinator = new AgentCoordinator(toolExecutor, toolRegistry, aiEngine);

  // 注册内置 Agent
  coordinator.register(new GeneralAgent(toolExecutor));

  return coordinator;
}
