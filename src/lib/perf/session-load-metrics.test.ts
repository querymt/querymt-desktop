import { describe, expect, it, vi } from 'vitest';
import { SessionLoadMeasurement } from './session-load-metrics';

describe('SessionLoadMeasurement cleanup', () => {
  it('disconnects and releases long-task observations idempotently', () => {
    const disconnect = vi.fn();
    const OriginalObserver = globalThis.PerformanceObserver;
    class MockObserver {
      constructor(_callback: PerformanceObserverCallback) {}
      observe() {}
      disconnect() {
        disconnect();
      }
    }
    Object.defineProperty(globalThis, 'PerformanceObserver', {
      configurable: true,
      value: MockObserver
    });

    try {
      const measurement = new SessionLoadMeasurement('agent-1', 'session-1');
      measurement.cleanup();
      measurement.cleanup();
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(measurement.counters()).toEqual(expect.objectContaining({
        longTaskCount: 0,
        longTaskTotalMs: 0,
        longestTaskMs: 0
      }));
    } finally {
      Object.defineProperty(globalThis, 'PerformanceObserver', {
        configurable: true,
        value: OriginalObserver
      });
    }
  });
});
