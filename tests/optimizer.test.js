import assert from "node:assert/strict";
import test from "node:test";
import { findSimilarCoupons, optimizeCoupons } from "../src/lib/optimizer.js";

test("chooses 12345 + 23456 instead of the more expensive equivalent coupon", () => {
  const coupons = [
    { code: "12345", price: 50, items: { zinger_burger: 1, fried_chicken: 1 }, available: true },
    { code: "23456", price: 60, items: { drink: 1, fried_chicken: 1 }, available: true },
    { code: "34567", price: 150, items: { zinger_burger: 1, fried_chicken: 2, drink: 1 }, available: true }
  ];

  const result = optimizeCoupons({ zinger_burger: 1, fried_chicken: 2, drink: 1 }, coupons);

  assert.equal(result.totalPrice, 110);
  assert.equal(result.bestPlan.totalPrice, 110);
  assert.deepEqual(result.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["12345", 1], ["23456", 1]]);
});

test("alternative Test Case A lists the more expensive complete single-coupon plan", () => {
  const result = optimizeCoupons(
    { burger: 1, fried_chicken: 2, drink: 1 },
    [
      { code: "12345", price: 50, items: { zinger_burger: 1, fried_chicken: 1 }, available: true },
      { code: "23456", price: 60, items: { drink: 1, fried_chicken: 1 }, available: true },
      { code: "34567", price: 150, items: { zinger_burger: 1, fried_chicken: 2, drink: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 110);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["12345", 1], ["23456", 1]]);
  assert.equal(result.alternativePlans[0].totalPrice, 150);
  assert.equal(result.alternativePlans[0].priceDelta, 40);
  assert.deepEqual(result.alternativePlans[0].selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["34567", 1]]);
  assert.deepEqual(result.alternativePlans[0].missingItems, {});
});

test("alternative Test Case B includes complete broad burger drink plans only", () => {
  const result = optimizeCoupons(
    { burger: 1, drink: 1 },
    [
      { code: "A", price: 95, items: { pork_burger: 1, drink: 1 }, available: true },
      { code: "B", price: 100, items: { zinger_burger: 1, drink: 1 }, available: true },
      { code: "C", price: 90, items: { zinger_burger: 1, fries: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 95);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
  assert.deepEqual(result.alternativePlans.map((plan) => plan.selectedCoupons[0].code), ["B"]);
});

test("alternative Test Case C allows extras and sorts by total price", () => {
  const result = optimizeCoupons(
    { burger: 1 },
    [
      { code: "A", price: 80, items: { zinger_burger: 1 }, available: true },
      { code: "B", price: 70, items: { pork_burger: 1, fries: 1 }, available: true },
      { code: "C", price: 90, items: { zinger_burger: 1, drink: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 70);
  assert.deepEqual(result.bestPlan.extraItems, { fries: 1 });
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["B"]);
  assert.deepEqual(result.alternativePlans.map((plan) => [plan.selectedCoupons[0].code, plan.totalPrice]), [["A", 80], ["C", 90]]);
  assert.deepEqual(result.alternativePlans[1].extraItems, { drink: 1 });
});

test("alternative Test Case D exact spicy crispy chicken cannot be replaced by similar chicken", () => {
  const result = optimizeCoupons(
    { burger: 1, spicy_crispy_chicken: 1 },
    [
      { code: "A", price: 99, items: { zinger_burger: 1, spicy_crispy_chicken: 1 }, available: true },
      { code: "B", price: 89, items: { pork_burger: 1, original_crispy_chicken: 1 }, available: true },
      { code: "C", price: 120, items: { zinger_burger: 1, sichuan_fried_chicken: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 99);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
  assert.deepEqual(result.alternativePlans, []);
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

test("keeps high-coverage coupon candidates even when cheap partial coupons exist", () => {
  const cheapDrinkCoupons = Array.from({ length: 40 }, (_, index) => ({
    code: `drink-${index}`,
    price: 10 + index,
    items: { drink: 1 },
    available: true
  }));
  const result = optimizeCoupons(
    { zinger_burger: 1, fried_chicken: 1, drink: 1 },
    [
      ...cheapDrinkCoupons,
      { code: "15854", price: 155, items: { zinger_burger: 1, fried_chicken: 1, drink: 1 }, available: true }
    ]
  );

  assert.deepEqual(result.selectedCoupons.map((coupon) => coupon.code), ["15854"]);
  assert.deepEqual(result.missingItems, {});
});

test("can optimize with precise burger and drink categories", () => {
  const result = optimizeCoupons(
    { sichuan_zinger_burger: 1, sichuan_fried_chicken: 1, small_drink: 1 },
    [
      {
        code: "15854",
        price: 155,
        items: { sichuan_zinger_burger: 1, sichuan_fried_chicken: 1, small_drink: 1 },
        available: true
      }
    ]
  );

  assert.equal(result.totalPrice, 155);
  assert.deepEqual(result.missingItems, {});
});

test("does not treat one precise burger variant as another precise variant", () => {
  const result = optimizeCoupons(
    { peanut_zinger_burger: 1 },
    [
      {
        code: "sichuan",
        price: 155,
        items: { sichuan_zinger_burger: 1 },
        available: true
      }
    ]
  );

  assert.deepEqual(result.selectedCoupons, []);
  assert.deepEqual(result.missingItems, { peanut_zinger_burger: 1 });
});

test("broad selections can match precise item variants", () => {
  const result = optimizeCoupons(
    { zinger_burger: 1, fried_chicken: 1, drink: 1 },
    [
      {
        code: "15854",
        price: 155,
        items: { sichuan_zinger_burger: 1, sichuan_fried_chicken: 1, small_drink: 1 },
        available: true
      }
    ]
  );

  assert.equal(result.totalPrice, 155);
  assert.deepEqual(result.missingItems, {});
});

test("returns similar coupon recommendations when no full match exists", () => {
  const recommendations = findSimilarCoupons(
    { zinger_burger: 1, fried_chicken: 1, drink: 1 },
    [
      { code: "partial", price: 99, items: { fried_chicken: 1, drink: 1 }, available: true },
      { code: "weak", price: 50, items: { fries: 1 }, available: true }
    ]
  );

  assert.equal(recommendations[0].code, "partial");
  assert.deepEqual(recommendations[0].matchedItems, { fried_chicken: 1, drink: 1 });
});
