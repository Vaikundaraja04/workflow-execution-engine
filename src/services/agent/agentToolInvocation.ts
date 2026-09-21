export type ToolPolicy = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface StructuredToolInvocation {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolPolicyDecision {
  policy: ToolPolicy;
  reason: string;
}

export const DANGEROUS_TOOLS_REQUIRING_APPROVAL = ['http_request', 'database_query', 'workflow_trigger'] as const;

/**
 * Parse a structured tool invocation of the form:
 * { toolName: "", arguments: {} }
 * Also supports the JSON string form. Returns null when not a structured invocation.
 * This is additive — legacy regex TOOL_CALL parsing in AgentRunnerService is untouched.
 */
export function parseStructuredToolInvocation(raw: unknown): StructuredToolInvocation | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return parseStructuredToolInvocation(parsed);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const toolName = obj.toolName;
  const args = obj.arguments;
  if (typeof toolName !== 'string' || toolName.length === 0) return null;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return { toolName, arguments: args as Record<string, unknown> };
}

/**
 * Scan free-form model text for an embedded structured invocation JSON block.
 * Looks for ```json { "toolName": ... } ``` fences or bare JSON containing toolName.
 */
export function extractStructuredInvocationFromText(text: string): StructuredToolInvocation | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsed = parseStructuredToolInvocation(fenced[1]);
    if (parsed) return parsed;
  }
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    const slice = text.slice(braceStart, braceEnd + 1);
    const parsed = parseStructuredToolInvocation(slice);
    if (parsed) return parsed;
  }
  return null;
}

export function defaultToolPolicy(toolName: string): ToolPolicy {
  if ((DANGEROUS_TOOLS_REQUIRING_APPROVAL as readonly string[]).includes(toolName)) {
    return 'REQUIRE_APPROVAL';
  }
  return 'ALLOW';
}
