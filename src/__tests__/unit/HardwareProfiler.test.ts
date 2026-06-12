import { describe, test, expect } from 'vitest';
import { HardwareProfiler } from '../../services/HardwareProfiler';

describe('HardwareProfiler System Diagnostics tests', () => {
  test('should compute a numeric CPU Load value', async () => {
    const cpuLoad = await HardwareProfiler.getCPULoad();
    expect(typeof cpuLoad).toBe('number');
    expect(cpuLoad).toBeGreaterThanOrEqual(0);
    expect(cpuLoad).toBeLessThanOrEqual(100);
  });

  test('should return complete Live Hardware Metrics', async () => {
    const metrics = await HardwareProfiler.getLiveMetrics();
    expect(metrics).toHaveProperty('cpuLoad');
    expect(metrics).toHaveProperty('totalMemoryGB');
    expect(metrics).toHaveProperty('freeMemoryGB');
    expect(metrics).toHaveProperty('usedMemoryGB');
    expect(metrics).toHaveProperty('memoryUsagePct');

    expect(typeof metrics.cpuLoad).toBe('number');
    expect(typeof metrics.totalMemoryGB).toBe('number');
    expect(typeof metrics.memoryUsagePct).toBe('number');
  });

  test('should compute optimal model config profile', async () => {
    const config = await HardwareProfiler.getOptimalModelConfig();
    expect(config.profile).toBe('CONSTRAINED_TIER');
    expect(config.modelCompletion).toBe('qwen2.5-coder:1.5b');
    expect(config.options.num_ctx).toBe(1536);
  });
});
