// 商品目錄單一來源：src/data/product-catalog.json。
// productCatalogData.js 由 script/build-catalog.mjs 生成；改目錄請編輯 JSON 後重新生成。
import { productCategories } from "./productCatalogData.js";

export { productCategories };

export const productCategoryMap = Object.fromEntries(productCategories.map((category) => [category.key, category]));

export const PRODUCT_CATALOG = Object.fromEntries(
  productCategories.flatMap((category) => [
    [category.key, { label: category.broadOptionLabel, category: category.label, type: "broad" }],
    ...category.products.map((product) => [
      product.key,
      { ...product, category: category.label, categoryKey: category.key, type: "exact" }
    ])
  ])
);

export const legacyProductKeyMap = {
  fries: "small_fries",
  nugget: "chicken_nuggets",
  fried_chicken: "fried_chicken_piece",
  spicy_crispy_chicken: "crispy_chicken_spicy",
  original_crispy_chicken: "crispy_chicken_original"
};

export function canonicalProductKey(key) {
  return legacyProductKeyMap[key] ?? key;
}

export function productLabel(key) {
  return PRODUCT_CATALOG[canonicalProductKey(key)]?.label ?? key;
}

export function productCategoryKey(key) {
  return PRODUCT_CATALOG[canonicalProductKey(key)]?.categoryKey ?? null;
}

export function broadLabel(categoryKey) {
  return productCategoryMap[categoryKey]?.broadOptionLabel ?? productLabel(categoryKey);
}

export function isCategoryKey(key) {
  return Boolean(productCategoryMap[key]);
}

export function categoryProducts(categoryKey) {
  return productCategoryMap[categoryKey]?.products ?? [];
}

export function calculatorCategories() {
  return productCategories;
}

export function catalogOptions() {
  return Object.entries(PRODUCT_CATALOG).map(([key, value]) => ({ key, ...value }));
}
