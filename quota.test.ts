import test from "node:test";
import assert from "node:assert/strict";
import { parseQuota } from "./quota.ts";

const credits = {
  credits: { monthlyCredits: 25.7410576248, purchasedCredits: 0, freeCredits: 0 },
  windowLimits: {
    fiveHour: { used: 0.0131472012, cap: 14, resetAt: 1794955723338 },
    weekly: { used: 9.2560103664, cap: 35, resetAt: 1795201424457 },
  },
};

const subscription = {
  data: {
    planId: "individual-goat",
    status: "active",
    currentPeriodStart: "2026-11-06T18:57:45.000Z",
    currentPeriodEnd: "2026-12-06T18:57:45.000Z",
  },
};

test("monthly bar fills with billing-period spend against the whole pool", () => {
  const snapshot = parseQuota(credits, subscription, { totalCost: 44.254756172199976 });

  assert.ok(snapshot.monthly);
  assert.equal(snapshot.monthly.used, 44.254756172199976);
  assert.equal(snapshot.monthly.cap, 25.7410576248 + 44.254756172199976);
  assert.equal(snapshot.monthly.resetAt, Date.parse("2026-12-06T18:57:45.000Z"));
  assert.equal(snapshot.monthlyRemaining, 25.7410576248);
});

test("windows keep their reset times in milliseconds", () => {
  const snapshot = parseQuota(credits, subscription, { totalCost: 1 });

  assert.equal(snapshot.fiveHour?.resetAt, 1794955723338);
  assert.equal(snapshot.weekly?.cap, 35);
});

test("no billing period means no month bar, only the remaining balance", () => {
  const snapshot = parseQuota(credits, { data: { planId: "free" } }, { totalCost: 44.25 });

  assert.equal(snapshot.monthly, null);
  assert.equal(snapshot.monthlyRemaining, 25.7410576248);
});

test("no summary means no month bar", () => {
  const snapshot = parseQuota(credits, subscription, null);

  assert.equal(snapshot.monthly, null);
  assert.equal(snapshot.monthlyRemaining, 25.7410576248);
});

test("a malformed summary is ignored instead of zero-filling", () => {
  const snapshot = parseQuota(credits, subscription, { totalCost: "nope" });

  assert.equal(snapshot.monthly, null);
});
