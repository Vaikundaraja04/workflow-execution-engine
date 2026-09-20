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

const agentConfigSchema = z.object({
  systemPrompt: nonEmptyString,
  model: z.string().optional(),
  toolsAllowed: z.array(z.string()).optional(),
  maxTurns: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  memoryEnabled: z.boolean().optional(),
  delegationAllowed: z.boolean().optional(),
  orchestrationMode: z.enum(['autonomous', 'sequential', 'parallel', 'consensus', 'supervisor_worker']).optional(),
  customTools: z.array(z.any()).optional(),
});

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
  z.object({
    id: nonEmptyString,
    type: z.literal('agent'),
    config: agentConfigSchema,
  }),
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
