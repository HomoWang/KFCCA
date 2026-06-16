import assert from "node:assert/strict";
import test from "node:test";
import { buildProductStatus, productStatusFor } from "../src/lib/productStatus.js";

const NOW = new Date("2026-06-15T12:00:00+08:00");

const coupons = [
  { code: "a", startDate: "2026-06-01", endDate: "2026-06-30", items: { egg_tart: 1, zinger_burger: 1 } },
  { code: "b", startDate: "2026-05-01", endDate: "2026-06-10", items: { egg_tart: 1 } },
  { code: "c", startDate: "2026-04-01", endDate: "2026-05-01", items: { pork_burger: 1 } }
];

test("product appearing in an ongoing coupon is active even if also in expired ones", () => {
  const status = buildProductStatus(coupons, { now: NOW });
  assert.equal(status.egg_tart.couponCount, 2);
  assert.equal(status.egg_tart.ongoingCount, 1);
  assert.equal(status.egg_tart.active, true);
  assert.equal(status.egg_tart.stale, false);
});

test("product only in expired coupons is stale", () => {
  const status = buildProductStatus(coupons, { now: NOW });
  assert.equal(status.pork_burger.active, false);
  assert.equal(status.pork_burger.stale, true);
});

test("product status reflects first seen history for isNew", () => {
  const history = { baselineDate: "2026-06-01", products: { zinger_burger: "2026-06-11", egg_tart: "2026-06-01" } };
  const status = buildProductStatus(coupons, { now: NOW, history });
  assert.equal(status.zinger_burger.isNew, true);
  assert.equal(status.egg_tart.isNew, false);
  assert.equal(status.pork_burger.isNew, false);
});

test("productStatusFor returns a safe default for unknown keys", () => {
  const status = buildProductStatus(coupons, { now: NOW });
  const missing = productStatusFor(status, "does_not_exist");
  assert.deepEqual(missing, { couponCount: 0, ongoingCount: 0, active: false, stale: false, isNew: false });
});
