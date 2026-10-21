# Deploying on Render

This project deploys to Render's free tier as three resources:

| Render resource | Type | Plan | Purpose |
| --- | --- | --- | --- |
| workflow-execution-engine-api | Web service (Node) | Free | Express API and BullMQ workers in one process (`node dist/main.js`) |
| workflow-execution-engine-web | Web service (Node) | Free | Next.js console |
| workflow-engine-kv | Key Value (Redis-compatible) | Free | Queue and Socket.IO backing store |

MongoDB is not hosted on Render. Use a free MongoDB Atlas cluster - Atlas clusters are replica sets, so the transactional workflow versioning works.

Render background workers are a paid instance type, so the workers run inside the free API service, in the same process as the API. If they stop, `/health` answers 503 and Render restarts the instance. On a paid plan you can run `node dist/api/server.js` and `node dist/workers/startWorker.js` as separate services instead.

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
4. It also prompts for PLATFORM_ADMIN_EMAILS - enter your own email (see below).
5. Click Apply. The first deploy builds the API and the console, and creates the Key Value instance.

## 3. After the first deploy

1. Open https://workflow-execution-engine-api.onrender.com/health - it should return {"status":"ok", ...}.
2. Open https://workflow-execution-engine-web.onrender.com and register an account (a workspace is provisioned automatically).
3. Run a workflow to confirm the worker executes jobs (status goes QUEUED -> RUNNING -> SUCCEEDED).

## Updating an existing deployment

If your services came from the Blueprint, Render picks up render.yaml changes when you merge to master. If they did not, or the API still starts the old way, set these in the Render dashboard (workflow-execution-engine-api -> Settings / Environment):

| Setting | Value |
| --- | --- |
| Start Command | `node dist/main.js` |
| PLATFORM_ADMIN_EMAILS | your email, to see the operator pages |
| NODE_OPTIONS | `--max-old-space-size=384` |

## Operator pages

Business Analytics, Marketplace Analytics, Growth, Enterprise Console and Customer Management are for whoever runs the platform. Their APIs answer only accounts listed in `PLATFORM_ADMIN_EMAILS` (comma-separated). The console hides them from everyone else; sign out and in again after changing the list.

## If Render renames a service

Service names are global on onrender.com. If a name is taken, Render asks you to change it during Blueprint creation. Then update the two URLs:

- API service -> CORS_ORIGINS and APP_BASE_URL -> https://<your-web-name>.onrender.com
- Web service -> NEXT_PUBLIC_API_URL -> https://<your-api-name>.onrender.com, then redeploy (this value is baked in at build time).

## Free-tier behaviour and settings

- Free web services spin down after 15 minutes without traffic, and the next request takes about a minute to wake them. The console now waits for the API (showing "Starting the server") instead of failing the first request.
- Free Key Value instances do not keep data on disk, so a restart loses queued jobs. The workers check every minute for runs that MongoDB still shows as waiting or running but whose job is gone, and queue them again (or fail them if no attempts are left). A lost run resumes within about three minutes.
- Redis connections keep reconnecting with a delay of up to 5 seconds, so a Key Value restart no longer leaves the API unable to queue runs.
- Login attempts are limited per account and token refreshes per session, so visitors behind Render's shared proxy no longer lock each other out.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ORPHAN_SWEEP_INTERVAL_MS` | `60000` | How often to look for runs whose queue job was lost (0 turns it off) |
| `ORPHAN_GRACE_MS` | `120000` | How long a run must sit untouched before it is checked |
| `TRUST_PROXY` | unset | Proxy hops Express should trust for `req.ip` (for example `1`); leave unset unless you know the hop count |

With `TRUST_PROXY` unset, the logs show one `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning after the first request. It is expected on Render: the login and refresh limits do not depend on the visitor's IP, and the general limit (1000 requests a minute) is shared by all visitors. Render does not publish how many proxies sit in front of a service, and a number that is too high lets clients fake their IP, so this setup does not guess one.

See docs/LIVE_RELIABILITY.md for what went wrong on the live deployment and how each problem was reproduced and fixed.
