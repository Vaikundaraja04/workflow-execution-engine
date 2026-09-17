import { apiClient } from './apiClient';

export interface CreateTemplatePayload {
  name: string;
  description?: string;
  category: string;
  visibility: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC' | 'MARKETPLACE';
  tags?: string[];
  workflowDefinition: Record<string, unknown>;
}

export interface TemplateSummary {
  _id?: string;
  id?: string;
  name: string;
  category: string;
  visibility: string;
  tags?: string[];
}

export const templateApi = {
  createTemplate: async (
    payload: CreateTemplatePayload,
    workspaceId?: string
  ): Promise<TemplateSummary> => {
    const config = workspaceId ? { headers: { 'X-Workspace-Id': workspaceId } } : undefined;
    const response = await apiClient.post<TemplateSummary>('/api/v1/templates', payload, config);
    return response.data;
  },
};

export default templateApi;
