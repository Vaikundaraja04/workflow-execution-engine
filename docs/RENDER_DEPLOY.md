# Deploying on Render

This project deploys to Render's free tier as three resources:

| Render resource | Type | Plan | Purpose |
| --- | --- | --- | --- |
| workflow-engine-api | Web service (Node) | Free | Express API + BullMQ worker (both processes) |
| workflow-engine-web | Web service (Node) | Free | Next.js console |
| workflow-engine-kv | Key Value (Redis-compatible) | Free | Queue and Socket.IO backing store |

MongoDB is not hosted on Render. Use a free MongoDB Atlas cluster - Atlas clusters are replica sets, so the transactional workflow versioning works.

Note: Render background workers are a paid instance type, so the worker process runs inside the free API service. If you upgrade later, move `node dist/workers/startWorker.js` into its own worker service.

## 1. Create the MongoDB Atlas cluster (free)

1. Sign in at https://cloud.mongodb.com/ and create an M0 (free) cluster (region: Mumbai or Singapore).
2. Database Access: add a database user and remember the password.
3. Network Access: add IP 0.0.0.0/0 (allow from anywhere) for this demo.
4. Cluster -> Connect -> Drivers: copy the connection string and append the database name:
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/workflow_engine?retryWrites=true&w=majority

## 2. Create the Blueprint

1. In the Render dashboard: New -> Blueprint.
2. Connect the GitHub repository Vaikundaraja04/workflow-execution-engine (branch master).
3. Render reads render.yaml and prompts for MONGODB_URI - paste the Atlas string from step 1.
4. Click Apply. The first deploy builds the API and the console, and creates the Key Value instance.

## 3. After the first deploy

1. Open https://workflow-engine-api.onrender.com/health - it should return {"status":"ok", ...}.
2. Open https://workflow-engine-web.onrender.com and register an account (a workspace is provisioned automatically).
3. Run a workflow to confirm the worker executes jobs (status goes QUEUED -> RUNNING -> SUCCEEDED).

## If Render renames a service

Service names are global on onrender.com. If a name is taken, Render asks you to change it during Blueprint creation. Then update the two URLs:

- API service -> CORS_ORIGINS and APP_BASE_URL -> https://<your-web-name>.onrender.com
- Web service -> NEXT_PUBLIC_API_URL -> https://<your-api-name>.onrender.com, then redeploy (this value is baked in at build time).

## Free-tier notes

- Free web services spin down after 15 minutes without traffic; the next request takes about a minute to wake them.
- The Key Value instance uses maxmemoryPolicy: noeviction so queued jobs are never evicted.
- The worker shares the API service - fine for a demo; split it when you need to scale.
