import { normalizeRawItems } from "./productNormalizer.js";

const QUANTITY_RE = /(?:x|X|＊|\*)\s*(\d+)|(\d+)\s*(?:份|個|入|顆|杯|塊|支)/;

export function parseRawItemsFromText(text = "") {
  return String(text)
    .split(/[+＋、,，/／\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const quantityMatch = part.match(QUANTITY_RE);
      const quantity = quantityMatch ? Number(quantityMatch[1] ?? quantityMatch[2]) : 1;
      const name = part.replace(QUANTITY_RE, "").trim();
      return { name: name || part, quantity: quantity || 1 };
    });
}

export function enrichCoupon(coupon) {
  const rawItems = Array.isArray(coupon.rawItems) && coupon.rawItems.length
    ? coupon.rawItems
    : parseRawItemsFromText(`${coupon.title ?? ""} ${coupon.description ?? ""}`);
  const normalized = normalizeRawItems(rawItems);

  return {
    ...coupon,
    rawItems,
    items: coupon.items && Object.keys(coupon.items).length ? coupon.items : normalized.items,
    unknownItems: coupon.unknownItems ?? normalized.unknownItems,
    available: coupon.available ?? isCouponCurrentlyAvailable(coupon)
  };
}

export function isCouponCurrentlyAvailable(coupon, now = new Date()) {
  const start = coupon.startDate ? new Date(`${coupon.startDate}T00:00:00+08:00`) : null;
  const end = coupon.endDate ? new Date(`${coupon.endDate}T23:59:59+08:00`) : null;
  return (!start || start <= now) && (!end || end >= now);
}
