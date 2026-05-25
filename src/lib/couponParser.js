import { normalizeRawItems } from "./productNormalizer.js";

const QUANTITY_RE = /(.+?)(?:\s*[xX]\s*(\d+)|\s*(\d+)\s*(?:份|個|塊|顆|杯|包|入|桶))?$/;
const FREE_RE = /(免費|0\s*元|零元|兌換|贈)/;
const PRECISE_BURGER_KEYS = [
  "peanut_zinger_burger",
  "sichuan_zinger_burger",
  "crispy_chicken_burger",
  "new_orleans_burger",
  "shrimp_burger"
];
const PRECISE_REPLACEMENTS = [
  { parent: "zinger_burger", children: PRECISE_BURGER_KEYS },
  { parent: "burger", children: PRECISE_BURGER_KEYS },
  { parent: "fried_chicken", children: ["sichuan_fried_chicken"] },
  { parent: "drink", children: ["small_drink", "medium_drink"] },
  { parent: "fries", children: ["medium_fries", "large_fries"] }
];

export function parseRawItemsFromText(text = "") {
  return String(text)
    .split(/\s*\+\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const quantityMatch = part.match(QUANTITY_RE);
      const quantity = quantityMatch ? Number(quantityMatch[2] ?? quantityMatch[3] ?? 1) : 1;
      const name = quantityMatch ? quantityMatch[1].trim() : part;
      return { name: name || part, quantity: quantity || 1 };
    });
}

export function enrichCoupon(coupon) {
  const rawItems = Array.isArray(coupon.rawItems) && coupon.rawItems.length
    ? coupon.rawItems
    : parseRawItemsFromText(`${coupon.title ?? ""} ${coupon.description ?? ""}`);
  const normalized = normalizeRawItems(rawItems);
  const items = mergeItems(coupon.items, normalized.items);
  const parseIssues = buildParseIssues(coupon, rawItems);

  return {
    ...coupon,
    rawItems,
    items,
    unknownItems: coupon.unknownItems ?? normalized.unknownItems,
    parseIssues: coupon.parseIssues?.length ? coupon.parseIssues : parseIssues,
    parseStatus: coupon.parseStatus ?? (parseIssues[0] || "ok"),
    deliveryAvailable: coupon.deliveryAvailable ?? coupon.available ?? true,
    available: coupon.available ?? isCouponCurrentlyAvailable(coupon)
  };
}

export function isCouponCurrentlyAvailable(coupon, now = new Date()) {
  const start = coupon.startDate ? new Date(`${coupon.startDate}T00:00:00+08:00`) : null;
  const end = coupon.endDate ? new Date(`${coupon.endDate}T23:59:59+08:00`) : null;
  return (!start || start <= now) && (!end || end >= now);
}

function buildParseIssues(coupon, rawItems) {
  const issues = [];
  const text = `${coupon.title ?? ""} ${coupon.description ?? ""}`;
  if (Number(coupon.price ?? 0) === 0 && !FREE_RE.test(text)) issues.push("zero_price");
  if (!rawItems.length) issues.push("missing_items");
  if (!coupon.startDate || !coupon.endDate) issues.push("missing_dates");
  return issues;
}

function mergeItems(existingItems = {}, normalizedItems = {}) {
  const items = { ...existingItems };
  for (const replacement of PRECISE_REPLACEMENTS) {
    if (replacement.children.some((key) => normalizedItems[key])) {
      delete items[replacement.parent];
    }
  }
  for (const [key, quantity] of Object.entries(normalizedItems)) {
    items[key] = Math.max(Number(items[key] ?? 0), Number(quantity) || 0);
  }
  return items;
}
