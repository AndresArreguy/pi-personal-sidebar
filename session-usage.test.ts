import test from "node:test";
import assert from "node:assert/strict";
import {
  addSessionUsage,
  cacheHitPercent,
  emptySessionUsage,
  type SessionUsage,
} from "./session-usage.ts";

function totals(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return { ...emptySessionUsage(), ...overrides };
}

test("cache hit is the cached share of all prompt tokens", () => {
  const hit = cacheHitPercent(totals({ input: 311, cacheRead: 735_872 }));

  assert.ok(hit !== null);
  assert.ok(hit > 99.9 && hit < 100);
});

test("cache writes count as uncached prompt tokens", () => {
  const hit = cacheHitPercent(totals({ input: 0, cacheRead: 80, cacheWrite: 20 }));

  assert.equal(hit, 80);
});

test("without prompt tokens there is no hit rate to show", () => {
  assert.equal(cacheHitPercent(emptySessionUsage()), null);
});

test("without cache reads there is no hit rate to show", () => {
  assert.equal(cacheHitPercent(totals({ input: 120, output: 40 })), null);
});

test("session totals accumulate counters and both cost shapes", () => {
  const sum = emptySessionUsage();
  addSessionUsage(sum, { input: 10, output: 2, cacheRead: 100, cacheWrite: 5, cost: { total: 0.25 } });
  addSessionUsage(sum, { input: 5, output: 1, cacheRead: 50, cacheWrite: 0, cost: 0.5 });

  assert.deepEqual(sum, { input: 15, output: 3, cacheRead: 150, cacheWrite: 5, cost: 0.75 });
});
