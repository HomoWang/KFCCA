import assert from "node:assert/strict";
import test from "node:test";
import { buildOfferPool, filterOffersByMealPeriod, menuProductsToOffers, resolveNativeComboOffers } from "../src/lib/offers.js";
import { optimizeOffers } from "../src/lib/optimizer.js";

const FIXED_NOW = new Date("2026-07-13T12:00:00+08:00");

function exact(productKey, quantity = 1) {
  return { type: "exact", productKey, quantity };
}

function demand(...requirements) {
  return { people: [{ requirements }] };
}

function couponOffer(id, price, items) {
  return {
    id: `coupon:${id}`,
    kind: "coupon",
    code: id,
    title: id,
    price,
    items,
    startDate: "2026-01-01",
    endDate: "2026-12-31"
  };
}

function alacarteOffer(id, price, items) {
  return {
    id: `alacarte:${id}`,
    kind: "alacarte",
    fcode: id,
    title: id,
    price,
    items,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    mealPeriods: ["2", "3", "4"],
    soldOut: false
  };
}

function selectedIds(result) {
  return result.bestPlan.selectedOffers.map((offer) => offer.id).sort();
}

const poolCases = [
  {
    name: "coupon-only",
    offers: [
      couponOffer("C-BURGER", 70, { zinger_burger: 1 }),
      couponOffer("C-DRINK", 30, { pepsi: 1 })
    ],
    full: { price: 100, ids: ["coupon:C-BURGER", "coupon:C-DRINK"] },
    partial: { price: 70, ids: ["coupon:C-BURGER"] }
  },
  {
    name: "alacarte-only",
    offers: [
      alacarteOffer("A-BURGER", 95, { zinger_burger: 1 }),
      alacarteOffer("A-DRINK", 33, { pepsi: 1 })
    ],
    full: { price: 128, ids: ["alacarte:A-BURGER", "alacarte:A-DRINK"] },
    partial: { price: 95, ids: ["alacarte:A-BURGER"] }
  },
  {
    name: "mixed",
    offers: [
      couponOffer("C-BURGER", 70, { zinger_burger: 1 }),
      alacarteOffer("A-BURGER", 95, { zinger_burger: 1 }),
      alacarteOffer("A-DRINK", 33, { pepsi: 1 })
    ],
    full: { price: 103, ids: ["alacarte:A-DRINK", "coupon:C-BURGER"] },
    partial: { price: 70, ids: ["coupon:C-BURGER"] }
  }
];

const scenarioCases = [
  {
    name: "empty demand",
    input: demand(),
    expected(pool) {
      return { price: 0, ids: [], missingItems: {}, fulfilledItems: {} };
    }
  },
  {
    name: "all satisfiable",
    input: demand(exact("zinger_burger"), exact("pepsi")),
    expected(pool) {
      return {
        ...pool.full,
        missingItems: {},
        fulfilledItems: { zinger_burger: 1, pepsi: 1 }
      };
    }
  },
  {
    name: "all unsatisfiable",
    input: demand(exact("soup")),
    expected(pool) {
      return { price: 0, ids: [], missingItems: { soup: 1 }, fulfilledItems: {} };
    }
  },
  {
    name: "partially satisfiable",
    input: demand(exact("zinger_burger"), exact("soup")),
    expected(pool) {
      return {
        ...pool.partial,
        missingItems: { soup: 1 },
        fulfilledItems: { zinger_burger: 1 }
      };
    }
  }
];

for (const pool of poolCases) {
  for (const scenario of scenarioCases) {
    test(`offer matrix: ${pool.name} / ${scenario.name}`, () => {
      const expected = scenario.expected(pool);
      const result = optimizeOffers(scenario.input, pool.offers, { now: FIXED_NOW });

      assert.equal(result.bestPlan.totalPrice, expected.price);
      assert.deepEqual(selectedIds(result), [...expected.ids].sort());
      assert.deepEqual(result.bestPlan.missingItems, expected.missingItems);
      assert.deepEqual(result.bestPlan.fulfilledItems, expected.fulfilledItems);
      assert.deepEqual(
        result.bestPlan.missingRequirements.map((requirement) => requirement.productKey),
        Object.keys(expected.missingItems)
      );
    });
  }
}

test("menu single conversion uses minPrice and fixedItems only", () => {
  const offers = menuProductsToOffers([
    {
      fcode: "A-BURGER",
      name: "測試單點堡",
      isSingleItem: true,
      soldOut: false,
      basePrice: 80,
      minPrice: 95,
      fixedItems: { zinger_burger: 1 },
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      mealPeriods: ["1", "2"],
      addonGroups: [{ options: [{ productKey: "pepsi", quantity: 1, extra: 1 }] }]
    },
    {
      fcode: "COMBO",
      name: "批次 b 才處理的套餐",
      isSingleItem: false,
      soldOut: false,
      minPrice: 100,
      fixedItems: {}
    }
  ]);

  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0], {
    id: "alacarte:A-BURGER",
    kind: "alacarte",
    fcode: "A-BURGER",
    title: "測試單點堡",
    price: 95,
    items: { zinger_burger: 1 },
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    mealPeriods: ["1", "2"],
    soldOut: false,
    unitPrice: 95,
    displayItems: [{ productKey: "zinger_burger", label: "卡啦雞腿堡", quantity: 1 }]
  });
});

test("offer pool combines coupons with single and combo menu products", () => {
  const offers = buildOfferPool({
    coupons: [{ code: "C1", title: "測試券", price: 70, items: { zinger_burger: 1 } }],
    menuProducts: [
      { fcode: "A1", name: "測試單點", isSingleItem: true, minPrice: 33, fixedItems: { pepsi: 1 } },
      { fcode: "M1", name: "測試套餐", isSingleItem: false, minPrice: 100, fixedItems: { pepsi: 1 } }
    ]
  });

  assert.deepEqual(offers.map((offer) => [offer.id, offer.kind]), [
    ["coupon:C1", "coupon"],
    ["alacarte:A1", "alacarte"],
    ["combo:M1:fixed", "combo"]
  ]);
});

test("native combo search resolves choice groups with count-aware price and items", () => {
  const templates = menuProductsToOffers([{
    fcode: "COMBO-4",
    name: "四種變體套餐",
    isSingleItem: false,
    soldOut: false,
    basePrice: 100,
    minPrice: 110,
    fixedItems: { zinger_burger: 1 },
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    mealPeriods: ["2", "3"],
    choiceGroups: [
      {
        count: 2,
        options: [
          { name: "咔啦脆雞", productKey: "crispy_chicken_spicy", extra: 0, quantity: 1 },
          { name: "青花椒脆雞", productKey: "sichuan_fried_chicken", extra: 5, quantity: 1 }
        ]
      },
      {
        count: 1,
        options: [
          { name: "百事可樂", productKey: "pepsi", extra: 10, quantity: 1 },
          { name: "無糖綠茶", productKey: "green_tea", extra: 12, quantity: 1 }
        ]
      }
    ],
    addonGroups: [{ options: [{ productKey: "egg_tart", extra: 1, quantity: 1 }] }]
  }]);
  const offers = resolveNativeComboOffers(templates, [
    exact("crispy_chicken_spicy"), exact("sichuan_fried_chicken"), exact("pepsi"), exact("green_tea")
  ]);

  assert.equal(offers.length, 4);
  const selected = offers.find((offer) => offer.id === "combo:COMBO-4:g0o1.g1o0");
  assert.equal(selected.price, 120);
  assert.deepEqual(selected.items, { zinger_burger: 1, sichuan_fried_chicken: 2, pepsi: 1 });
  assert.deepEqual(selected.selectedChoices.map((choice) => [choice.name, choice.quantity, choice.extra]), [
    ["青花椒脆雞", 2, 10],
    ["百事可樂", 1, 10]
  ]);
  assert.equal(selected.nativeChoiceSearch, true);
  assert.equal(selected.variantCount, 4);
});

test("combo pricing preserves mandatory fixed extras represented only in minPrice", () => {
  const templates = menuProductsToOffers([{
    fcode: "FIXED-EXTRA",
    name: "固定加價套餐",
    isSingleItem: false,
    basePrice: 100,
    minPrice: 130,
    fixedItems: { zinger_burger: 1 },
    choiceGroups: [{ count: 1, options: [
      { name: "百事可樂", productKey: "pepsi", extra: 10, quantity: 1 },
      { name: "蘋果汁", productKey: "apple_juice", extra: 20, quantity: 1 }
    ] }]
  }]);
  const offers = resolveNativeComboOffers(templates, [exact("pepsi"), exact("apple_juice")]);

  assert.deepEqual(offers.map((offer) => offer.price), [130, 140]);
});

test("combo products expose one native-search template regardless of theoretical variants", () => {
  const offers = menuProductsToOffers([{
    fcode: "COMBO-LIMIT",
    name: "大型任選套餐",
    isSingleItem: false,
    soldOut: false,
    basePrice: 200,
    fixedItems: { zinger_burger: 1 },
    choiceGroups: [
      { count: 1, options: [
        { name: "薯條 A", productKey: "small_fries", extra: 5, quantity: 1 },
        { name: "薯條 B", productKey: "medium_fries", extra: 0, quantity: 1 },
        { name: "薯條 C", productKey: "large_fries", extra: 10, quantity: 1 }
      ] },
      { count: 2, options: [
        { name: "飲料 A", productKey: "pepsi", extra: 8, quantity: 1 },
        { name: "飲料 B", productKey: "green_tea", extra: 3, quantity: 1 },
        { name: "飲料 C", productKey: "iced_tea", extra: 6, quantity: 1 }
      ] }
    ]
  }], { maxComboVariants: 4 });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].id, "combo:COMBO-LIMIT:native");
  assert.equal(offers[0].price, 206);
  assert.deepEqual(offers[0].items, { zinger_burger: 1 });
  assert.equal(offers[0].variantFallback, false);
  assert.equal(offers[0].variantCount, 9);
  assert.equal(offers[0].expansionMode, "native");
});

test("native combo choice search keeps a non-cheapest variant needed by demand", () => {
  const offers = menuProductsToOffers([{
    fcode: "COMBO-NATIVE",
    name: "大型任選套餐",
    isSingleItem: false,
    basePrice: 200,
    fixedItems: { zinger_burger: 1 },
    choiceGroups: [
      { count: 1, options: [
        { name: "小薯", productKey: "small_fries", extra: 5, quantity: 1 },
        { name: "中薯", productKey: "medium_fries", extra: 0, quantity: 1 },
        { name: "大薯", productKey: "large_fries", extra: 10, quantity: 1 }
      ] },
      { count: 1, options: [
        { name: "百事可樂", productKey: "pepsi", extra: 8, quantity: 1 },
        { name: "綠茶", productKey: "green_tea", extra: 3, quantity: 1 },
        { name: "冰紅茶", productKey: "iced_tea", extra: 6, quantity: 1 }
      ] }
    ]
  }], { maxComboVariants: 4 });

  const result = optimizeOffers(demand(exact("small_fries"), exact("pepsi")), offers, { now: FIXED_NOW });

  assert.equal(result.bestPlan.totalPrice, 213);
  assert.equal(result.bestPlan.selectedOffers[0].id, "combo:COMBO-NATIVE:g0o0.g1o0");
  assert.deepEqual(result.bestPlan.selectedOffers[0].items, { zinger_burger: 1, small_fries: 1, pepsi: 1 });
});

test("native combo search aggregates repeated demand across people", () => {
  const offers = menuProductsToOffers([{
    fcode: "COMBO-QUANTITY",
    name: "飲料任選套餐",
    isSingleItem: false,
    basePrice: 100,
    fixedItems: {},
    choiceGroups: [{ count: 1, options: [
      { name: "百事可樂一杯", productKey: "pepsi", extra: 0, quantity: 1 },
      { name: "百事可樂兩杯", productKey: "pepsi", extra: 10, quantity: 2 }
    ] }]
  }]);
  const input = { people: [
    { name: "A", requirements: [exact("pepsi")] },
    { name: "B", requirements: [exact("pepsi")] }
  ] };

  const result = optimizeOffers(input, offers, { now: FIXED_NOW });

  assert.equal(result.bestPlan.totalPrice, 110);
  assert.equal(result.bestPlan.selectedOffers[0].id, "combo:COMBO-QUANTITY:g0o1");
  assert.equal(result.bestPlan.selectedOffers[0].items.pepsi, 2);
});

test("no-item choices add nothing while 不辣 food choices remain content", () => {
  const templates = menuProductsToOffers([{
    fcode: "NO-SAUCE",
    name: "醬料任選餐",
    isSingleItem: false,
    basePrice: 100,
    fixedItems: { zinger_burger: 1 },
    choiceGroups: [
      { count: 1, options: [
        { name: "不需附糖醋醬", productKey: "sauce", extra: 0, quantity: 1 },
        { name: "需要糖醋醬", productKey: "sauce", extra: 5, quantity: 1 }
      ] },
      { count: 1, options: [
        { name: "咔啦爆脆雞(不辣)", productKey: "fried_chicken_piece", extra: 0, quantity: 1 },
        { name: "咔啦脆雞(辣)", productKey: "crispy_chicken_spicy", extra: 0, quantity: 1 }
      ] }
    ]
  }]);
  const offers = resolveNativeComboOffers(templates, [exact("sauce"), exact("fried_chicken_piece"), exact("crispy_chicken_spicy")]);

  const noSauce = offers.find((offer) => offer.id === "combo:NO-SAUCE:g0o0.g1o0");
  assert.deepEqual(noSauce.items, { zinger_burger: 1, fried_chicken_piece: 1 });
  assert.equal(noSauce.selectedChoices[0].isNoItem, true);
  assert.equal(noSauce.selectedChoices[1].isNoItem, false);
});

test("menu-name fallback restores main items omitted from official slots", () => {
  const offers = menuProductsToOffers([
    { fcode: "CHICKEN", name: "咔啦脆雞", isSingleItem: false, basePrice: 71, fixedItems: {}, choiceGroups: [] },
    { fcode: "NUGGETS", name: "上校雞塊4塊", isSingleItem: false, basePrice: 49, fixedItems: {}, choiceGroups: [{
      count: 1,
      options: [
        { name: "糖醋醬", productKey: "sauce", extra: 0, quantity: 1 },
        { name: "不需附糖醋醬", productKey: "sauce", extra: 0, quantity: 1 }
      ]
    }] },
    { fcode: "PORRIDGE", name: "紅藜燕麥脆雞粥", isSingleItem: false, basePrice: 48, fixedItems: {}, choiceGroups: [] },
    { fcode: "SIX", name: "甜辣爆脆無骨雞腿霸(是拉差醬)買5送1", isSingleItem: false, basePrice: 299, fixedItems: {}, choiceGroups: [] },
    { fcode: "FRIES", name: "青花椒薯條", isSingleItem: false, basePrice: 64, fixedItems: { medium_fries: 1, sauce: 1 }, choiceGroups: [] },
    { fcode: "TARTS", name: "1顆原味蛋撻+1顆鐵觀音珍奶蛋撻", isSingleItem: true, minPrice: 101, fixedItems: { egg_tart: 1 }, choiceGroups: [] },
    { fcode: "SHRIMP", name: "黃金超蝦塊3塊", isSingleItem: false, basePrice: 59, fixedItems: {}, choiceGroups: [] }
  ]);

  assert.deepEqual(offers.find((offer) => offer.fcode === "CHICKEN").items, { fried_chicken_piece: 1 });
  assert.deepEqual(offers.find((offer) => offer.fcode === "NUGGETS").items, { chicken_nuggets: 4 });
  assert.deepEqual(offers.find((offer) => offer.fcode === "PORRIDGE").items, { porridge: 1 });
  assert.deepEqual(offers.find((offer) => offer.fcode === "SIX").items, { fried_chicken_piece: 6 });
  assert.deepEqual(offers.find((offer) => offer.fcode === "FRIES").items, { medium_fries: 1, sauce: 1 });
  assert.deepEqual(offers.find((offer) => offer.fcode === "TARTS").items, { egg_tart: 2 });
  assert.deepEqual(offers.find((offer) => offer.fcode === "SHRIMP").items, { shrimp_nuggets: 3 });
});

test("shrimp nuggets never satisfy an exact chicken nugget demand", () => {
  const offers = menuProductsToOffers([
    { fcode: "SHRIMP", name: "黃金超蝦塊3塊", isSingleItem: false, basePrice: 59, fixedItems: {}, choiceGroups: [] }
  ]);
  const result = optimizeOffers(demand(exact("chicken_nuggets")), offers, { now: FIXED_NOW });

  assert.equal(result.bestPlan.totalPrice, 0);
  assert.deepEqual(result.bestPlan.missingItems, { chicken_nuggets: 1 });
});

test("variant labels do not repeat quantities already written in option names", () => {
  const templates = menuProductsToOffers([{
    fcode: "NUGGET-LABEL",
    name: "雞塊餐",
    isSingleItem: false,
    basePrice: 100,
    fixedItems: {},
    choiceGroups: [{ count: 1, options: [
      { name: "上校雞塊4塊", productKey: "chicken_nuggets", extra: 0, quantity: 4 }
    ] }]
  }]);
  const [offer] = resolveNativeComboOffers(templates, [exact("chicken_nuggets")]);

  assert.equal(offer.variantLabel, "上校雞塊4塊");
  assert.equal(offer.items.chicken_nuggets, 4);
});

test("meal-period filtering uses coupon periods when known and keeps legacy coupons", () => {
  const offers = [
    couponOffer("ANYTIME", 70, { zinger_burger: 1 }),
    { ...couponOffer("BREAKFAST-ONLY", 60, { zinger_burger: 1 }), mealPeriods: ["1"] },
    { ...alacarteOffer("BREAKFAST", 40, { hash_brown: 1 }), mealPeriods: ["1"] },
    { ...alacarteOffer("LUNCH", 95, { zinger_burger: 1 }), mealPeriods: ["2", "3", "4"] }
  ];

  assert.deepEqual(filterOffersByMealPeriod(offers, "1").map((offer) => offer.id), ["coupon:ANYTIME", "coupon:BREAKFAST-ONLY", "alacarte:BREAKFAST"]);
  assert.deepEqual(filterOffersByMealPeriod(offers, "2").map((offer) => offer.id), ["coupon:ANYTIME", "alacarte:LUNCH"]);
});

for (const scenario of [
  { comboPrice: 120, expectedPrice: 120, expectedKinds: ["combo"] },
  { comboPrice: 150, expectedPrice: 133, expectedKinds: ["alacarte", "coupon"] }
]) {
  test(`combo competes with coupon plus single-item offers at $${scenario.comboPrice}`, () => {
    const offers = buildOfferPool({
      coupons: [{ code: "MEAL", title: "漢堡薯條券", price: 100, items: { zinger_burger: 1, small_fries: 1 } }],
      menuProducts: [
        { fcode: "DRINK", name: "百事可樂單點", isSingleItem: true, minPrice: 33, fixedItems: { pepsi: 1 } },
        {
          fcode: "COMBO",
          name: "漢堡套餐",
          isSingleItem: false,
          basePrice: scenario.comboPrice,
          fixedItems: { zinger_burger: 1, small_fries: 1, pepsi: 1 },
          choiceGroups: []
        }
      ]
    });
    const result = optimizeOffers(
      demand(exact("zinger_burger"), exact("small_fries"), exact("pepsi")),
      offers,
      { now: FIXED_NOW }
    );

    assert.equal(result.bestPlan.totalPrice, scenario.expectedPrice);
    assert.deepEqual(result.bestPlan.selectedOffers.map((offer) => offer.kind).sort(), scenario.expectedKinds);
    assert.deepEqual(result.bestPlan.missingRequirements, []);
  });
}

test("single-item fallback fills demand that coupons cannot satisfy", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger")),
    [
      couponOffer("DRINK-ONLY", 20, { pepsi: 1 }),
      alacarteOffer("A-BURGER", 95, { zinger_burger: 1 })
    ],
    { now: FIXED_NOW }
  );

  assert.equal(result.bestPlan.totalPrice, 95);
  assert.deepEqual(selectedIds(result), ["alacarte:A-BURGER"]);
  assert.deepEqual(result.bestPlan.selectedOffers.map((offer) => offer.kind), ["alacarte"]);
  assert.deepEqual(result.bestPlan.selectedCoupons, []);
  assert.deepEqual(result.bestPlan.missingRequirements, []);
  assert.equal(result.bestPlan.assignment[0].assignedItems[0].sourceId, "alacarte:A-BURGER");
});

test("menu offers are filtered by sold-out state and Taiwan date boundaries", () => {
  const offers = [
    { ...alacarteOffer("EXPIRED", 1, { zinger_burger: 1 }), endDate: "2026-07-12" },
    { ...alacarteOffer("FUTURE", 2, { zinger_burger: 1 }), startDate: "2026-07-14" },
    { ...alacarteOffer("SOLD-OUT", 3, { zinger_burger: 1 }), soldOut: true },
    { ...alacarteOffer("ACTIVE", 95, { zinger_burger: 1 }), startDate: "2026-07-13", endDate: "2026-07-13" }
  ];

  const result = optimizeOffers(demand(exact("zinger_burger")), offers, { now: FIXED_NOW });

  assert.equal(result.bestPlan.totalPrice, 95);
  assert.deepEqual(selectedIds(result), ["alacarte:ACTIVE"]);
});

test("date availability ignores the untrusted coupon available field", () => {
  const offer = { ...couponOffer("DATE-VALID", 70, { zinger_burger: 1 }), available: false };
  const result = optimizeOffers(demand(exact("zinger_burger")), [offer], { now: FIXED_NOW });

  assert.deepEqual(selectedIds(result), ["coupon:DATE-VALID"]);
});

test("required fallback offers are retained beyond the candidate soft limit", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger"), exact("pepsi")),
    [
      couponOffer("C-BURGER", 70, { zinger_burger: 1 }),
      alacarteOffer("A-DRINK", 33, { pepsi: 1 })
    ],
    { now: FIXED_NOW, maxCandidates: 1 }
  );

  assert.equal(result.bestPlan.totalPrice, 103);
  assert.deepEqual(selectedIds(result), ["alacarte:A-DRINK", "coupon:C-BURGER"]);
  assert.deepEqual(result.bestPlan.missingRequirements, []);
});

test("repeated single-item fallback covers aggregated demand across people", () => {
  const result = optimizeOffers(
    {
      people: Array.from({ length: 4 }, () => ({
        requirements: [exact("zinger_burger")]
      }))
    },
    [alacarteOffer("A-BURGER", 95, { zinger_burger: 1 })],
    { now: FIXED_NOW, extraBuffer: 0 }
  );

  assert.equal(result.bestPlan.totalPrice, 380);
  assert.deepEqual(result.bestPlan.selectedOffers.map((offer) => [offer.id, offer.quantity]), [["alacarte:A-BURGER", 4]]);
  assert.deepEqual(result.bestPlan.missingRequirements, []);
});

test("high-coverage offer is not crowded out by required baseline candidates", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger"), exact("pepsi"), exact("small_fries")),
    [
      couponOffer("A", 20, { zinger_burger: 1, pepsi: 1 }),
      couponOffer("B", 20, { zinger_burger: 1, small_fries: 1 }),
      couponOffer("D", 31, { zinger_burger: 1, pepsi: 1, small_fries: 1 })
    ],
    { now: FIXED_NOW, maxCandidates: 2 }
  );

  assert.equal(result.bestPlan.totalPrice, 31);
  assert.deepEqual(selectedIds(result), ["coupon:D"]);
});

test("coverage reserve keeps a secondary bundle beyond the candidate soft limit", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger"), exact("pepsi"), exact("small_fries"), exact("egg_tart")),
    [
      couponOffer("A", 10, { zinger_burger: 1, pepsi: 1 }),
      couponOffer("B", 10, { zinger_burger: 1, small_fries: 1 }),
      couponOffer("C", 10, { egg_tart: 1 }),
      couponOffer("E", 100, { zinger_burger: 1, pepsi: 1, small_fries: 1, egg_tart: 1 }),
      couponOffer("D", 16, { zinger_burger: 1, pepsi: 1, small_fries: 1 })
    ],
    { now: FIXED_NOW, maxCandidates: 4 }
  );

  assert.equal(result.bestPlan.totalPrice, 26);
  assert.deepEqual(selectedIds(result), ["coupon:C", "coupon:D"]);
});

test("feasible seed plan is returned even when DFS reaches its state limit", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger"), exact("pepsi")),
    [
      alacarteOffer("A-BURGER", 95, { zinger_burger: 1 }),
      alacarteOffer("A-DRINK", 33, { pepsi: 1 })
    ],
    { now: FIXED_NOW, maxStates: 0 }
  );

  assert.equal(result.bestPlan.totalPrice, 128);
  assert.deepEqual(result.bestPlan.missingRequirements, []);
  assert.equal(result.searchLimitReached, true);
});

test("branch lower bound allows splitting demand across cheaper offers", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger", 3), exact("small_fries", 3)),
    [
      couponOffer("FRIES", 41, { small_fries: 1 }),
      couponOffer("BURGER", 10, { zinger_burger: 2 }),
      couponOffer("BUNDLE", 59, { zinger_burger: 2, small_fries: 2 })
    ],
    { now: FIXED_NOW, extraBuffer: 0 }
  );

  assert.equal(result.bestPlan.totalPrice, 110);
  assert.deepEqual(selectedIds(result), ["coupon:BUNDLE", "coupon:BURGER", "coupon:FRIES"]);
});

test("alternative search includes valid plans above the seeded price ceiling", () => {
  const result = optimizeOffers(
    demand(exact("zinger_burger"), exact("pepsi")),
    [
      alacarteOffer("BURGER-10", 10, { zinger_burger: 1 }),
      alacarteOffer("BURGER-20", 20, { zinger_burger: 1 }),
      alacarteOffer("DRINK-10", 10, { pepsi: 1 }),
      alacarteOffer("DRINK-20", 20, { pepsi: 1 })
    ],
    { now: FIXED_NOW }
  );

  assert.equal(result.bestPlan.totalPrice, 20);
  assert.deepEqual(result.alternativePlans.map((plan) => plan.totalPrice).slice(0, 3), [30, 30, 40]);
});
