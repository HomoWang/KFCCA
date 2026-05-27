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
      { name: "檸檬風味紅茶(小)", quantity: 1 }
    ]
  });

  assert.equal(coupon.items.fried_chicken_piece, 1);
  assert.equal(coupon.items.sichuan_fried_chicken, 1);
  assert.equal(coupon.items.small_drink, 1);
  assert.equal(expandItemAliases(coupon.items).fried_chicken, 2);
  assert.equal(expandItemAliases(coupon.items).drink, 1);
});

test("defaults delivery marker from availability when explicit field is absent", () => {
  const coupon = enrichCoupon({ code: "delivery", price: 100, available: true, rawItems: [] });
  assert.equal(coupon.deliveryAvailable, true);
});

test("canonicalizes legacy keys and builds display items", () => {
  const coupon = enrichCoupon({
    code: "burger",
    price: 155,
    items: { fries: 1, nugget: 1, spicy_crispy_chicken: 1 },
    rawItems: []
  });

  assert.equal(coupon.items.small_fries, 1);
  assert.equal(coupon.items.chicken_nuggets, 1);
  assert.equal(coupon.items.crispy_chicken_spicy, 1);
  assert(coupon.displayItems.some((item) => item.productKey === "chicken_nuggets" && item.label === "雞塊"));
});

test("does not double count legacy and normalized keys for the same product", () => {
  const coupon = enrichCoupon({
    code: "26918",
    price: 85,
    items: { spicy_crispy_chicken: 1, rice: 1, small_drink: 1 },
    rawItems: [
      { name: "咔啦脆雞(辣)", quantity: 1 },
      { name: "雞汁風味飯", quantity: 1 },
      { name: "無糖綠茶(小)", quantity: 1 }
    ]
  });

  assert.equal(coupon.items.crispy_chicken_spicy, 1);
  assert.equal(coupon.displayItems.find((item) => item.productKey === "crispy_chicken_spicy").quantity, 1);
});
