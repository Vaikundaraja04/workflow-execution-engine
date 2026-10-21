# Live reliability fixes (October 2026)

The engine passed its tests but misbehaved on Render's free plan. Each problem below was
reproduced on a local copy of the deployment (MongoDB 8.0 like Atlas M0, Redis with no
persistence and 25 MB like free Key Value, and the same start command as render.yaml)
before it was fixed. `tests/liveReliability.test.ts` keeps them fixed.

| # | What users saw | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | After a Redis hiccup, every new run failed with 503 `QUEUE_UNAVAILABLE` until the service restarted, while `/health` said "ok" | The API's Redis connection stopped reconnecting after 3 attempts (about 0.6 s). `/health` checked Redis with a fresh connection, so it never noticed | Reconnect forever, backing off to 5 s (`redisReconnectDelay`). `/health` now pings the queue's own connection |
| 2 | Runs were accepted but stayed QUEUED forever | The worker was started in the background with `&`. When it died, nothing restarted it, and `/health` returned 200 "degraded", so Render kept the broken instance | `node dist/main.js` runs the API and workers in one process. If the workers stop, `/health` returns 503 and Render restarts the instance |
| 3 | Some runs stayed QUEUED or RUNNING forever after a Key Value restart | Free Key Value has no persistence, so a restart deletes every job. Startup recovery only looked at QUEUING runs | A sweep every minute re-queues runs whose job is gone, keeping their attempt count (`attemptOffset`), or fails them with `EXECUTION_LOST` |
| 4 | Sign-in failed with "Too many requests" for 15 minutes | Without `trust proxy`, every visitor has the proxy's IP, so the 5-per-15-minutes login limit was shared by the whole site | Login is limited per account and refresh per session token |
| 5 | Business Analytics, Marketplace Analytics, Growth, Enterprise Console and Customer Management showed "Could not load" | Their APIs need `PLATFORM_ADMIN_EMAILS`, which render.yaml never set | The console hides them unless the login response says `isPlatformAdmin`; render.yaml asks for the variable |
| 6 | The first sign-in after a quiet spell failed | A sleeping API takes about 45 to 60 s to start; the console gave up after 30 s | The console waits for `/health/live` before sending requests, with a "Starting the server" notice |
| 7 | CI would fail from October 2026 on | An audit test used fixed September dates against a "last 30 days" summary | The fixtures use dates relative to today |

Running one process also cut memory at idle from about 279 MB (two processes) to 155 MB,
which matters on a 512 MB instance.

## How to reproduce the original failures

1. Start MongoDB as a replica set and Redis with `--save "" --appendonly no`.
2. Start the API the old way: `node dist/workers/startWorker.js & exec node dist/api/server.js`.
3. Restart Redis, then start a run: the old build answers 503 until it is restarted.
4. Kill the worker process: `/health` still answers 200 and new runs stay QUEUED.
5. Send six logins with different `X-Forwarded-For` values: the sixth gets 429.

With `node dist/main.js` the same steps recover on their own.
