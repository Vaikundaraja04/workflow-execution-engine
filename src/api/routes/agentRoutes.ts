import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requirePermission } from '../middleware/requirePermission.js';
import { AgentRunnerService } from '../../services/agent/agentRunnerService.js';
import { AgentToolRegistry } from '../../services/agent/agentToolRegistry.js';

const router = Router();
const agentRunnerService = AgentRunnerService.getInstance();
const toolRegistry = AgentToolRegistry.getInstance();

// List all registered tools in the registry
router.get(
  '/tools',
  requirePermission('AGENT_READ'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const tools = toolRegistry.listTools().map((t) => ({
        name: t.name,
        description: t.description,
      }));
      res.json({ data: tools });
    } catch (err) {
      next(err);
    }
  }
);

// Execute a specific tool directly
router.post(
  '/tools/execute',
  requirePermission('AGENT_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const { toolName, input } = req.body;
      if (!toolName) {
        return res.status(400).json({ error: 'toolName is required' });
      }

      const result = await toolRegistry.executeTool(toolName, input || {}, {
        workspaceId: workspaceContext.workspaceId,
        userId: workspaceContext.userId,
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Execute an Agent Node or Multi-Agent orchestration
router.post(
  '/run',
  requirePermission('AGENT_EXECUTE'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceContext = (req as any).workspaceContext;
      const { input, config, executionId, contextVariables } = req.body;

      if (!config || !config.systemPrompt) {
        return res.status(400).json({ error: 'config.systemPrompt is required' });
      }

      const result = await agentRunnerService.runAgentNode({
        workspaceId: workspaceContext.workspaceId,
        userId: workspaceContext.userId,
        input: input || {},
        config,
        executionId,
        contextVariables,
      });

      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
