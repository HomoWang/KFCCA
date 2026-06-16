import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { enrichCoupon } from "../src/lib/couponParser.js";
import { findSimilarCoupons, optimizeCoupons } from "../src/lib/optimizer.js";

// 讀靜態 fixture 而非 live public/coupon.json，讓回歸測試不受每日抓取資料漂移影響。
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/sample-coupons.json", import.meta.url), "utf8"));
const realCoupon15867 = enrichCoupon(fixture.coupons.find((coupon) => coupon.code === "15867"));

function holidayBundleDemand(chickenNuggetsQuantity) {
  return {
    people: [
      {
        requirements: [
          { type: "exact", productKey: "peanut_zinger_burger", quantity: 1 },
          { type: "exact", productKey: "chicken_nuggets", quantity: chickenNuggetsQuantity },
          { type: "broad", category: "egg_tart", quantity: 3 }
        ]
      },
      {
        requirements: [
          { type: "exact", productKey: "zinger_burger", quantity: 1 },
          { type: "broad", category: "drink", quantity: 2 },
          { type: "broad", category: "egg_tart", quantity: 3 }
        ]
      }
    ]
  };
}

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

test("Test Case 15867: complete coupon beats repeated expensive bundle", () => {
  const result = optimizeCoupons(
    {
      people: [
        {
          requirements: [
            { type: "exact", productKey: "peanut_zinger_burger", quantity: 1 },
            { type: "exact", productKey: "chicken_nuggets", quantity: 8 },
            { type: "broad", category: "egg_tart", quantity: 3 }
          ]
        },
        {
          requirements: [
            { type: "exact", productKey: "zinger_burger", quantity: 1 },
            { type: "broad", category: "drink", quantity: 2 },
            { type: "broad", category: "egg_tart", quantity: 3 }
          ]
        }
      ]
    },
    [
      {
        code: "15867",
        price: 398,
        items: {
          peanut_zinger_burger: 1,
          zinger_burger: 1,
          chicken_nuggets: 8,
          egg_tart: 6,
          green_tea: 2,
          sauce: 1
        },
        available: true
      },
      {
        code: "15933",
        price: 350,
        items: {
          peanut_zinger_burger: 1,
          zinger_burger: 1,
          chicken_nuggets: 4,
          egg_tart: 3,
          sweet_potato_ball: 1,
          small_drink: 2
        },
        available: true
      }
    ]
  );

  assert.equal(result.bestPlan.totalPrice, 398);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["15867", 1]]);
  assert.deepEqual(result.bestPlan.extraItems, { sauce: 1 });
  assert.deepEqual(result.bestPlan.missingRequirements, []);
});

test("real 15867 wins when chicken nugget demand is lower than provided quantity", () => {
  assert(realCoupon15867);
  const nearMatch = {
    code: "near-match-466",
    price: 466,
    items: {
      peanut_zinger_burger: 1,
      zinger_burger: 1,
      chicken_nuggets: 3,
      egg_tart: 6,
      green_tea: 2
    },
    available: true
  };

  const result = optimizeCoupons(holidayBundleDemand(3), [nearMatch, realCoupon15867]);

  assert.equal(result.bestPlan.totalPrice, 398);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["15867", 1]]);
  assert.deepEqual(result.bestPlan.extraItems, { chicken_nuggets: 5, sauce: 1 });
  assert.deepEqual(result.bestPlan.missingRequirements, []);
});

test("real 15867 wins when chicken nugget demand is close to provided quantity", () => {
  assert(realCoupon15867);
  const nearMatch = {
    code: "near-match-466",
    price: 466,
    items: {
      peanut_zinger_burger: 1,
      zinger_burger: 1,
      chicken_nuggets: 6,
      egg_tart: 6,
      green_tea: 2
    },
    available: true
  };

  const result = optimizeCoupons(holidayBundleDemand(6), [nearMatch, realCoupon15867]);

  assert.equal(result.bestPlan.totalPrice, 398);
  assert.deepEqual(result.bestPlan.selectedCoupons.map((coupon) => [coupon.code, coupon.quantity]), [["15867", 1]]);
  assert.deepEqual(result.bestPlan.extraItems, { chicken_nuggets: 2, sauce: 1 });
  assert.deepEqual(result.bestPlan.missingRequirements, []);
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
