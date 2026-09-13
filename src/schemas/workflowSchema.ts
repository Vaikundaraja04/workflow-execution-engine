import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

const webhookConfigSchema = z.object({}).strict();

const conditionConfigSchema = z.object({
  field: nonEmptyString,
  operator: z.enum(['equals', 'notEquals', 'greaterThan', 'lessThan']),
  value: z.unknown(),
}).strict();

const logConfigSchema = z.object({
  message: nonEmptyString,
}).strict();

export const WorkflowNodeSchema = z.discriminatedUnion('type', [
  z.object({
    id: nonEmptyString,
    type: z.literal('webhook'),
    config: webhookConfigSchema,
  }).strict(),
  z.object({
    id: nonEmptyString,
    type: z.literal('condition'),
    config: conditionConfigSchema,
  }).strict(),
  z.object({
    id: nonEmptyString,
    type: z.literal('log'),
    config: logConfigSchema,
  }).strict(),
]);

export const WorkflowEdgeSchema = z.object({
  source: nonEmptyString,
  target: nonEmptyString,
  condition: z.enum(['true', 'false']).optional(),
}).strict();

export const WorkflowDefinitionSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).min(1),
  edges: z.array(WorkflowEdgeSchema),
}).strict();

export type WorkflowDefinitionInput = z.infer<typeof WorkflowDefinitionSchema>;

export function parseWorkflowDefinition(input: unknown) {
  return WorkflowDefinitionSchema.parse(input);
}

export function safeParseWorkflowDefinition(input: unknown) {
  return WorkflowDefinitionSchema.safeParse(input);
}
