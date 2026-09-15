import { Types } from 'mongoose';
import { DeadLetterModel } from '../models/DeadLetterModel.js';
import type { IDeadLetter } from '../models/DeadLetterModel.js';
import { WorkflowModel } from '../models/WorkflowModel.js';
import type { DeadLetterView } from '../types/execution.js';
import { tenantScope } from './tenantScope.js';

export const DEAD_LETTER_LIST_LIMIT = 100;

export function toDeadLetterView(entry: IDeadLetter): DeadLetterView {
  const view: DeadLetterView = {
    executionId: entry.executionId.toString(),
    failureReason: entry.failureReason,
    attempts: entry.attempts,
    failedAt: entry.failedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  };
  if (entry.workflowId !== undefined) view.workflowId = entry.workflowId.toString();
  if (entry.message !== undefined) view.message = entry.message;
  return view;
}

export async function listWorkflowDeadLetters(
  workflowId: string,
  ownerId: string,
  workspaceId: string,
): Promise<IDeadLetter[]> {
  if (!Types.ObjectId.isValid(workflowId)) throw new Error('INVALID_WORKFLOW_ID');
  const workflowExists = await WorkflowModel.exists({ _id: workflowId, ...tenantScope(ownerId, workspaceId) });
  if (!workflowExists) throw new Error('WORKFLOW_NOT_FOUND');
  return DeadLetterModel.find({ workflowId })
    .sort({ failedAt: -1 })
    .limit(DEAD_LETTER_LIST_LIMIT);
}