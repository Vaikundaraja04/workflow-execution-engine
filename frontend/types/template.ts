export interface WorkflowTemplate {
  _id: string;
  id?: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  tags: string[];
  definition: Record<string, unknown>;
  authorId: string;
  isPublic: boolean;
  installCount: number;
  rating?: number;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  count: number;
}
