import assert from "node:assert/strict";
import test from "node:test";
import { findSimilarCoupons, optimizeCoupons } from "../src/lib/optimizer.js";

test("Test Case 1: broad burger plus exact spicy crispy chicken", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "burger", quantity: 1 }, { type: "exact", productKey: "crispy_chicken_spicy", quantity: 1 }] }] },
    [
      { code: "A", price: 99, items: { zinger_burger: 1, crispy_chicken_spicy: 1 }, available: true },
      { code: "B", price: 89, items: { pork_burger: 1, crispy_chicken_original: 1 }, available: true },
      { code: "C", price: 120, items: { zinger_burger: 1, sichuan_fried_chicken: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 99);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
  assert.deepEqual(result.alternativePlans, []);
});

test("Test Case 2: broad burger plus broad drink alternatives", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "burger", quantity: 1 }, { type: "broad", category: "drink", quantity: 1 }] }] },
    [
      { code: "A", price: 100, items: { zinger_burger: 1, pepsi: 1 }, available: true },
      { code: "B", price: 95, items: { pork_burger: 1, iced_tea: 1 }, available: true },
      { code: "C", price: 90, items: { zinger_burger: 1, small_fries: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 95);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["B"]);
  assert.deepEqual(result.alternativePlans.map((plan) => plan.selectedCoupons[0].code), ["A"]);
});

test("Test Case 3: exact burger cannot be replaced by another burger", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "exact", productKey: "zinger_burger", quantity: 1 }, { type: "broad", category: "drink", quantity: 1 }] }] },
    [
      { code: "A", price: 100, items: { zinger_burger: 1, pepsi: 1 }, available: true },
      { code: "B", price: 80, items: { pork_burger: 1, pepsi: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 100);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
});

test("Test Case 4: exact requirement is assigned before broad requirement", () => {
  const result = optimizeCoupons(
    {
      people: [
        { name: "第 1 人", requirements: [{ type: "broad", category: "burger", quantity: 1 }] },
        { name: "第 2 人", requirements: [{ type: "exact", productKey: "zinger_burger", quantity: 1 }] }
      ]
    },
    [{ code: "A", price: 100, items: { zinger_burger: 1, pork_burger: 1 }, available: true }]
  );

  assert.equal(result.bestPlan.totalPrice, 100);
  const person1 = result.bestPlan.assignment.find((entry) => entry.personIndex === 1);
  const person2 = result.bestPlan.assignment.find((entry) => entry.personIndex === 2);
  assert.deepEqual(person2.assignedItems.map((item) => item.productKey), ["zinger_burger"]);
  assert.deepEqual(person1.assignedItems.map((item) => item.productKey), ["pork_burger"]);
});

test("repeated coupon copies are allowed when broad and exact demand both need them", () => {
  const result = optimizeCoupons(
    {
      people: [
        { name: "第 1 人", requirements: [{ type: "broad", category: "burger", quantity: 1 }] },
        { name: "第 2 人", requirements: [{ type: "exact", productKey: "zinger_burger", quantity: 1 }] }
      ]
    },
    [{ code: "A", price: 50, items: { zinger_burger: 1 }, available: true }]
  );

  assert.equal(result.bestPlan.totalPrice, 100);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["A", 2]]);
  assert.deepEqual(result.bestPlan.missingRequirements, []);
});

test("exact drink product is not treated as broad drink category", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "exact", productKey: "drink", quantity: 1 }] }] },
    [{ code: "A", price: 40, items: { small_drink: 1 }, available: true }]
  );

  assert.deepEqual(result.bestPlan.selectedCoupons, []);
  assert.equal(result.bestPlan.missingRequirements[0].productKey, "drink");
});

test("Test Case 5: cheapest plan may include extra items", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "burger", quantity: 1 }] }] },
    [
      { code: "A", price: 80, items: { zinger_burger: 1 }, available: true },
      { code: "B", price: 70, items: { pork_burger: 1, small_fries: 1 }, available: true },
      { code: "C", price: 90, items: { zinger_burger: 1, drink: 1 }, available: true }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 70);
  assert.deepEqual(result.bestPlan.extraItems, { small_fries: 1 });
  assert.deepEqual(result.alternativePlans.map((plan) => [plan.selectedCoupons[0].code, plan.totalPrice]), [["A", 80], ["C", 90]]);
  assert.deepEqual(result.alternativePlans[1].extraItems, { drink: 1 });
});

test("Test Case 6: tie breaker chooses fewer extra items", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "burger", quantity: 1 }] }] },
    [
      { code: "A", price: 80, items: { zinger_burger: 1 }, available: true },
      { code: "B", price: 80, items: { zinger_burger: 1, small_fries: 1 }, available: true }
    ]
  );

  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
});

test("Test Case 7: chicken nuggets cannot satisfy broad fried chicken", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "fried_chicken", quantity: 1 }] }] },
    [{ code: "A", price: 30, items: { chicken_nuggets: 1 }, available: true }]
  );

  assert.deepEqual(result.bestPlan.selectedCoupons, []);
  assert.equal(result.bestPlan.missingRequirements[0].category, "fried_chicken");
});

test("Test Case 8: chicken nuggets can satisfy broad snack", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "snack", quantity: 1 }] }] },
    [{ code: "A", price: 30, items: { chicken_nuggets: 1 }, available: true }]
  );

  assert.equal(result.bestPlan.totalPrice, 30);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
});

test("Test Case 9: real fried chicken can satisfy broad fried chicken", () => {
  const result = optimizeCoupons(
    { people: [{ requirements: [{ type: "broad", category: "fried_chicken", quantity: 1 }] }] },
    [{ code: "A", price: 49, items: { crispy_chicken_spicy: 1 }, available: true }]
  );

  assert.equal(result.bestPlan.totalPrice, 49);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => coupon.code), ["A"]);
});

test("legacy flat demand remains supported", () => {
  const result = optimizeCoupons(
    { burger: 1, drink: 1 },
    [{ code: "A", price: 100, items: { zinger_burger: 1, small_drink: 1 }, available: true }]
  );

  assert.equal(result.bestPlan.totalPrice, 100);
  assert.deepEqual(result.bestPlan.missingRequirements, []);
});

test("similar coupon recommendations still work", () => {
  const recommendations = findSimilarCoupons(
    { people: [{ requirements: [{ type: "broad", category: "burger", quantity: 1 }, { type: "broad", category: "drink", quantity: 1 }] }] },
    [
      { code: "partial", price: 99, items: { zinger_burger: 1 }, available: true },
      { code: "weak", price: 50, items: { small_fries: 1 }, available: true }
    ]
  );

  assert.equal(recommendations[0].code, "partial");
});
