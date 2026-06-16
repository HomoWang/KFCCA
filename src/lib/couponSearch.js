import { productCategories } from "./productCatalog.js";
import { makeFilterId } from "./couponFilters.js";
import { canonicalizeItems } from "./productNormalizer.js";

function normalize(text) {
  return String(text ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

// productKey -> 正規化後的名稱/別名詞彙，供別名感知比對。
const PRODUCT_TERMS = (() => {
  const map = {};
  for (const category of productCategories) {
    for (const product of category.products) {
      map[product.key] = [...new Set([product.label, ...(product.aliases ?? [])].map(normalize))];
    }
  }
  return map;
})();

export function productKeysMatchingQuery(query) {
  const q = normalize(query);
  if (!q) return [];
  return Object.entries(PRODUCT_TERMS)
    .filter(([, terms]) => terms.some((term) => term && (term.includes(q) || q.includes(term))))
    .map(([key]) => key);
}

export function matchCoupon(coupon, query) {
  const q = normalize(query);
  if (!q) return true;

  const haystack = normalize(`${coupon.code ?? ""} ${coupon.title ?? ""} ${coupon.description ?? ""} ${JSON.stringify(coupon.rawItems ?? [])}`);
  if (haystack.includes(q)) return true;

  const keys = productKeysMatchingQuery(query);
  if (!keys.length) return false;

  const items = canonicalizeItems(coupon.items ?? {});
  return keys.some((key) => Number(items[key] ?? 0) > 0);
}

export function buildSuggestions(query, coupons = [], { limit = 8 } = {}) {
  const q = normalize(query);
  if (!q) return [];

  const suggestions = [];
  const seenProducts = new Set();

  for (const category of productCategories) {
    for (const product of category.products) {
      if (seenProducts.has(product.key)) continue;
      const terms = (PRODUCT_TERMS[product.key] ?? []);
      if (terms.some((term) => term && (term.includes(q) || q.includes(term)))) {
        seenProducts.add(product.key);
        suggestions.push({
          type: "product",
          key: product.key,
          label: product.label,
          filterId: makeFilterId("exact", product.key)
        });
      }
    }
  }

  for (const coupon of coupons) {
    if (normalize(coupon.code).includes(q) || normalize(coupon.title).includes(q)) {
      suggestions.push({ type: "code", code: coupon.code, label: `${coupon.code}｜${coupon.title ?? ""}`.trim() });
    }
    if (suggestions.length >= limit * 3) break;
  }

  return suggestions.slice(0, limit);
}
