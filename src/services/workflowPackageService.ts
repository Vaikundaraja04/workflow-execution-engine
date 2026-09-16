import crypto from 'crypto';
import { z } from 'zod';
import type { WorkflowDefinition } from '../types/workflow.js';
import { WorkflowDefinitionSchema } from '../schemas/workflowSchema.js';
import { validateGraph } from '../engine/validateGraph.js';
import { TEMPLATE_CATEGORIES } from '../models/WorkflowTemplateModel.js';
import { TemplatePackageError, TemplateValidationError } from '../errors/templateErrors.js';

export interface WorkflowPackageVersion {
  versionNumber: number;
  workflowDefinition: WorkflowDefinition;
  definitionHash?: string | undefined;
  changeSummary?: string | undefined;
  createdAt?: Date | string | undefined;
}

export interface WorkflowPackageTemplateMeta {
  name: string;
  description?: string | undefined;
  category: string;
  tags?: string[] | undefined;
  visibility?: string | undefined;
}

export interface WorkflowPackageMetadata {
  icon?: string | undefined;
  documentation?: string | undefined;
  requirements?: string[] | undefined;
  [key: string]: unknown;
}

export interface WorkflowPackageData {
  version: string;
  template: WorkflowPackageTemplateMeta;
  workflow: WorkflowDefinition;
  versions: WorkflowPackageVersion[];
  variables?: Record<string, unknown> | undefined;
  metadata?: WorkflowPackageMetadata | undefined;
  exportedAt?: string | undefined;
  checksum?: string | undefined;
}

const FORBIDDEN_PROPERTIES = ['__proto__', 'constructor', 'prototype'];

function checkPrototypePollution(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      checkPrototypePollution(obj[i], `${path}[${i}]`);
    }
    return;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (FORBIDDEN_PROPERTIES.includes(key)) {
      throw new TemplatePackageError(`Security violation: Malicious property "${key}" detected in payload`);
    }
    checkPrototypePollution((obj as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
  }
}

const TemplateMetaSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional().default(''),
  category: z.string().refine((cat) => (TEMPLATE_CATEGORIES as readonly string[]).includes(cat), {
    message: `Invalid template category. Must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
  }),
  tags: z.array(z.string().max(30)).max(20).optional().default([]),
  visibility: z.enum(['PRIVATE', 'WORKSPACE', 'PUBLIC', 'MARKETPLACE']).optional().default('PRIVATE'),
});

const PackageVersionSchema = z.object({
  versionNumber: z.number().int().min(1),
  workflowDefinition: WorkflowDefinitionSchema,
  definitionHash: z.string().optional(),
  changeSummary: z.string().max(500).optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
});

export const WorkflowPackageSchema = z.object({
  version: z.literal('1.0'),
  template: TemplateMetaSchema,
  workflow: WorkflowDefinitionSchema,
  versions: z.array(PackageVersionSchema).default([]),
  variables: z.record(z.string(), z.unknown()).optional().default({}),
  metadata: z.object({
    icon: z.string().max(200).optional(),
    documentation: z.string().max(10000).optional(),
    requirements: z.array(z.string().max(100)).max(50).optional().default([]),
  }).passthrough().optional().default({ requirements: [] }),
  exportedAt: z.string().optional(),
  checksum: z.string().optional(),
});

export class WorkflowPackageService {
  /**
   * Create an exportable workflow package
   */
  static createPackage(input: {
    template: {
      name: string;
      description?: string | undefined;
      category: string;
      tags?: string[] | undefined;
      visibility?: string | undefined;
    };
    workflow: WorkflowDefinition;
    versions?: Array<{
      versionNumber: number;
      workflowDefinition: WorkflowDefinition;
      definitionHash?: string | undefined;
      changeSummary?: string | undefined;
      createdAt?: Date | string | undefined;
    }> | undefined;
    variables?: Record<string, unknown> | undefined;
    metadata?: WorkflowPackageMetadata | undefined;
  }): WorkflowPackageData {
    const rawPackage: Omit<WorkflowPackageData, 'checksum'> = {
      version: '1.0',
      template: {
        name: input.template.name,
        description: input.template.description ?? '',
        category: input.template.category,
        tags: input.template.tags ?? [],
        visibility: input.template.visibility ?? 'PRIVATE',
      },
      workflow: input.workflow,
      versions: input.versions ?? [],
      variables: input.variables ?? {},
      metadata: input.metadata ?? {},
      exportedAt: new Date().toISOString(),
    };

    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawPackage))
      .digest('hex');

    return {
      ...rawPackage,
      checksum,
    };
  }

  /**
   * Validate an imported workflow package for integrity, schema validity, graph correctness, and security
   */
  static validatePackage(pkg: unknown): WorkflowPackageData {
    if (!pkg || typeof pkg !== 'object') {
      throw new TemplatePackageError('Package payload must be a non-null object');
    }

    // 1. Prototype pollution / malicious payload prevention
    checkPrototypePollution(pkg);

    // 2. Schema validation
    const parseResult = WorkflowPackageSchema.safeParse(pkg);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      const message = issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid package schema';
      throw new TemplateValidationError(`Package validation failed: ${message}`);
    }

    const data = parseResult.data as WorkflowPackageData;

    // 3. Workflow graph validation for main workflow
    const graphErrors = validateGraph(data.workflow);
    if (graphErrors.length > 0) {
      throw new TemplateValidationError(`Workflow graph validation failed: ${graphErrors[0]?.message}`);
    }

    // 4. Validate each version's graph if versions are provided
    for (const ver of data.versions) {
      const verGraphErrors = validateGraph(ver.workflowDefinition);
      if (verGraphErrors.length > 0) {
        throw new TemplateValidationError(
          `Version ${ver.versionNumber} graph validation failed: ${verGraphErrors[0]?.message}`,
        );
      }
    }

    return data;
  }
}
