import { describe, it, expect } from 'vitest';
import { executeWorkflow, readConditionField } from '../src/engine/executeWorkflow.js';
import type { WorkflowDefinition } from '../src/types/workflow.js';

// Conditions as the console's builder saves them: the expected value is always text.
function branch(field: string, operator: string, value: unknown): WorkflowDefinition {
  return {
    nodes: [
      { id: 'start', type: 'webhook', config: {} },
      { id: 'check', type: 'condition', config: { field, operator, value } },
      { id: 'yes', type: 'log', config: { message: 'yes' } },
      { id: 'no', type: 'log', config: { message: 'no' } },
    ],
    edges: [
      { source: 'start', target: 'check' },
      { source: 'check', target: 'yes', condition: 'true' },
      { source: 'check', target: 'no', condition: 'false' },
    ],
  } as WorkflowDefinition;
}

async function pathTaken(definition: WorkflowDefinition, input: Record<string, unknown>) {
  const result = await executeWorkflow(definition, input);
  if (result.status !== 'SUCCEEDED') return `${result.status}:${result.errors?.[0]?.code}`;
  return result.stepStatuses.yes === 'SUCCEEDED' ? 'yes' : 'no';
}

describe('condition fields as the console saves them', () => {
  it('reads "input.status" from the run input', async () => {
    expect(await pathTaken(branch('input.status', 'equals', 'paid'), { status: 'paid' })).toBe('yes');
    expect(await pathTaken(branch('input.status', 'equals', 'paid'), { status: 'no' })).toBe('no');
  });

  it('still reads a plain key and nested paths', async () => {
    expect(await pathTaken(branch('status', 'equals', 'paid'), { status: 'paid' })).toBe('yes');
    expect(await pathTaken(branch('customer.tier', 'equals', 'gold'), { customer: { tier: 'gold' } })).toBe('yes');
    expect(await pathTaken(branch('input.customer.tier', 'notEquals', 'gold'), { customer: { tier: 'silver' } })).toBe('yes');
  });

  it('prefers a real "input" key in the run input', () => {
    expect(readConditionField({ input: { status: 'inner' }, status: 'outer' }, 'input.status')).toBe('inner');
  });

  it('compares numbers typed as text', async () => {
    expect(await pathTaken(branch('amount', 'greaterThan', '100'), { amount: 500 })).toBe('yes');
    expect(await pathTaken(branch('amount', 'greaterThan', '100'), { amount: 20 })).toBe('no');
    expect(await pathTaken(branch('amount', 'lessThan', '100'), { amount: '20' })).toBe('yes');
    expect(await pathTaken(branch('amount', 'equals', '100'), { amount: 100 })).toBe('yes');
    expect(await pathTaken(branch('amount', 'notEquals', '100'), { amount: 99 })).toBe('yes');
  });

  it('compares true and false typed as text', async () => {
    expect(await pathTaken(branch('paid', 'equals', 'true'), { paid: true })).toBe('yes');
    expect(await pathTaken(branch('paid', 'equals', 'true'), { paid: false })).toBe('no');
  });

  it('keeps text and numbers distinct when neither side is a number', async () => {
    expect(await pathTaken(branch('code', 'equals', '007'), { code: '7' })).toBe('no');
  });

  it('still fails a number comparison on text that is not a number', async () => {
    expect(await pathTaken(branch('amount', 'greaterThan', '100'), { amount: 'lots' })).toBe('FAILED:NON_NUMERIC_OPERAND');
    expect(await pathTaken(branch('amount', 'greaterThan', 'ten'), { amount: 5 })).toBe('FAILED:NON_NUMERIC_OPERAND');
  });

  it('never reads inherited properties', () => {
    expect(readConditionField({}, '__proto__')).toBeUndefined();
    expect(readConditionField({}, 'constructor.name')).toBeUndefined();
    expect(readConditionField({ a: {} }, 'a.toString')).toBeUndefined();
  });
});
