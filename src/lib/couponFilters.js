import { productCategoryKey } from "./productCatalog.js";
import { canonicalizeItems } from "./productNormalizer.js";

export function makeFilterId(type, key) {
  return `${type}:${key}`;
}

export function parseFilterId(filterId) {
  const [type, ...rest] = String(filterId).split(":");
  return { type, key: rest.join(":") };
}

export function couponMatchesItemFilters(coupon, filterIds = []) {
  if (!filterIds.length) return true;
  return filterIds.every((filterId) => couponMatchesItemFilter(coupon, parseFilterId(filterId)));
}

export function couponMatchesItemFilter(coupon, filter) {
  const items = canonicalizeItems(coupon.items ?? {});
  if (filter.type === "broad") {
    return Object.keys(items).some((productKey) => productCategoryKey(productKey) === filter.key);
  }
  if (filter.type === "exact") {
    return Number(items[filter.key] ?? 0) > 0;
  }
  return false;
}
