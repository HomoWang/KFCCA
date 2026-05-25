import assert from "node:assert/strict";
import test from "node:test";
import { optimizeCoupons } from "../src/lib/optimizer.js";

test("chooses 12345 + 23456 instead of the more expensive equivalent coupon", () => {
  const coupons = [
    { code: "12345", price: 50, items: { zinger_burger: 1, fried_chicken: 1 }, available: true },
    { code: "23456", price: 60, items: { drink: 1, fried_chicken: 1 }, available: true },
    { code: "34567", price: 150, items: { zinger_burger: 1, fried_chicken: 2, drink: 1 }, available: true }
  ];

  const result = optimizeCoupons({ zinger_burger: 1, fried_chicken: 2, drink: 1 }, coupons);

  assert.equal(result.totalPrice, 110);
  assert.deepEqual(result.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["12345", 1], ["23456", 1]]);
});

test("reports missingItems when demand cannot be fully satisfied", () => {
  const result = optimizeCoupons(
    { zinger_burger: 1, drink: 1 },
    [{ code: "12345", price: 50, items: { zinger_burger: 1 }, available: true }]
  );

  assert.deepEqual(result.missingItems, { drink: 1 });
  assert.equal(result.totalPrice, 50);
});

test("reports extraItems when overbuying is unavoidable", () => {
  const result = optimizeCoupons(
    { fried_chicken: 1 },
    [{ code: "12345", price: 50, items: { fried_chicken: 2 }, available: true }]
  );

  assert.deepEqual(result.extraItems, { fried_chicken: 1 });
});

test("tie breaker chooses fewer extra items", () => {
  const result = optimizeCoupons(
    { fried_chicken: 1 },
    [
      { code: "10000", price: 100, items: { fried_chicken: 1, drink: 1 }, available: true },
      { code: "20000", price: 100, items: { fried_chicken: 1 }, available: true }
    ]
  );

  assert.deepEqual(result.selectedCoupons.map((coupon) => coupon.code), ["20000"]);
});

test("tie breaker chooses fewer coupon count when price and extras are equal", () => {
  const result = optimizeCoupons(
    { fried_chicken: 2 },
    [
      { code: "10000", price: 50, items: { fried_chicken: 1 }, available: true },
      { code: "20000", price: 100, items: { fried_chicken: 2 }, available: true }
    ]
  );

  assert.deepEqual(result.selectedCoupons.map((coupon) => coupon.code), ["20000"]);
});

test("does not buy absurd quantities of cheap extra items", () => {
  const result = optimizeCoupons(
    { zinger_burger: 3, drink: 1 },
    [
      { code: "burger", price: 100, items: { zinger_burger: 1 }, available: true },
      { code: "drink-pack", price: 1, items: { drink: 3 }, available: true }
    ]
  );

  assert.equal(result.providedItems.zinger_burger, 3);
  assert.equal(result.providedItems.drink, 3);
  assert.equal(result.extraItems.drink, 2);
});
