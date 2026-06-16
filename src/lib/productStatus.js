import { canonicalizeItems } from "./productNormalizer.js";
import { getCouponLifecycle, isWithinNewWindow, DEFAULT_NEW_DAYS } from "./couponLifecycle.js";

// 掃描全部優惠券，彙整每個 productKey 的生命週期狀態，供篩選 UI 決定展開/收合/標新。
export function buildProductStatus(
  coupons = [],
  { now = new Date(), history = null, newDays = DEFAULT_NEW_DAYS } = {}
) {
  const status = {};

  for (const coupon of coupons) {
    const lifecycle = getCouponLifecycle(coupon, { now, history, newDays });
    const items = canonicalizeItems(coupon?.items ?? {});
    for (const productKey of Object.keys(items)) {
      const entry = status[productKey] ?? (status[productKey] = { couponCount: 0, ongoingCount: 0 });
      entry.couponCount += 1;
      if (lifecycle.isOngoing) entry.ongoingCount += 1;
    }
  }

  for (const [productKey, entry] of Object.entries(status)) {
    entry.active = entry.ongoingCount > 0;
    entry.stale = entry.couponCount > 0 && entry.ongoingCount === 0;
    entry.isNew = isWithinNewWindow(history?.products?.[productKey], history?.baselineDate, now, newDays);
  }

  return status;
}

export function productStatusFor(productStatus, productKey) {
  return (
    productStatus?.[productKey] ?? { couponCount: 0, ongoingCount: 0, active: false, stale: false, isNew: false }
  );
}
