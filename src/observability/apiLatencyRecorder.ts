const MAX_SAMPLES = 1_000;

export interface ApiLatencySnapshot {
  requests: number;
  p95Ms: number;
  errorRatePercent: number;
}

interface LatencySample {
  durationMs: number;
  isError: boolean;
}

class ApiLatencyRecorder {
  private samples: LatencySample[] = [];
  private cursor = 0;

  record(durationMs: number, statusCode: number): void {
    const sample: LatencySample = {
      durationMs: Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0,
      isError: statusCode >= 500,
    };
    if (this.samples.length < MAX_SAMPLES) {
      this.samples.push(sample);
      return;
    }
    this.samples[this.cursor] = sample;
    this.cursor = (this.cursor + 1) % MAX_SAMPLES;
  }

  snapshot(): ApiLatencySnapshot {
    const requests = this.samples.length;
    if (requests === 0) {
      return { requests: 0, p95Ms: 0, errorRatePercent: 0 };
    }
    const durations = this.samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const index = Math.min(durations.length - 1, Math.max(0, Math.ceil(0.95 * durations.length) - 1));
    const p95 = durations[index] ?? 0;
    const errors = this.samples.filter((sample) => sample.isError).length;
    return {
      requests,
      p95Ms: Math.round(p95 * 10) / 10,
      errorRatePercent: Math.round((errors / requests) * 1000) / 10,
    };
  }

  reset(): void {
    this.samples = [];
    this.cursor = 0;
  }
}

export const apiLatencyRecorder = new ApiLatencyRecorder();

export function recordApiLatency(durationMs: number, statusCode: number): void {
  apiLatencyRecorder.record(durationMs, statusCode);
}

export default apiLatencyRecorder;
