import assert from "node:assert/strict";
import test from "node:test";
import {
  broadLabel,
  calculatorCategories,
  categoryProducts,
  isCategoryKey,
  productCategoryKey
} from "../src/lib/productCatalog.js";

test("former side foods are reclassified under the visible 正餐 category", () => {
  assert.equal(productCategoryKey("paper_chicken"), "meal");
  assert.equal(productCategoryKey("rice"), "meal");
  assert.equal(productCategoryKey("omelet_flatbread"), "meal");
  assert.equal(productCategoryKey("combo"), "meal");
});

test("sauce moves to its own 醬料 category", () => {
  assert.equal(productCategoryKey("sauce"), "condiment");
});

test("meal and condiment categories are selectable; side no longer exists", () => {
  const keys = calculatorCategories().map((category) => category.key);
  assert.ok(keys.includes("meal"));
  assert.ok(keys.includes("condiment"));
  assert.ok(!keys.includes("side"));
  assert.ok(isCategoryKey("meal"));
  assert.ok(isCategoryKey("condiment"));
});

test("category metadata and product membership are intact", () => {
  assert.equal(broadLabel("meal"), "任一正餐");
  assert.equal(broadLabel("condiment"), "任一醬料");
  const mealKeys = categoryProducts("meal").map((product) => product.key);
  assert.deepEqual(mealKeys, ["paper_chicken", "rice", "omelet_flatbread", "combo"]);
});
