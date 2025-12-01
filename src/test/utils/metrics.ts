/**
 * Metrics Collection Utilities
 * For benchmarking and stress testing with threshold assertions
 */

export interface Metric {
  name: string;
  value: number;
  unit: 'ms' | 'ops/sec' | 'bytes' | 'count';
  timestamp: number;
}

export interface MetricSummary {
  min: number;
  max: number;
  avg: number;
  p95: number;
  p99: number;
  count: number;
}

/** Threshold constants for benchmark assertions */
export const THRESHOLDS = {
  checkpointSaveMs: 50,
  checkpointLoadMs: 30,
  snapshotRecoveryMs: 200,
  deltaApplyMs: 5,
  throughputOpsPerSec: 500,
  convergenceMs: 5000,
} as const;

/**
 * Collects and analyzes performance metrics for benchmarks
 */
export class MetricsCollector {
  private metrics: Metric[] = [];
  private timers: Map<string, number> = new Map();

  /**
   * Start a named timer
   */
  startTimer(name: string): void {
    this.timers.set(name, performance.now());
  }

  /**
   * End a named timer and record the elapsed time
   * @returns elapsed time in milliseconds
   */
  endTimer(name: string): number {
    const start = this.timers.get(name);
    if (start === undefined) {
      throw new Error(`Timer "${name}" was not started`);
    }

    const elapsed = performance.now() - start;
    this.timers.delete(name);

    this.record(name, elapsed, 'ms');
    return elapsed;
  }

  /**
   * Record a metric value
   */
  record(name: string, value: number, unit: Metric['unit']): void {
    this.metrics.push({
      name,
      value,
      unit,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): Metric[] {
    return [...this.metrics];
  }

  /**
   * Get metrics filtered by name
   */
  getMetricsByName(name: string): Metric[] {
    return this.metrics.filter((m) => m.name === name);
  }

  /**
   * Get summary statistics for a specific metric
   */
  getSummary(name?: string): MetricSummary {
    const values = (name ? this.getMetricsByName(name) : this.metrics).map((m) => m.value);

    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, p95: 0, p99: 0, count: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p95: sorted[Math.floor(values.length * 0.95)] ?? sorted[sorted.length - 1],
      p99: sorted[Math.floor(values.length * 0.99)] ?? sorted[sorted.length - 1],
      count: values.length,
    };
  }

  /**
   * Calculate throughput (operations per second)
   */
  calculateThroughput(operationCount: number, durationMs: number): number {
    if (durationMs === 0) return 0;
    return (operationCount / durationMs) * 1000;
  }

  /**
   * Reset all metrics and timers
   */
  reset(): void {
    this.metrics = [];
    this.timers.clear();
  }

  /**
   * Format metrics as a human-readable report
   */
  formatReport(): string {
    const lines: string[] = ['=== Metrics Report ==='];

    // Group metrics by name
    const grouped = new Map<string, Metric[]>();
    for (const metric of this.metrics) {
      const existing = grouped.get(metric.name) ?? [];
      existing.push(metric);
      grouped.set(metric.name, existing);
    }

    for (const [name, metrics] of grouped) {
      const summary = this.getSummary(name);
      const unit = metrics[0].unit;
      lines.push(`\n${name} (${unit}):`);
      lines.push(`  count: ${summary.count}`);
      lines.push(`  min: ${summary.min.toFixed(2)}`);
      lines.push(`  max: ${summary.max.toFixed(2)}`);
      lines.push(`  avg: ${summary.avg.toFixed(2)}`);
      lines.push(`  p95: ${summary.p95.toFixed(2)}`);
      lines.push(`  p99: ${summary.p99.toFixed(2)}`);
    }

    return lines.join('\n');
  }
}
