import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeWorkflow } from './index.js';
import type { WorkflowDefinition } from './index.js';

const workflowPath = fileURLToPath(
  new URL('./examples/booking-workflow.json', import.meta.url)
);
const bookingWorkflow: WorkflowDefinition = JSON.parse(readFileSync(workflowPath, 'utf-8'));

async function runDemo(estimatedCost: number) {
  console.log(`\n=== Running booking workflow with estimatedCost = ${estimatedCost} ===`);
  const result = await executeWorkflow(bookingWorkflow, { estimatedCost });
  console.log('Final status:', result.status);
  console.log('Step statuses:', result.stepStatuses);
  console.log('Outputs:', result.outputs);
  console.log('Selected branch:', Object.keys(result.outputs).filter(k => result.stepStatuses[k] === 'SUCCEEDED' && k.includes('Log')));
  console.log('Skipped:', Object.keys(result.stepStatuses).filter(k => result.stepStatuses[k] === 'SKIPPED'));
}

async function main() {
  await runDemo(15000);
  await runDemo(5000);
}

main();
