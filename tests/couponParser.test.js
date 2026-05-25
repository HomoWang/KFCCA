import assert from "node:assert/strict";
import test from "node:test";
import { enrichCoupon } from "../src/lib/couponParser.js";

test("fills drink markers from raw beverage names even when items are incomplete", () => {
  const coupon = enrichCoupon({
    code: "drink",
    price: 100,
    items: { fried_chicken: 1 },
    rawItems: [
      { name: "青花椒炸雞", quantity: 1 },
      { name: "立頓檸檬風味紅茶(小)", quantity: 1 }
    ]
  });

  assert.equal(coupon.items.fried_chicken, 1);
  assert.equal(coupon.items.drink, 1);
});

test("defaults delivery marker from availability when explicit field is absent", () => {
  const coupon = enrichCoupon({ code: "delivery", price: 100, available: true, rawItems: [] });
  assert.equal(coupon.deliveryAvailable, true);
});
