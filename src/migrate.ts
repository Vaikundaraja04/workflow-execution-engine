import { loadEnv } from './config/env.js';
import { connectDB, disconnectDB } from './db/connection.js';
import { backfillLegacyWorkspaceData } from './services/workspaceService.js';

const env = loadEnv();

async function run(): Promise<void> {
  try {
    await connectDB(env.MONGODB_URI);
    const summary = await backfillLegacyWorkspaceData();
    console.log(`Migration complete: ${JSON.stringify(summary)}`);
  } finally {
    await disconnectDB();
  }
}

run().catch(error => {
  console.error('Migration failed', error);
  process.exit(1);
});

export {};