// Seeds the agent marketplace by creating + publishing listings for existing
// workspace agents, so /agents/marketplace has content instead of the
// "No agents match this search" empty state.
//
// Usage:  npx tsx scripts/seed-agent-marketplace.mts
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import mongoose from 'mongoose';

if (existsSync('.env')) {
  loadEnvFile('.env');
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (check .env)');
  process.exit(1);
}

const CATEGORIES = [
  'Automation',
  'Data Processing',
  'Integration',
  'AI Workflow',
  'Approval Flow',
  'Monitoring',
  'Notifications',
  'Operations',
  'Security',
];

async function main() {
  await mongoose.connect(uri!);
  console.log('=== AGENT MARKETPLACE SEED ===');

  // Imports after env load so model registration and config stay consistent.
  const { AgentModel } = await import('../src/models/AgentModel.js');
  const { AgentMarketplaceModel } = await import('../src/models/AgentMarketplaceModel.js');
  const { WorkspaceMemberModel } = await import('../src/models/WorkspaceMemberModel.js');
  const { agentMarketplaceService } = await import('../src/services/agentMarketplaceService.js');

  const agents = await AgentModel.find({}).lean();
  console.log(`workspace agents found: ${agents.length}`);

  let created = 0;
  let published = 0;
  let skipped = 0;

  for (const [index, agent] of agents.entries()) {
    const workspaceId = agent.workspaceId.toString();
    const owner = await WorkspaceMemberModel.findOne({ workspaceId: agent.workspaceId, role: 'OWNER' }).lean();
    if (!owner) {
      console.log(`  skip      ${agent.name} (no OWNER member in workspace ${workspaceId})`);
      skipped += 1;
      continue;
    }
    const userId = owner.userId.toString();

    try {
      let listing = await AgentMarketplaceModel.findOne({ workspaceId: agent.workspaceId, agentId: agent._id });
      if (!listing) {
        listing = await agentMarketplaceService.createListing(workspaceId, userId, {
          agentId: agent._id.toString(),
          name: agent.name,
          description:
            agent.description && agent.description.trim().length > 0
              ? agent.description
              : `${agent.name} — published from the workspace agents console.`,
          category: CATEGORIES[index % CATEGORIES.length],
          tags: ['seeded', 'workspace-agent'],
          visibility: 'PUBLIC',
        });
        created += 1;
        console.log(`  created   ${agent.name} (listing ${listing._id})`);
      } else {
        console.log(`  exists    ${agent.name} (listing ${listing._id}, status ${listing.status})`);
      }

      if (listing.status !== 'PUBLISHED') {
        await agentMarketplaceService.publishAgent(listing._id.toString(), workspaceId, userId, 'OWNER');
        published += 1;
        console.log(`  published ${agent.name}`);
      }
    } catch (err) {
      skipped += 1;
      console.error(`  FAILED    ${agent.name}: ${(err as Error).message}`);
    }
  }

  const search = await agentMarketplaceService.searchAgents(
    agents[0]?.workspaceId.toString() ?? new mongoose.Types.ObjectId().toString(),
    { limit: 50 },
  );
  console.log(`\nlistings created:  ${created}`);
  console.log(`listings published: ${published}`);
  console.log(`skipped/failed:     ${skipped}`);
  console.log(`marketplace search now returns: ${search.pagination.totalCount} listing(s)`);

  await mongoose.disconnect();
}

await main();
