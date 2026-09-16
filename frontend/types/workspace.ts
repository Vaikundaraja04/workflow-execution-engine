import { WorkspaceRole } from './auth';

export type { WorkspaceRole };

export interface Workspace {
  _id: string;
  id?: string;
  name: string;
  slug?: string;
  description?: string;
  ownerId: string;
  role?: WorkspaceRole;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  _id: string;
  id?: string;
  workspaceId: string;
  userId: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
  createdAt?: string;
}

export interface CreateWorkspacePayload {
  name: string;
  slug?: string;
  description?: string;
}

export interface UpdateWorkspacePayload {
  name?: string;
  description?: string;
}

export interface AddMemberPayload {
  email: string;
  role: WorkspaceRole;
}

export interface UpdateMemberRolePayload {
  role: WorkspaceRole;
}
