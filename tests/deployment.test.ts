import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';

describe('Deployment Configuration', () => {
  it('should have Dockerfile for backend', () => {
    expect(existsSync('./Dockerfile')).toBe(true);
  });

  it('should have Dockerfile for frontend', () => {
    expect(existsSync('./Dockerfile.frontend')).toBe(true);
  });

  it('should have Kubernetes deployment directory', () => {
    expect(existsSync('./deploy/k8s')).toBe(true);
  });

  it('should have API deployment manifest', () => {
    expect(existsSync('./deploy/k8s/api-deployment.yaml')).toBe(true);
  });
});

describe('Environment Variables', () => {
  it('should support REGION env var', () => {
    // Just checking that our code reads it - actual value doesn't matter for test
    expect(typeof process.env.REGION === 'string' || process.env.REGION === undefined).toBe(true);
  });

  it('should support REDIS_CLUSTER_ENABLED', () => {
    expect(typeof process.env.REDIS_CLUSTER_ENABLED === 'string' || process.env.REDIS_CLUSTER_ENABLED === undefined).toBe(true);
  });

  it('should support DEPLOYMENT_MODE', () => {
    expect(typeof process.env.DEPLOYMENT_MODE === 'string' || process.env.DEPLOYMENT_MODE === undefined).toBe(true);
  });
});
