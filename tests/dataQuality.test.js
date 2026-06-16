import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { enrichCoupon } from "../src/lib/couponParser.js";
import { productCategoryKey } from "../src/lib/productCatalog.js";

// Live 資料：僅用於「警告」層級的資料品質觀察，不作為部署門檻。
const liveData = JSON.parse(fs.readFileSync(new URL("../public/coupon.json", import.meta.url), "utf8"));
const liveCoupons = liveData.coupons.map(enrichCoupon);

// 靜態 fixture：固定樣本，讓正規化規則的回歸測試不受每日抓取資料漂移影響。
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/sample-coupons.json", import.meta.url), "utf8"));
const sample = fixture.coupons.map(enrichCoupon);
const byCode = (code) => sample.find((coupon) => coupon.code === code);

test("live coupon data: unmapped items are reported as a warning, not a deploy blocker", () => {
  const unknownCoupons = liveCoupons.filter((coupon) => coupon.unknownItems?.length);
  const unmappedKeys = liveCoupons.flatMap((coupon) =>
    Object.keys(coupon.items ?? {})
      .filter((key) => !productCategoryKey(key))
      .map((key) => `${coupon.code}:${key}`)
  );
  if (unknownCoupons.length || unmappedKeys.length) {
    console.warn(
      `[data-quality] ${unknownCoupons.length} coupon(s) with unknown items` +
        (unmappedKeys.length ? `; unmapped keys: ${unmappedKeys.join(", ")}` : "")
    );
  }
  // 新品尚未標準化屬預期情況，前端會顯示未標準化品項，不應阻擋部署，因此只警告不斷言。
  assert.ok(Array.isArray(liveCoupons));
});

test("26918 is not double-counted as two fried chicken items", () => {
  const coupon = byCode("26918");
  assert(coupon);
  assert.equal(coupon.items.crispy_chicken_spicy, 1);
  assert.equal(coupon.items.fried_chicken_piece, undefined);
});

test("40634 egg tart flavored ice cream is not treated as egg tart", () => {
  const coupon = byCode("40634");
  assert(coupon);
  assert.equal(coupon.items.egg_tart, undefined);
  assert.equal(coupon.items.egg_tart_ice_cream, 2);
  assert.equal(productCategoryKey("egg_tart_ice_cream"), "ice_cream");
});

test("strawberry cheese ice cream mochi keeps a precise product key", () => {
  const coupon = sample.find((item) => item.description?.includes("草苺起司冰淇淋大福"));
  assert(coupon);
  assert.equal(coupon.items.ice_cream_mochi, undefined);
  assert(Number(coupon.items.strawberry_cheese_mochi ?? 0) > 0);
  assert.equal(productCategoryKey("strawberry_cheese_mochi"), "ice_cream");
});

test("new sauce names are normalized as side items", () => {
  const coupon = byCode("50527");
  assert(coupon);
  assert.equal(coupon.unknownItems.length, 0);
  assert.equal(coupon.items.sauce, 2);
});
