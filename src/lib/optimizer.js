import {
  broadLabel,
  canonicalProductKey,
  categoryProducts,
  isCategoryKey,
  productCategoryKey,
  productLabel
} from "./productCatalog.js";
import { canonicalizeItems, expandItemAliases } from "./productNormalizer.js";

const DEFAULT_OPTIONS = {
  maxCandidates: 36,
  extraBuffer: 2,
  maxStates: 250000,
  alternativeLimit: 5,
  alternativeSearchLimit: 30,
  similarLimit: 5,
  minSimilarity: 0.5
};

export function optimizeCoupons(requirementInput, coupons, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const people = normalizePeopleRequirements(requirementInput);
  const requirements = people.flatMap((person) => person.requirements);
  if (!requirements.length) return wrapPlans(emptyResult(people), [], false);

  const activeCoupons = coupons
    .filter((coupon) => coupon.available !== false && Number(coupon.price) >= 0)
    .map(prepareCoupon)
    .filter((coupon) => Object.keys(coupon.items).length && requirements.some((requirement) => couponCanSatisfy(coupon, requirement)));

  const missingBeforeSearch = requirements.filter((requirement) => !activeCoupons.some((coupon) => couponCanSatisfy(coupon, requirement)));
  const searchableRequirements = requirements.filter((requirement) => !missingBeforeSearch.includes(requirement));
  if (!searchableRequirements.length) {
    return wrapPlans({
      ...emptyResult(people),
      missingRequirements: missingBeforeSearch,
      missingItems: requirementsToItemObject(missingBeforeSearch)
    }, [], false);
  }

  const candidates = selectCandidateCoupons(activeCoupons, searchableRequirements, opts)
    .slice(0, opts.maxCandidates)
    .map((coupon) => ({ coupon, maxQuantity: estimateMaxQuantity(coupon, searchableRequirements, opts) }))
    .filter((entry) => entry.maxQuantity > 0);

  const plans = [];
  let visited = 0;

  function dfs(index, selected, totalPrice, couponCount) {
    visited += 1;
    if (visited > opts.maxStates) return;

    const evaluated = evaluatePlan(selected, people, missingBeforeSearch, totalPrice, couponCount);
    if (!evaluated.missingRequirements.length) {
      if (hasOverRepeatedCoupons(selected, searchableRequirements)) return;
      rememberPlan(plans, evaluated, opts.alternativeLimit + opts.alternativeSearchLimit);
      return;
    }

    if (index >= candidates.length) return;

    const { coupon, maxQuantity } = candidates[index];
    for (let quantity = maxQuantity; quantity >= 0; quantity -= 1) {
      const nextSelected = quantity ? [...selected, { coupon, quantity }] : selected;
      if (exceedsExtraBuffer(nextSelected, searchableRequirements, opts.extraBuffer)) continue;
      dfs(index + 1, nextSelected, totalPrice + coupon.price * quantity, couponCount + quantity);
    }
  }

  dfs(0, [], 0, 0);

  const rankedPlans = plans.sort(comparePlans);
  const best = rankedPlans[0] ?? null;
  if (best) {
    const alternatives = rankedPlans
      .slice(1)
      .filter((plan) => !plan.missingRequirements.length)
      .slice(0, opts.alternativeLimit)
      .map((plan, index) => ({ ...plan, rank: index + 2, priceDelta: plan.totalPrice - best.totalPrice }));
    return wrapPlans({ ...best, rank: 1, priceDelta: 0 }, alternatives, visited > opts.maxStates);
  }

  const empty = {
    ...emptyResult(people),
    missingRequirements: requirements,
    missingItems: requirementsToItemObject(requirements),
    similarCoupons: findSimilarCoupons(requirementInput, coupons, opts),
    searchLimitReached: visited > opts.maxStates
  };
  return wrapPlans(empty, [], visited > opts.maxStates);
}

export function findSimilarCoupons(requirementInput, coupons, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const requirements = normalizePeopleRequirements(requirementInput).flatMap((person) => person.requirements);
  if (!requirements.length) return [];

  return coupons
    .filter((coupon) => coupon.available !== false && Number(coupon.price) >= 0)
    .map(prepareCoupon)
    .map((coupon) => {
      const matchedRequirements = requirements.filter((requirement) => couponCanSatisfy(coupon, requirement));
      const matchedCount = matchedRequirements.reduce((sum, requirement) => sum + Math.min(requirement.quantity, matchingQuantity(coupon.items, requirement)), 0);
      const totalDemand = requirements.reduce((sum, requirement) => sum + requirement.quantity, 0);
      return {
        coupon,
        matchedRequirements,
        matchedItems: Object.fromEntries(matchedRequirements.map((requirement) => [requirementKey(requirement), Math.min(requirement.quantity, matchingQuantity(coupon.items, requirement))])),
        similarity: totalDemand ? matchedCount / totalDemand : 0
      };
    })
    .filter((entry) => entry.similarity >= opts.minSimilarity)
    .sort((a, b) =>
      b.similarity - a.similarity ||
      a.coupon.price - b.coupon.price ||
      String(b.coupon.endDate ?? "").localeCompare(String(a.coupon.endDate ?? ""))
    )
    .slice(0, opts.similarLimit)
    .map((entry) => ({
      code: entry.coupon.code,
      title: entry.coupon.title,
      price: entry.coupon.price,
      endDate: entry.coupon.endDate,
      items: entry.coupon.items,
      displayItems: entry.coupon.displayItems,
      matchedItems: entry.matchedItems,
      similarity: entry.similarity
    }));
}

export function allocateToPeople(peopleRequirements, providedItems) {
  const people = normalizePeopleRequirements({ people: peopleRequirements });
  const pseudoCoupon = prepareCoupon({ code: "manual", price: 0, items: providedItems, available: true });
  const plan = evaluatePlan([{ coupon: pseudoCoupon, quantity: 1 }], people, [], 0, 0);
  return {
    people: people.map((person) => ({
      personIndex: person.personIndex,
      assigned: plan.assignment
        .filter((entry) => entry.personIndex === person.personIndex)
        .flatMap((entry) => entry.assignedItems)
        .reduce((sum, item) => addQuantity(sum, item.productKey, item.quantity), {}),
      missing: plan.missingRequirements
        .filter((requirement) => requirement.personIndex === person.personIndex)
        .reduce((sum, requirement) => addQuantity(sum, requirementKey(requirement), requirement.quantity), {})
    })),
    extraItems: plan.extraItems
  };
}

export function formatItems(items) {
  const entries = Array.isArray(items)
    ? items.map((item) => [item.label ?? productLabel(item.productKey ?? item.key), item.quantity])
    : Object.entries(cleanItems(items)).map(([key, quantity]) => [productLabel(key), quantity]);
  if (!entries.length) return "無";
  return entries.map(([label, quantity]) => `${label} x ${quantity}`).join("、");
}

export function requirementLabel(requirement) {
  if (requirement.type === "broad") return broadLabel(requirement.category);
  return productLabel(requirement.productKey);
}

function evaluatePlan(selected, people, seedMissing, totalPrice, couponCount) {
  const itemUnits = buildItemUnits(selected);
  const assignment = assignRequirements(people, itemUnits);
  const missingRequirements = [...seedMissing, ...assignment.missingRequirements];
  const extraItems = summarizeUnits(assignment.remainingUnits);
  const providedItems = summarizeUnits(itemUnits);
  const fulfilledItems = summarizeAssignedItems(assignment.assignment);
  const selectedCoupons = buildSelectedCoupons(selected);

  return {
    totalPrice,
    selectedCoupons,
    providedItems,
    fulfilledItems,
    extraItems,
    extraItemDetails: itemObjectToDetails(extraItems),
    missingItems: requirementsToItemObject(missingRequirements),
    missingRequirements,
    assignment: assignment.assignment,
    couponCount,
    latestEndDate: selectedCoupons.reduce((latest, coupon) => maxDateString(latest, coupon.endDate), "")
  };
}

function assignRequirements(people, itemUnits) {
  const remainingUnits = itemUnits.map((unit) => ({ ...unit }));
  const requirements = people.flatMap((person) => person.requirements);
  const exactFirst = [...requirements].sort((a, b) => Number(b.type === "exact") - Number(a.type === "exact"));
  const assignmentMap = new Map(requirements.map((requirement) => [requirement.id, { ...requirement, assignedItems: [] }]));
  const missingRequirements = [];

  for (const requirement of exactFirst) {
    let remaining = requirement.quantity;
    for (const unit of remainingUnits) {
      if (remaining <= 0) break;
      if (unit.quantity <= 0 || !unitSatisfiesRequirement(unit, requirement)) continue;
      const take = Math.min(unit.quantity, remaining);
      unit.quantity -= take;
      remaining -= take;
      const assignment = assignmentMap.get(requirement.id);
      mergeAssignedItem(assignment.assignedItems, {
        productKey: unit.productKey,
        label: productLabel(unit.productKey),
        quantity: take,
        couponCode: unit.couponCode
      });
    }
    if (remaining > 0) missingRequirements.push({ ...requirement, quantity: remaining });
  }

  return {
    assignment: requirements.map((requirement) => assignmentMap.get(requirement.id)),
    missingRequirements,
    remainingUnits: remainingUnits.filter((unit) => unit.quantity > 0)
  };
}

function normalizePeopleRequirements(input) {
  if (Array.isArray(input)) return normalizePeopleArray(input);
  if (input?.people) return normalizePeopleArray(input.people);
  return [{
    personIndex: 1,
    personName: "第 1 人",
    requirements: Object.entries(cleanItems(input)).map(([key, quantity], index) => normalizeRequirement({ key, quantity }, 1, index))
  }];
}

function normalizePeopleArray(people = []) {
  return people.map((person, personIndex) => {
    const rawRequirements = person.requirements ?? objectItemsToRequirements(person.items ?? person);
    return {
      personIndex: personIndex + 1,
      personName: person.name ?? `第 ${personIndex + 1} 人`,
      requirements: rawRequirements
        .map((requirement, index) => normalizeRequirement(requirement, personIndex + 1, index))
        .filter(Boolean)
    };
  });
}

function objectItemsToRequirements(items = {}) {
  return Object.entries(cleanItems(items)).map(([key, quantity]) => ({ key, quantity }));
}

function normalizeRequirement(requirement, personIndex, index) {
  const quantity = Math.floor(Number(requirement.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  if (requirement.type === "broad" || (requirement.category && !requirement.productKey)) {
    const category = requirement.category ?? requirement.key;
    return {
      id: requirement.id ?? `p${personIndex}-r${index}`,
      personIndex,
      personName: requirement.personName ?? `第 ${personIndex} 人`,
      type: "broad",
      category,
      label: broadLabel(category),
      quantity
    };
  }

  const rawKey = requirement.productKey ?? requirement.key;
  if (isCategoryKey(rawKey)) {
    return {
      id: requirement.id ?? `p${personIndex}-r${index}`,
      personIndex,
      personName: requirement.personName ?? `第 ${personIndex} 人`,
      type: "broad",
      category: rawKey,
      label: broadLabel(rawKey),
      quantity
    };
  }

  const key = canonicalProductKey(rawKey);
  return {
    id: requirement.id ?? `p${personIndex}-r${index}`,
    personIndex,
    personName: requirement.personName ?? `第 ${personIndex} 人`,
    type: "exact",
    productKey: key,
    category: productCategoryKey(key),
    label: productLabel(key),
    quantity
  };
}

function prepareCoupon(coupon) {
  const items = canonicalizeItems(coupon.items);
  return {
    ...coupon,
    price: Number(coupon.price) || 0,
    unitPrice: Number(coupon.price) || 0,
    items,
    displayItems: coupon.displayItems?.length
      ? coupon.displayItems.map((item) => ({
          productKey: canonicalProductKey(item.productKey ?? item.key),
          label: item.label ?? productLabel(item.productKey ?? item.key),
          quantity: Number(item.quantity) || 1
        }))
      : itemObjectToDetails(items)
  };
}

function couponCanSatisfy(coupon, requirement) {
  return matchingQuantity(coupon.items, requirement) > 0;
}

function matchingQuantity(items, requirement) {
  if (requirement.type === "exact") return Number(items[requirement.productKey] ?? 0);
  return categoryProducts(requirement.category).reduce((sum, product) => sum + Number(items[product.key] ?? 0), 0);
}

function unitSatisfiesRequirement(unit, requirement) {
  if (requirement.type === "exact") return unit.productKey === requirement.productKey;
  return productCategoryKey(unit.productKey) === requirement.category;
}

function buildItemUnits(selected) {
  const units = [];
  for (const { coupon, quantity } of selected) {
    for (let copy = 0; copy < quantity; copy += 1) {
      for (const [productKey, itemQuantity] of Object.entries(coupon.items)) {
        units.push({ productKey, quantity: itemQuantity, couponCode: coupon.code });
      }
    }
  }
  return units;
}

function buildSelectedCoupons(selected) {
  return selected
    .filter((entry) => entry.quantity > 0)
    .map(({ coupon, quantity }) => ({
      code: coupon.code,
      title: coupon.title,
      quantity,
      price: coupon.price,
      unitPrice: coupon.price,
      subtotal: coupon.price * quantity,
      endDate: coupon.endDate,
      displayItems: coupon.displayItems
    }))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function selectCandidateCoupons(activeCoupons, requirements, opts) {
  const byEfficiency = [...activeCoupons].sort((a, b) => scoreCoupon(a, requirements) - scoreCoupon(b, requirements));
  const byCoverage = [...activeCoupons].sort((a, b) =>
    coverageKinds(b, requirements) - coverageKinds(a, requirements) ||
    coveredUnits(b, requirements) - coveredUnits(a, requirements) ||
    extraUnits(a, requirements) - extraUnits(b, requirements) ||
    a.price - b.price
  );
  const perRequirement = requirements.flatMap((requirement) =>
    byEfficiency
      .filter((coupon) => couponCanSatisfy(coupon, requirement))
      .slice(0, 6)
  );

  return uniqueCoupons([
    ...byCoverage.slice(0, Math.ceil(opts.maxCandidates * 0.6)),
    ...byEfficiency.slice(0, Math.ceil(opts.maxCandidates * 0.6)),
    ...perRequirement
  ]);
}

function estimateMaxQuantity(coupon, requirements, opts) {
  const relevant = requirements
    .filter((requirement) => couponCanSatisfy(coupon, requirement))
    .map((requirement) => Math.ceil(requirement.quantity / Math.max(1, matchingQuantity(coupon.items, requirement))));
  return relevant.length ? Math.max(...relevant) + opts.extraBuffer : 0;
}

function hasOverRepeatedCoupons(selected, requirements) {
  return selected.some(({ coupon, quantity }) => quantity > estimateRequiredQuantity(coupon, requirements));
}

function estimateRequiredQuantity(coupon, requirements) {
  const relevant = requirements
    .filter((requirement) => couponCanSatisfy(coupon, requirement))
    .map((requirement) => Math.ceil(requirement.quantity / Math.max(1, matchingQuantity(coupon.items, requirement))));
  return relevant.length ? Math.max(...relevant) : 0;
}

function exceedsExtraBuffer(selected, requirements, extraBuffer) {
  const provided = summarizeUnits(buildItemUnits(selected));
  const categoryDemand = {};
  for (const requirement of requirements) {
    if (requirement.type === "broad") categoryDemand[requirement.category] = (categoryDemand[requirement.category] ?? 0) + requirement.quantity;
  }

  return Object.entries(provided).some(([productKey, quantity]) => {
    const directDemand = requirements
      .filter((requirement) => requirement.type === "exact" && requirement.productKey === productKey)
      .reduce((sum, requirement) => sum + requirement.quantity, 0);
    const categoryDemandForItem = categoryDemand[productCategoryKey(productKey)] ?? 0;
    return quantity > directDemand + categoryDemandForItem + extraBuffer;
  });
}

function scoreCoupon(coupon, requirements) {
  const relevantUnits = requirements.reduce((sum, requirement) => sum + Math.min(requirement.quantity, matchingQuantity(coupon.items, requirement)), 0);
  return coupon.price / Math.max(1, relevantUnits);
}

function coverageKinds(coupon, requirements) {
  return requirements.filter((requirement) => couponCanSatisfy(coupon, requirement)).length;
}

function coveredUnits(coupon, requirements) {
  return requirements.reduce((sum, requirement) => sum + Math.min(requirement.quantity, matchingQuantity(coupon.items, requirement)), 0);
}

function extraUnits(coupon, requirements) {
  const relevant = new Set(requirements.flatMap((requirement) =>
    requirement.type === "exact" ? [requirement.productKey] : categoryProducts(requirement.category).map((product) => product.key)
  ));
  return Object.entries(coupon.items).reduce((sum, [key, quantity]) => sum + (relevant.has(key) ? 0 : quantity), 0);
}

function rememberPlan(plans, candidate, maxPlans) {
  const existingIndex = plans.findIndex((plan) => planKey(plan) === planKey(candidate));
  if (existingIndex >= 0) {
    if (comparePlans(candidate, plans[existingIndex]) < 0) plans[existingIndex] = candidate;
  } else {
    plans.push(candidate);
  }
  plans.sort(comparePlans);
  if (plans.length > maxPlans) plans.length = maxPlans;
}

function comparePlans(a, b) {
  return (
    a.totalPrice - b.totalPrice ||
    itemCount(a.extraItems) - itemCount(b.extraItems) ||
    a.couponCount - b.couponCount ||
    String(b.latestEndDate).localeCompare(String(a.latestEndDate))
  );
}

function planKey(plan) {
  return plan.selectedCoupons.map((coupon) => `${coupon.code}:${coupon.quantity}`).join("|");
}

function requirementKey(requirement) {
  return requirement.type === "broad" ? requirement.category : requirement.productKey;
}

function requirementsToItemObject(requirements) {
  return requirements.reduce((sum, requirement) => addQuantity(sum, requirementKey(requirement), requirement.quantity), {});
}

function summarizeUnits(units) {
  return units.reduce((sum, unit) => addQuantity(sum, unit.productKey, unit.quantity), {});
}

function summarizeAssignedItems(assignment) {
  return assignment
    .flatMap((entry) => entry.assignedItems)
    .reduce((sum, item) => addQuantity(sum, item.productKey, item.quantity), {});
}

function itemObjectToDetails(items = {}) {
  return Object.entries(cleanItems(items)).map(([productKey, quantity]) => ({
    productKey,
    label: productLabel(productKey),
    quantity
  }));
}

function mergeAssignedItem(items, next) {
  const existing = items.find((item) => item.productKey === next.productKey && item.couponCode === next.couponCode);
  if (existing) {
    existing.quantity += next.quantity;
  } else {
    items.push(next);
  }
}

function addQuantity(items, key, quantity) {
  items[key] = (items[key] ?? 0) + quantity;
  return items;
}

function uniqueCoupons(coupons) {
  const seen = new Set();
  return coupons.filter((coupon) => {
    if (seen.has(coupon.code)) return false;
    seen.add(coupon.code);
    return true;
  });
}

function cleanItems(items = {}) {
  return Object.fromEntries(
    Object.entries(items ?? {})
      .map(([key, quantity]) => [canonicalProductKey(key), Number(quantity)])
      .filter(([key, quantity]) => key && Number.isFinite(quantity) && quantity > 0)
      .map(([key, quantity]) => [key, Math.floor(quantity)])
  );
}

function itemCount(items = {}) {
  return Object.values(items ?? {}).reduce((sum, quantity) => sum + quantity, 0);
}

function maxDateString(a, b) {
  if (!a) return b ?? "";
  if (!b) return a;
  return String(a).localeCompare(String(b)) >= 0 ? a : b;
}

function wrapPlans(bestPlan, alternativePlans = [], searchLimitReached = false) {
  return {
    ...bestPlan,
    bestPlan,
    alternativePlans,
    searchLimitReached
  };
}

function emptyResult(people = []) {
  return {
    totalPrice: 0,
    selectedCoupons: [],
    providedItems: {},
    fulfilledItems: {},
    extraItems: {},
    extraItemDetails: [],
    missingItems: {},
    missingRequirements: [],
    assignment: [],
    people
  };
}
