import assert from "node:assert/strict";
import test from "node:test";
import { getCouponLifecycle, isWithinNewWindow, matchesStatus } from "../src/lib/couponLifecycle.js";

const NOW = new Date("2026-06-15T12:00:00+08:00");

test("ongoing coupon with distant end date is not ending soon", () => {
  const lifecycle = getCouponLifecycle({ startDate: "2026-06-01", endDate: "2026-06-30" }, { now: NOW });
  assert.equal(lifecycle.isOngoing, true);
  assert.equal(lifecycle.isEndingSoon, false);
  assert.equal(lifecycle.isExpired, false);
});

test("ending soon boundary is inclusive at 7 days and excludes 8 days", () => {
  const within = getCouponLifecycle({ startDate: "2026-06-01", endDate: "2026-06-22" }, { now: NOW });
  const beyond = getCouponLifecycle({ startDate: "2026-06-01", endDate: "2026-06-23" }, { now: NOW });
  assert.equal(within.isEndingSoon, true);
  assert.equal(beyond.isEndingSoon, false);
});

test("coupon ending today counts as ongoing and ending soon, not expired", () => {
  const lifecycle = getCouponLifecycle({ startDate: "2026-06-01", endDate: "2026-06-15" }, { now: NOW });
  assert.equal(lifecycle.isOngoing, true);
  assert.equal(lifecycle.isEndingSoon, true);
  assert.equal(lifecycle.isExpired, false);
});

test("past end date is expired and not ongoing", () => {
  const lifecycle = getCouponLifecycle({ startDate: "2026-05-01", endDate: "2026-06-10" }, { now: NOW });
  assert.equal(lifecycle.isExpired, true);
  assert.equal(lifecycle.isOngoing, false);
  assert.equal(lifecycle.isEndingSoon, false);
});

test("missing end date is ongoing but never ending soon or expired", () => {
  const lifecycle = getCouponLifecycle({ startDate: "2026-06-01", endDate: null }, { now: NOW });
  assert.equal(lifecycle.isOngoing, true);
  assert.equal(lifecycle.isEndingSoon, false);
  assert.equal(lifecycle.isExpired, false);
});

test("isNew requires first seen after baseline and within new window", () => {
  const history = {
    baselineDate: "2026-06-01",
    codes: { fresh: "2026-06-10", seeded: "2026-06-01", before: "2026-05-20" }
  };

  assert.equal(getCouponLifecycle({ code: "fresh" }, { now: NOW, history }).isNew, true);
  assert.equal(getCouponLifecycle({ code: "seeded" }, { now: NOW, history }).isNew, false);
  assert.equal(getCouponLifecycle({ code: "before" }, { now: NOW, history }).isNew, false);
  assert.equal(getCouponLifecycle({ code: "unknown" }, { now: NOW, history }).isNew, false);
});

test("isNew is false when history is absent", () => {
  assert.equal(getCouponLifecycle({ code: "anything" }, { now: NOW, history: null }).isNew, false);
});

test("first seen older than new window is not new even after baseline", () => {
  const history = { baselineDate: "2026-05-01", codes: { aged: "2026-05-25" } };
  assert.equal(isWithinNewWindow("2026-05-25", "2026-05-01", NOW, 14), false);
  assert.equal(getCouponLifecycle({ code: "aged" }, { now: NOW, history, newDays: 14 }).isNew, false);
});

test("matchesStatus treats all as wildcard and checks membership otherwise", () => {
  const lifecycle = getCouponLifecycle({ startDate: "2026-06-01", endDate: "2026-06-22" }, { now: NOW });
  assert.equal(matchesStatus(lifecycle, "all"), true);
  assert.equal(matchesStatus(lifecycle, "ending_soon"), true);
  assert.equal(matchesStatus(lifecycle, "expired"), false);
});
