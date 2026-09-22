export interface WorkflowNode {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  next?: string[];
}

export interface WorkflowEdge {
  source: string;
  target: string;
  condition?: 'true' | 'false' | undefined;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
  entryPoint?: string;
  metadata?: Record<string, unknown>;
}

export interface Workflow {
  _id: string;
  id?: string;
  name: string;
  workspaceId: string;
  ownerId: string;
  status?: 'DRAFT' | 'PUBLISHED';
  latestVersionNumber?: number;
  currentVersion: number;
  draft?: {
    name?: string;
    definition?: WorkflowDefinition;
  };
  publishedVersion?: number;
  publishedVersionId?: string;
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

export interface WorkflowVersionView {
  id: string;
  workflowId: string;
  workspaceId?: string;
  versionNumber: number;
  status: 'PUBLISHED' | 'ARCHIVED';
  definition: WorkflowDefinition;
  definitionHash: string;
  createdBy?: string;
  sourceVersionId?: string;
  changeSummary?: string;
  createdAt: string;
}

export interface VersionComparison {
  from: { versionId: string; versionNumber: number };
  to: { versionId: string; versionNumber: number };
  identical: boolean;
  nodes: {
    added: string[];
    removed: string[];
    changed: Array<{ id: string; fields: Array<{ field: string; from: unknown; to: unknown }> }>;
  };
  edges: {
    added: string[];
    removed: string[];
  };
}

export interface ValidationResponse {
  valid: boolean;
  errors?: Array<{
    type: string;
    message: string;
    nodeId?: string;
    edge?: { source: string; target: string };
  }>;
}
