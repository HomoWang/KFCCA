import { productLabel } from "./productNormalizer.js";

const DEFAULT_OPTIONS = {
  maxCandidates: 36,
  extraBuffer: 2,
  maxStates: 250000,
  similarLimit: 5,
  minSimilarity: 0.5
};

export function optimizeCoupons(requirementItems, coupons, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const demand = cleanItems(requirementItems);
  const demandKeys = Object.keys(demand);

  if (!demandKeys.length) return emptyResult();

  const activeCoupons = coupons
    .filter((coupon) => coupon.available !== false && Number(coupon.price) >= 0)
    .map((coupon) => ({ ...coupon, price: Number(coupon.price) || 0, items: cleanItems(coupon.items) }))
    .filter((coupon) => intersects(Object.keys(coupon.items), demandKeys));

  const missingItems = {};
  const reachableDemand = { ...demand };
  for (const key of demandKeys) {
    const maxPossible = activeCoupons.reduce((sum, coupon) => sum + (coupon.items[key] ?? 0) * estimateMaxQuantity(coupon, demand, opts), 0);
    if (maxPossible <= 0) {
      missingItems[key] = demand[key];
      delete reachableDemand[key];
    }
  }

  const targetKeys = Object.keys(reachableDemand);
  if (!targetKeys.length) {
    return { ...emptyResult(), missingItems };
  }

  const candidates = selectCandidateCoupons(activeCoupons, reachableDemand, opts)
    .slice(0, opts.maxCandidates)
    .map((coupon) => ({ coupon, maxQuantity: estimateMaxQuantity(coupon, reachableDemand, opts) }))
    .filter((entry) => entry.maxQuantity > 0);

  let best = null;
  let visited = 0;

  function dfs(index, selected, provided, totalPrice, count) {
    visited += 1;
    if (visited > opts.maxStates) return;

    if (best && totalPrice > best.totalPrice) return;

    if (covers(provided, reachableDemand)) {
      const candidate = buildResult(selected, provided, reachableDemand, missingItems, totalPrice, count);
      if (!best || compareResults(candidate, best) < 0) best = candidate;
      return;
    }

    if (index >= candidates.length) return;

    const { coupon, maxQuantity } = candidates[index];
    for (let quantity = maxQuantity; quantity >= 0; quantity -= 1) {
      const nextSelected = quantity
        ? [...selected, { coupon, quantity }]
        : selected;
      const nextProvided = quantity
        ? addItems(provided, coupon.items, quantity)
        : provided;
      if (exceedsExtraBuffer(nextProvided, reachableDemand, opts.extraBuffer)) continue;
      dfs(index + 1, nextSelected, nextProvided, totalPrice + coupon.price * quantity, count + quantity);
    }
  }

  dfs(0, [], {}, 0, 0);

  if (best) {
    return Object.keys(best.missingItems ?? {}).length
      ? { ...best, similarCoupons: findSimilarCoupons(demand, coupons, opts) }
      : best;
  }

  return {
    ...emptyResult(),
    missingItems: { ...demand },
    similarCoupons: findSimilarCoupons(demand, coupons, opts),
    searchLimitReached: visited > opts.maxStates
  };
}

export function findSimilarCoupons(requirementItems, coupons, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const demand = cleanItems(requirementItems);
  const totalDemand = itemCount(demand);
  if (!totalDemand) return [];

  return coupons
    .filter((coupon) => coupon.available !== false && Number(coupon.price) >= 0)
    .map((coupon) => ({ ...coupon, price: Number(coupon.price) || 0, items: cleanItems(coupon.items) }))
    .map((coupon) => {
      const matchedItems = {};
      for (const [key, quantity] of Object.entries(demand)) {
        const matched = Math.min(quantity, coupon.items[key] ?? 0);
        if (matched > 0) matchedItems[key] = matched;
      }
      const matchedCount = itemCount(matchedItems);
      const matchedKinds = Object.keys(matchedItems).length;
      const similarity = matchedCount / totalDemand;
      return { coupon, matchedItems, matchedCount, matchedKinds, similarity };
    })
    .filter((entry) => entry.similarity >= opts.minSimilarity)
    .sort((a, b) =>
      b.similarity - a.similarity ||
      b.matchedKinds - a.matchedKinds ||
      a.coupon.price - b.coupon.price ||
      String(a.coupon.endDate ?? "").localeCompare(String(b.coupon.endDate ?? ""))
    )
    .slice(0, opts.similarLimit)
    .map((entry) => ({
      code: entry.coupon.code,
      title: entry.coupon.title,
      price: entry.coupon.price,
      endDate: entry.coupon.endDate,
      items: entry.coupon.items,
      matchedItems: entry.matchedItems,
      similarity: entry.similarity
    }));
}

export function allocateToPeople(peopleRequirements, providedItems) {
  const remaining = { ...providedItems };
  const people = peopleRequirements.map((person, index) => {
    const assigned = {};
    const missing = {};
    for (const [key, quantity] of Object.entries(cleanItems(person.items ?? person))) {
      const take = Math.min(remaining[key] ?? 0, quantity);
      if (take > 0) {
        assigned[key] = take;
        remaining[key] -= take;
      }
      if (take < quantity) missing[key] = quantity - take;
    }
    return { personIndex: index + 1, assigned, missing };
  });

  return { people, extraItems: stripZeroes(remaining) };
}

export function formatItems(items) {
  const entries = Object.entries(cleanItems(items));
  if (!entries.length) return "無";
  return entries.map(([key, quantity]) => `${productLabel(key)} x ${quantity}`).join("、");
}

function buildResult(selected, provided, demand, missingItems, totalPrice, couponCount) {
  const selectedCoupons = selected
    .filter((entry) => entry.quantity > 0)
    .map(({ coupon, quantity }) => ({
      code: coupon.code,
      title: coupon.title,
      quantity,
      price: coupon.price,
      endDate: coupon.endDate
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const providedItems = stripZeroes(provided);
  const extraItems = {};
  for (const [key, quantity] of Object.entries(providedItems)) {
    const extra = quantity - (demand[key] ?? 0);
    if (extra > 0) extraItems[key] = extra;
  }

  return {
    totalPrice,
    selectedCoupons,
    providedItems,
    extraItems,
    missingItems,
    couponCount,
    latestEndDate: selectedCoupons.reduce((latest, coupon) => maxDateString(latest, coupon.endDate), "")
  };
}

function compareResults(a, b) {
  return (
    a.totalPrice - b.totalPrice ||
    itemCount(a.extraItems) - itemCount(b.extraItems) ||
    a.couponCount - b.couponCount ||
    String(b.latestEndDate).localeCompare(String(a.latestEndDate))
  );
}

function selectCandidateCoupons(activeCoupons, demand, opts) {
  const targetKeys = Object.keys(demand);
  const byEfficiency = activeCoupons
    .filter((coupon) => intersects(Object.keys(coupon.items), targetKeys))
    .sort((a, b) => scoreCoupon(a, demand) - scoreCoupon(b, demand));
  const byCoverage = [...byEfficiency].sort((a, b) =>
    coverageKinds(b, demand) - coverageKinds(a, demand) ||
    coveredUnits(b, demand) - coveredUnits(a, demand) ||
    extraUnits(a, demand) - extraUnits(b, demand) ||
    a.price - b.price
  );
  const perKey = targetKeys.flatMap((key) =>
    byEfficiency
      .filter((coupon) => coupon.items[key])
      .slice(0, 6)
  );

  return uniqueCoupons([
    ...byCoverage.slice(0, Math.ceil(opts.maxCandidates * 0.6)),
    ...byEfficiency.slice(0, Math.ceil(opts.maxCandidates * 0.6)),
    ...perKey
  ]);
}

function coverageKinds(coupon, demand) {
  return Object.keys(demand).filter((key) => coupon.items[key]).length;
}

function coveredUnits(coupon, demand) {
  return Object.entries(demand).reduce((sum, [key, quantity]) => sum + Math.min(quantity, coupon.items[key] ?? 0), 0);
}

function extraUnits(coupon, demand) {
  return Object.entries(coupon.items).reduce((sum, [key, quantity]) => sum + Math.max(0, quantity - (demand[key] ?? 0)), 0);
}

function uniqueCoupons(coupons) {
  const seen = new Set();
  return coupons.filter((coupon) => {
    if (seen.has(coupon.code)) return false;
    seen.add(coupon.code);
    return true;
  });
}

function estimateMaxQuantity(coupon, demand, opts) {
  const relevantQuantities = Object.entries(coupon.items)
    .filter(([key]) => demand[key])
    .map(([key, quantity]) => Math.ceil(demand[key] / Math.max(1, quantity)));
  if (!relevantQuantities.length) return 0;
  return Math.max(...relevantQuantities) + opts.extraBuffer;
}

function scoreCoupon(coupon, demand) {
  const relevantUnits = Object.entries(coupon.items).reduce((sum, [key, quantity]) => sum + (demand[key] ? quantity : 0), 0);
  return coupon.price / Math.max(1, relevantUnits);
}

function addItems(base, addition, multiplier = 1) {
  const next = { ...base };
  for (const [key, quantity] of Object.entries(addition)) {
    next[key] = (next[key] ?? 0) + quantity * multiplier;
  }
  return next;
}

function covers(provided, demand) {
  return Object.entries(demand).every(([key, quantity]) => (provided[key] ?? 0) >= quantity);
}

function exceedsExtraBuffer(provided, demand, extraBuffer) {
  return Object.entries(provided).some(([key, quantity]) => quantity > (demand[key] ?? 0) + extraBuffer);
}

function intersects(a, b) {
  const bSet = new Set(b);
  return a.some((key) => bSet.has(key));
}

function cleanItems(items = {}) {
  return Object.fromEntries(
    Object.entries(items)
      .map(([key, quantity]) => [key, Number(quantity)])
      .filter(([key, quantity]) => key && Number.isFinite(quantity) && quantity > 0)
      .map(([key, quantity]) => [key, Math.floor(quantity)])
  );
}

function stripZeroes(items = {}) {
  return Object.fromEntries(Object.entries(items).filter(([, quantity]) => quantity > 0));
}

function itemCount(items = {}) {
  return Object.values(items).reduce((sum, quantity) => sum + quantity, 0);
}

function maxDateString(a, b) {
  if (!a) return b ?? "";
  if (!b) return a;
  return String(a).localeCompare(String(b)) >= 0 ? a : b;
}

function emptyResult() {
  return {
    totalPrice: 0,
    selectedCoupons: [],
    providedItems: {},
    extraItems: {},
    missingItems: {}
  };
}
