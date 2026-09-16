export interface WorkflowNode {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  next?: string[];
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  entryPoint?: string;
  metadata?: Record<string, unknown>;
}

export interface Workflow {
  _id: string;
  id?: string;
  name: string;
  workspaceId: string;
  ownerId: string;
  currentVersion: number;
  draft?: {
    name?: string;
    definition?: WorkflowDefinition;
  };
  publishedVersion?: number;
  definition?: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowPayload {
  name: string;
  definition: WorkflowDefinition;
  workspaceId?: string;
}

export interface UpdateWorkflowDraftPayload {
  name?: string;
  definition?: WorkflowDefinition;
}
