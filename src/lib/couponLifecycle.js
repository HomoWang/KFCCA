import { isCouponCurrentlyAvailable } from "./couponParser.js";

export const DEFAULT_NEW_DAYS = 14;
export const DEFAULT_ENDING_SOON_DAYS = 7;

const DAY_MS = 86400000;

// 把 YYYY-MM-DD 視為台灣時區當天起點，與 couponParser 的日期慣例一致。
function startOfDay(date) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function wholeDaysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function getCouponLifecycle(
  coupon,
  { now = new Date(), history = null, newDays = DEFAULT_NEW_DAYS, endingSoonDays = DEFAULT_ENDING_SOON_DAYS } = {}
) {
  const isOngoing = isCouponCurrentlyAvailable(coupon, now);
  const end = startOfDay(coupon?.endDate);
  const today = startOfDay(toDateString(now));

  const isExpired = Boolean(end) && Boolean(today) && wholeDaysBetween(today, end) < 0;

  let isEndingSoon = false;
  if (isOngoing && end && today) {
    const daysLeft = wholeDaysBetween(today, end);
    isEndingSoon = daysLeft >= 0 && daysLeft <= endingSoonDays;
  }

  const isNew = isNewCoupon(coupon, { now, history, newDays });

  const statuses = [];
  if (isOngoing) statuses.push("ongoing");
  if (isEndingSoon) statuses.push("ending_soon");
  if (isExpired) statuses.push("expired");
  if (isNew) statuses.push("new");

  return { isOngoing, isEndingSoon, isExpired, isNew, statuses };
}

export function isNewCoupon(coupon, { now = new Date(), history = null, newDays = DEFAULT_NEW_DAYS } = {}) {
  const firstSeen = history?.codes?.[coupon?.code];
  return isWithinNewWindow(firstSeen, history?.baselineDate, now, newDays);
}

// 共用的「新登場」判定：firstSeen 必須晚於 baseline（冷啟動首批視為既有），且距今不超過 newDays。
export function isWithinNewWindow(firstSeen, baselineDate, now, newDays) {
  if (!firstSeen) return false;
  const seen = startOfDay(firstSeen);
  const baseline = startOfDay(baselineDate);
  const today = startOfDay(toDateString(now));
  if (!seen || !today) return false;
  if (baseline && wholeDaysBetween(baseline, seen) <= 0) return false;
  const age = wholeDaysBetween(seen, today);
  return age >= 0 && age <= newDays;
}

export function matchesStatus(lifecycle, status) {
  if (!status || status === "all") return true;
  return Boolean(lifecycle?.statuses?.includes(status));
}

function toDateString(now) {
  const date = now instanceof Date ? now : new Date(now);
  // 以台灣時區換算出「今天」的 YYYY-MM-DD，避免 UTC 跨日誤差。
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
