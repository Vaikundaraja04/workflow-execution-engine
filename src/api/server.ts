import { createApp } from './app.js';
import { connectDB, disconnectDB } from '../db/connection.js';
import { loadEnv } from '../config/env.js';

const env = loadEnv();

let isShuttingDown = false;

async function startServer() {
  try {
    await connectDB(env.MONGODB_URI);
    const app = createApp();
    const server = app.listen(env.PORT, () => {
      console.log(`Server running on port ${env.PORT}`);
    });

    const shutdown = (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      console.log(`Received ${signal}, shutting down gracefully...`);
      server.close(async () => {
        await disconnectDB();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
}

startServer();

export {};
