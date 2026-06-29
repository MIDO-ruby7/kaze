import { describe, it, expect } from "vitest";

import type { HostResources } from "../../pool/resources.js";
import { computePoolSizing } from "../../pool/sizing.js";

// Helper: build a HostResources object with given totalMemMB and cpuCount.
// freeMemMB defaults to totalMemMB (no OS overhead) to keep tests predictable.
function makeResources(
  totalMemMB: number,
  cpuCount: number,
  freeMemMB?: number,
): HostResources {
  return {
    totalMemMB,
    freeMemMB: freeMemMB ?? totalMemMB,
    cpuCount,
  };
}

describe("computePoolSizing", () => {
  // AC-5: minimum guarantee — even when RAM is nearly zero the result must be at least 1/1
  it("AC-5: returns minimum {1,1} when available RAM is extremely low", () => {
    const result = computePoolSizing(makeResources(256, 1));
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(1);
  });

  // AC-4 case 1: low RAM (1 GB), 4 cores
  it("AC-4 low-RAM: 1 GB / 4 cores — stays within memory budget", () => {
    const resources = makeResources(1024, 4);
    const result = computePoolSizing(resources);
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(1);
    // total RAM used must not exceed available
    const usedMB =
      result.processCount * (350 + result.contextsPerProcess * 50);
    expect(usedMB).toBeLessThanOrEqual(1024);
  });

  // AC-4 case 2: mid RAM (8 GB), 4 cores
  it("AC-4 mid-RAM: 8 GB / 4 cores — scales up processCount", () => {
    const resources = makeResources(8 * 1024, 4);
    const result = computePoolSizing(resources);
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(1);
    // With 4 cores, floor(4/4)=1 process; more contexts per process
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(5);
  });

  // AC-4 case 3: high RAM (64 GB), 8 cores — scales to many processes
  it("AC-4 high-RAM: 64 GB / 8 cores — processCount scales with RAM", () => {
    const resources = makeResources(64 * 1024, 8);
    const result = computePoolSizing(resources);
    // 64GB / (350 + 10×50) MB per process = 74 processes
    expect(result.processCount).toBeGreaterThanOrEqual(10);
    expect(result.contextsPerProcess).toBe(10);
    expect(result.totalParallel).toBeGreaterThanOrEqual(100);
  });

  // AC-4 case 4: single core, moderate RAM
  it("AC-4 single-core: still uses RAM budget for processCount", () => {
    const resources = makeResources(8 * 1024, 1);
    const result = computePoolSizing(resources);
    // 8GB / 850MB per process = 9 processes
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(1);
  });

  // AC-4 case 5: many cores (16), high RAM — large CI machine
  it("AC-4 multi-core: 64 GB / 16 cores — scales to many processes", () => {
    const resources = makeResources(64 * 1024, 16);
    const result = computePoolSizing(resources);
    expect(result.processCount).toBeGreaterThanOrEqual(10);
    expect(result.totalParallel).toBeGreaterThanOrEqual(100);
  });

  // AC-3: maxProcesses override
  it("AC-3: maxProcesses caps the process count", () => {
    const resources = makeResources(64 * 1024, 16);
    const result = computePoolSizing(resources, { maxProcesses: 2 });
    expect(result.processCount).toBeLessThanOrEqual(2);
  });

  // AC-3: maxContextsPerProcess override
  it("AC-3: maxContextsPerProcess caps contexts per process", () => {
    const resources = makeResources(64 * 1024, 16);
    const result = computePoolSizing(resources, { maxContextsPerProcess: 3 });
    expect(result.contextsPerProcess).toBeLessThanOrEqual(3);
  });

  // AC-3: both overrides at once
  it("AC-3: both maxProcesses and maxContextsPerProcess can be set together", () => {
    const resources = makeResources(64 * 1024, 16);
    const result = computePoolSizing(resources, {
      maxProcesses: 1,
      maxContextsPerProcess: 1,
    });
    expect(result.processCount).toBe(1);
    expect(result.contextsPerProcess).toBe(1);
  });

  // AC-5: CI-like environment (very low free RAM, single CPU)
  it("AC-5: CI narrow environment guarantees minimum {1,1}", () => {
    const resources = makeResources(512, 1, 100);
    const result = computePoolSizing(resources);
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(1);
  });

  // GAP-1: insufficientMemory flag
  it("GAP-1: insufficientMemory=true when freeMemMB < 400", () => {
    // 399 MB is just below the 400 MB threshold (350 process + 50 context)
    const resources = makeResources(1024, 4, 399);
    const result = computePoolSizing(resources);
    expect(result.insufficientMemory).toBe(true);
  });

  it("GAP-1: insufficientMemory=false when freeMemMB >= 400", () => {
    const resources = makeResources(1024, 4, 400);
    const result = computePoolSizing(resources);
    expect(result.insufficientMemory).toBe(false);
  });

  it("GAP-1: insufficientMemory=false for normal RAM (8 GB)", () => {
    const resources = makeResources(8 * 1024, 4);
    const result = computePoolSizing(resources);
    expect(result.insufficientMemory).toBe(false);
  });

  // GAP-2: cpuCount=0 boundary — sizing must still return a valid result
  it("GAP-2: cpuCount=0 input still returns processCount >= 1", () => {
    // cpuCount=0 simulates an environment where os.cpus() returns an empty array.
    // computePoolSizing should treat it like cpuCount=1 (guarded by probeHostResources,
    // but we also verify the pure function handles it gracefully).
    const resources = makeResources(8 * 1024, 0);
    const result = computePoolSizing(resources);
    expect(result.processCount).toBeGreaterThanOrEqual(1);
    expect(result.contextsPerProcess).toBeGreaterThanOrEqual(1);
  });
});
