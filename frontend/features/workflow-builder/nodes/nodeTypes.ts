import type { NodeTypes } from '@xyflow/react';
import { TriggerNode } from './TriggerNode';
import { ActionNode } from './ActionNode';
import { ConditionNode } from './ConditionNode';
import { DelayNode } from './DelayNode';
import { WebhookNode } from './WebhookNode';

export const nodeTypes: NodeTypes = {
  triggerNode: TriggerNode,
  actionNode: ActionNode,
  conditionNode: ConditionNode,
  delayNode: DelayNode,
  webhookNode: WebhookNode,
};
