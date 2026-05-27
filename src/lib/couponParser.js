import { canonicalizeItems, normalizeRawItems } from "./productNormalizer.js";
import { productLabel } from "./productCatalog.js";

const QUANTITY_RE = /(.+?)(?:\s*[xX]\s*(\d+)|\s*(\d+)\s*(?:個|份|塊|顆|杯)?)?$/;
const FREE_RE = /(免費|0\s*元|贈|送)/;

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
    displayItems: buildDisplayItems(items),
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
  const existing = canonicalizeItems(existingItems);
  const normalized = canonicalizeItems(normalizedItems);
  return { ...existing, ...normalized };
}

function buildDisplayItems(items = {}) {
  return Object.entries(canonicalizeItems(items)).map(([productKey, quantity]) => ({
    productKey,
    label: productLabel(productKey),
    quantity
  }));
}
