import { apiClient } from './apiClient';
import type {
  Workspace,
  WorkspaceMember,
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  AddMemberPayload,
  UpdateMemberRolePayload,
} from '@/types/workspace';

export const workspaceApi = {
  listWorkspaces: async (): Promise<Workspace[]> => {
    const response = await apiClient.get<Workspace[]>('/api/workspaces');
    return response.data;
  },

  getWorkspace: async (id: string): Promise<Workspace> => {
    const response = await apiClient.get<Workspace>(`/api/workspaces/${id}`);
    return response.data;
  },

  createWorkspace: async (payload: CreateWorkspacePayload): Promise<Workspace> => {
    const response = await apiClient.post<Workspace>('/api/workspaces', payload);
    return response.data;
  },

  updateWorkspace: async (id: string, payload: UpdateWorkspacePayload): Promise<Workspace> => {
    const response = await apiClient.patch<Workspace>(`/api/workspaces/${id}`, payload);
    return response.data;
  },

  listMembers: async (workspaceId: string): Promise<WorkspaceMember[]> => {
    const response = await apiClient.get<WorkspaceMember[]>(`/api/workspaces/${workspaceId}/members`);
    return response.data;
  },

  addMember: async (workspaceId: string, payload: AddMemberPayload): Promise<WorkspaceMember> => {
    const response = await apiClient.post<WorkspaceMember>(`/api/workspaces/${workspaceId}/members/invite`, payload);
    return response.data;
  },

  updateMemberRole: async (
    workspaceId: string,
    memberId: string,
    payload: UpdateMemberRolePayload
  ): Promise<WorkspaceMember> => {
    const response = await apiClient.patch<WorkspaceMember>(
      `/api/workspaces/${workspaceId}/members/${memberId}`,
      payload
    );
    return response.data;
  },

  removeMember: async (workspaceId: string, memberId: string): Promise<void> => {
    await apiClient.delete(`/api/workspaces/${workspaceId}/members/${memberId}`);
  },
};

export const workspaceService = workspaceApi;
export default workspaceApi;
