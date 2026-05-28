import assert from "node:assert/strict";
import test from "node:test";
import { enrichCoupon } from "../src/lib/couponParser.js";
import { expandItemAliases, normalizeProductName } from "../src/lib/productNormalizer.js";
import { productCategoryKey } from "../src/lib/productCatalog.js";

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

  assert.equal(coupon.items.sichuan_fried_chicken, 1);
  assert.equal(coupon.items.iced_tea, 1);
  assert.equal(expandItemAliases(coupon.items).fried_chicken, 1);
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
  assert.equal(coupon.items.fried_chicken_piece, undefined);
  assert.equal(coupon.displayItems.find((item) => item.productKey === "crispy_chicken_spicy").quantity, 1);
});

test("raw items replace stale generated item keys", () => {
  const coupon = enrichCoupon({
    code: "stale",
    price: 85,
    items: { fried_chicken: 1 },
    rawItems: [{ name: "咔啦脆雞(辣)", quantity: 1 }]
  });

  assert.deepEqual(coupon.items, { crispy_chicken_spicy: 1 });
});

test("longer product aliases win over shorter fuzzy matches", () => {
  assert.equal(normalizeProductName("花生熔岩咔啦雞腿堡(辣)"), "peanut_zinger_burger");
  assert.equal(normalizeProductName("咔啦雞腿堡(辣)"), "zinger_burger");
});

test("egg tart flavored ice cream is not categorized as egg tart", () => {
  assert.equal(normalizeProductName("蛋塔"), "egg_tart");
  assert.equal(normalizeProductName("原味蛋撻"), "egg_tart");
  assert.equal(normalizeProductName("蛋塔風味冰淇淋"), "egg_tart_ice_cream");
  assert.equal(normalizeProductName("冰心蛋塔"), "egg_tart_ice_cream");
  assert.equal(productCategoryKey("egg_tart_ice_cream"), "ice_cream");
});

test("ice cream mochi keeps the strawberry cheese product key", () => {
  assert.equal(normalizeProductName("冰淇淋大福"), "strawberry_cheese_mochi");
  assert.equal(normalizeProductName("草莓起司冰淇淋大福"), "strawberry_cheese_mochi");
  assert.equal(productCategoryKey("strawberry_cheese_mochi"), "ice_cream");
});
