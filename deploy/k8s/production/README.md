# Production Kubernetes Overlay

Production-grade manifests for the workflow execution engine. Complements the base
`deploy/k8s` manifests with autoscaling, disruption budgets, hardened pods and TLS ingress.

## Files

| File | Contents |
| --- | --- |
| `api-deployment.yaml` | API Deployment: 3 replicas, RollingUpdate (maxUnavailable 0), probes on `/health/live` + `/health/ready`, non-root securityContext, read-only root filesystem, 30s termination grace, secret env refs |
| `worker-deployment.yaml` | Worker Deployment: 2 replicas, RollingUpdate, exec probes, 60s termination grace, secret env refs |
| `service.yaml` | ClusterIP Service for the API (port 80 -> 3000) |
| `ingress.yaml` | Ingress with TLS (`workflow-engine-tls`) |
| `hpa.yaml` | CPU HorizontalPodAutoscalers: API 3-12 (70%), worker 2-10 (75%) |
| `pdb.yaml` | PodDisruptionBudgets: API minAvailable 2, worker minAvailable 1 |
| `secrets.example.yaml` | Secret template (never commit real values) |
| `kustomization.yaml` | Ties the overlay together, pins image tags |

## Required secrets

The deployments reference `workflow-engine-secrets`. Create it before applying:

```bash
kubectl -n workflow-engine create secret generic workflow-engine-secrets \
  --from-literal=mongodb-uri='mongodb://...' \
  --from-literal=redis-url='redis://...' \
  --from-literal=auth-jwt-secret="$(openssl rand -base64 48)" \
  --from-literal=webhook-secret-key="$(openssl rand -base64 48)"
```

`auth-jwt-secret` must be at least 32 characters (enforced by the security audit).
Setting `webhook-secret-key` removes the hardcoded fallback key flagged as a HIGH
finding in `/api/v1/release-readiness/security-audit`.

## Apply order

```bash
kubectl create namespace workflow-engine    # if it does not exist yet
kubectl -n workflow-engine apply -f secrets.example.yaml   # real values, not the example
kubectl apply -k deploy/k8s/production
```

`kustomization.yaml` applies the remaining resources (service, deployments, ingress,
HPA, PDB). To skip kustomize:

```bash
kubectl apply -f deploy/k8s/production/service.yaml
kubectl apply -f deploy/k8s/production/api-deployment.yaml
kubectl apply -f deploy/k8s/production/worker-deployment.yaml
kubectl apply -f deploy/k8s/production/ingress.yaml
kubectl apply -f deploy/k8s/production/hpa.yaml
kubectl apply -f deploy/k8s/production/pdb.yaml
```

## Verify

```bash
kubectl -n workflow-engine rollout status deployment/workflow-engine-api
kubectl -n workflow-engine rollout status deployment/workflow-engine-worker
kubectl -n workflow-engine get hpa,pdb
kubectl -n workflow-engine get pods -o wide
```

Then confirm readiness from the product itself:
`GET /api/v1/release-readiness/deployment` (validates these manifests) and
`GET /api/v1/release-readiness/readiness` (aggregate score).

## Rollback

1. Application rollback (previous image):
   ```bash
   kubectl -n workflow-engine rollout undo deployment/workflow-engine-api
   kubectl -n workflow-engine rollout undo deployment/workflow-engine-worker
   ```

2. Pinned tag rollback: set the previous tag in `kustomization.yaml` under `images`
   and re-apply `kubectl apply -k deploy/k8s/production`.

3. Manifest rollback: `kubectl apply -k deploy/k8s/production` from the previous git
   revision, or `git checkout <rev> -- deploy/k8s/production && kubectl apply -k ...`.

4. Full teardown (last resort):
   ```bash
   kubectl delete -k deploy/k8s/production
   ```
   Secrets are not managed by kustomize and must be deleted explicitly.
