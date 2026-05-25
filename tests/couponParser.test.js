import assert from "node:assert/strict";
import test from "node:test";
import { enrichCoupon } from "../src/lib/couponParser.js";
import { expandItemAliases } from "../src/lib/productNormalizer.js";

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

  assert.equal(coupon.items.fried_chicken, undefined);
  assert.equal(coupon.items.sichuan_fried_chicken, 1);
  assert.equal(coupon.items.drink, undefined);
  assert.equal(coupon.items.small_drink, 1);
  assert.equal(expandItemAliases(coupon.items).fried_chicken, 1);
  assert.equal(expandItemAliases(coupon.items).drink, 1);
});

test("defaults delivery marker from availability when explicit field is absent", () => {
  const coupon = enrichCoupon({ code: "delivery", price: 100, available: true, rawItems: [] });
  assert.equal(coupon.deliveryAvailable, true);
});

test("uses precise burger category from raw items instead of stale generic burger marker", () => {
  const coupon = enrichCoupon({
    code: "burger",
    price: 155,
    items: { zinger_burger: 1, fried_chicken: 1 },
    rawItems: [
      { name: "青花椒卡啦雞腿堡", quantity: 1 },
      { name: "青花椒炸雞", quantity: 1 },
      { name: "小飲", quantity: 1 }
    ]
  });

  assert.equal(coupon.items.sichuan_zinger_burger, 1);
  assert.equal(coupon.items.sichuan_fried_chicken, 1);
  assert.equal(coupon.items.small_drink, 1);
  assert.equal(coupon.items.zinger_burger, undefined);
  assert.equal(coupon.items.fried_chicken, undefined);
});
