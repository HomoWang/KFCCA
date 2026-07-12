import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { productCategories } from "../src/lib/productCatalogData.js";

const source = JSON.parse(fs.readFileSync(new URL("../src/data/product-catalog.json", import.meta.url), "utf8"));

test("productCatalogData.js is generated from product-catalog.json (fix: node script/build-catalog.mjs)", () => {
  assert.deepEqual(productCategories, source.categories);
});

test("catalog keys and aliases are unique across categories", () => {
  const keys = source.categories.flatMap((category) => category.products.map((product) => product.key));
  assert.equal(new Set(keys).size, keys.length);

  const aliases = source.categories.flatMap((category) => category.products.flatMap((product) => product.aliases ?? []));
  assert.equal(new Set(aliases).size, aliases.length);
});
