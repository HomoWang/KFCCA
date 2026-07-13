import {
  broadLabel,
  canonicalProductKey,
  categoryProducts,
  isCategoryKey,
  productCategoryKey,
  productLabel
} from "./productCatalog.js";
import { expandItemAliases } from "./productNormalizer.js";
import { couponToOffer, isOfferCurrentlyAvailable, normalizeOffer, resolveNativeComboOffers } from "./offers.js";

const DEFAULT_OPTIONS = {
  maxCandidates: 36,
  extraBuffer: 2,
  maxStates: 250000,
  alternativeLimit: 5,
  similarLimit: 5,
  minSimilarity: 0.5
};

export function optimizeCoupons(requirementInput, coupons, options = {}) {
  const result = optimizeOffers(requirementInput, coupons.map(couponToOffer), options);
  if (!result.selectedOffers.length && result.missingRequirements.length) {
    result.similarCoupons = findSimilarCoupons(requirementInput, coupons, options);
  }
  return result;
}

export function optimizeOffers(requirementInput, offers, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = opts.now ?? new Date();
  const people = normalizePeopleRequirements(requirementInput);
  const requirements = people.flatMap((person) => person.requirements);
  if (!requirements.length) return wrapPlans(emptyResult(people), [], false);

  const activeOffers = resolveNativeComboOffers(offers, requirements)
    .map(normalizeOffer)
    .filter((offer) => isOfferCurrentlyAvailable(offer, now))
    .filter((offer) => Object.keys(offer.items).length && requirements.some((requirement) => offerCanSatisfy(offer, requirement)));

  const missingBeforeSearch = requirements.filter((requirement) => !activeOffers.some((offer) => offerCanSatisfy(offer, requirement)));
  const searchableRequirements = requirements.filter((requirement) => !missingBeforeSearch.includes(requirement));
  if (!searchableRequirements.length) {
    return wrapPlans({
      ...emptyResult(people),
      missingRequirements: missingBeforeSearch,
      missingItems: requirementsToItemObject(missingBeforeSearch)
    }, [], false);
  }

  const candidates = selectCandidateOffers(activeOffers, searchableRequirements, opts)
    .map((offer) => ({ offer, maxQuantity: estimateMaxQuantity(offer, searchableRequirements, opts) }))
    .filter((entry) => entry.maxQuantity > 0);

  // 無解需求永遠會留在 missingRequirements 裡，「完整方案」= 除了它們以外沒有其他缺口。
  const unsatisfiableIds = new Set(missingBeforeSearch.map((requirement) => requirement.id));

  const plans = [];
  const planLimit = Math.max(1, opts.alternativeLimit + 1);
  seedFeasiblePlans(plans, candidates.map((candidate) => candidate.offer), searchableRequirements, people, unsatisfiableIds, planLimit);
  let visited = 0;

  function dfs(index, selected, totalPrice, offerCount) {
    visited += 1;
    if (visited > opts.maxStates) return;
    const priceCeiling = plans.length >= planLimit ? plans[plans.length - 1].totalPrice : Number.POSITIVE_INFINITY;
    if (totalPrice > priceCeiling) return;

    const evaluated = evaluatePlan(selected, people, totalPrice, offerCount);
    if (evaluated.missingRequirements.every((requirement) => unsatisfiableIds.has(requirement.id))) {
      if (hasRedundantOfferCopy(selected, people, unsatisfiableIds)) return;
      rememberPlan(plans, evaluated, planLimit);
      return;
    }

    if (index >= candidates.length) return;
    const additionalCost = optimisticAdditionalCost(evaluated.missingRequirements, candidates, index, unsatisfiableIds);
    if (totalPrice + additionalCost > priceCeiling) return;

    const { offer, maxQuantity } = candidates[index];
    for (let quantity = maxQuantity; quantity >= 0; quantity -= 1) {
      const nextSelected = quantity ? [...selected, { offer, quantity }] : selected;
      dfs(index + 1, nextSelected, totalPrice + offer.price * quantity, offerCount + quantity);
    }
  }

  dfs(0, [], 0, 0);

  const rankedPlans = plans.sort(comparePlans);
  const best = rankedPlans[0] ?? null;
  if (best) {
    const alternatives = rankedPlans
      .slice(1)
      .slice(0, opts.alternativeLimit)
      .map((plan, index) => ({ ...plan, rank: index + 2, priceDelta: plan.totalPrice - best.totalPrice }));
    return wrapPlans({ ...best, rank: 1, priceDelta: 0 }, alternatives, visited > opts.maxStates);
  }

  const empty = {
    ...emptyResult(people),
    missingRequirements: requirements,
    missingItems: requirementsToItemObject(requirements),
    searchLimitReached: visited > opts.maxStates
  };
  return wrapPlans(empty, [], visited > opts.maxStates);
}

export function findSimilarCoupons(requirementInput, coupons, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = opts.now ?? new Date();
  const requirements = normalizePeopleRequirements(requirementInput).flatMap((person) => person.requirements);
  if (!requirements.length) return [];

  return coupons
    .map(couponToOffer)
    .filter((offer) => isOfferCurrentlyAvailable(offer, now))
    .map((offer) => {
      const matchedRequirements = requirements.filter((requirement) => offerCanSatisfy(offer, requirement));
      const matchedCount = matchedRequirements.reduce((sum, requirement) => sum + Math.min(requirement.quantity, matchingQuantity(offer.items, requirement)), 0);
      const totalDemand = requirements.reduce((sum, requirement) => sum + requirement.quantity, 0);
      return {
        offer,
        matchedRequirements,
        matchedItems: Object.fromEntries(matchedRequirements.map((requirement) => [requirementKey(requirement), Math.min(requirement.quantity, matchingQuantity(offer.items, requirement))])),
        similarity: totalDemand ? matchedCount / totalDemand : 0
      };
    })
    .filter((entry) => entry.similarity >= opts.minSimilarity)
    .sort((a, b) =>
      b.similarity - a.similarity ||
      a.offer.price - b.offer.price ||
      String(b.offer.endDate ?? "").localeCompare(String(a.offer.endDate ?? ""))
    )
    .slice(0, opts.similarLimit)
    .map((entry) => ({
      code: entry.offer.code,
      title: entry.offer.title,
      price: entry.offer.price,
      endDate: entry.offer.endDate,
      items: entry.offer.items,
      displayItems: entry.offer.displayItems,
      matchedItems: entry.matchedItems,
      similarity: entry.similarity
    }));
}

export function allocateToPeople(peopleRequirements, providedItems) {
  const people = normalizePeopleRequirements({ people: peopleRequirements });
  const manualOffer = normalizeOffer({ id: "manual", kind: "alacarte", title: "manual", price: 0, items: providedItems });
  const plan = evaluatePlan([{ offer: manualOffer, quantity: 1 }], people, 0, 0);
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

function evaluatePlan(selected, people, totalPrice, offerCount) {
  const itemUnits = buildItemUnits(selected);
  const assignment = assignRequirements(people, itemUnits);
  const missingRequirements = assignment.missingRequirements;
  const extraItems = summarizeUnits(assignment.remainingUnits);
  const providedItems = summarizeUnits(itemUnits);
  const fulfilledItems = summarizeAssignedItems(assignment.assignment);
  const selectedOffers = buildSelectedOffers(selected);
  const selectedCoupons = selectedOffers.filter((offer) => offer.kind === "coupon");

  return {
    totalPrice,
    selectedOffers,
    selectedCoupons,
    providedItems,
    fulfilledItems,
    extraItems,
    extraItemDetails: itemObjectToDetails(extraItems),
    missingItems: requirementsToItemObject(missingRequirements),
    missingRequirements,
    assignment: assignment.assignment,
    offerCount,
    couponCount: selectedCoupons.reduce((sum, coupon) => sum + coupon.quantity, 0),
    latestEndDate: selectedOffers.reduce((latest, offer) => maxDateString(latest, offer.endDate), "")
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
        sourceId: unit.sourceId,
        sourceKind: unit.sourceKind,
        sourceLabel: unit.sourceLabel,
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
  if (requirement.type !== "exact" && isCategoryKey(rawKey)) {
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

function offerCanSatisfy(offer, requirement) {
  return matchingQuantity(offer.items, requirement) > 0;
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
  for (const { offer, quantity } of selected) {
    for (let copy = 0; copy < quantity; copy += 1) {
      for (const [productKey, itemQuantity] of Object.entries(offer.items)) {
        units.push({
          productKey,
          quantity: itemQuantity,
          sourceId: offer.id,
          sourceKind: offer.kind,
          sourceLabel: offer.kind === "coupon"
            ? offer.code
            : `${offer.title}${offer.variantLabel ? `（${offer.variantLabel}）` : ""}`,
          couponCode: offer.kind === "coupon" ? offer.code : undefined
        });
      }
    }
  }
  return units;
}

function buildSelectedOffers(selected) {
  return selected
    .filter((entry) => entry.quantity > 0)
    .map(({ offer, quantity }) => ({
      id: offer.id,
      kind: offer.kind,
      code: offer.code,
      fcode: offer.fcode,
      title: offer.title,
      quantity,
      price: offer.price,
      unitPrice: offer.price,
      subtotal: offer.price * quantity,
      items: offer.items,
      startDate: offer.startDate,
      endDate: offer.endDate,
      mealPeriods: offer.mealPeriods,
      selectedChoices: offer.selectedChoices,
      choiceSelections: offer.choiceSelections,
      variantLabel: offer.variantLabel,
      variantFallback: offer.variantFallback,
      variantCount: offer.variantCount,
      expansionMode: offer.expansionMode,
      theoreticalVariantCount: offer.theoreticalVariantCount,
      displayItems: offer.displayItems
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function selectCandidateOffers(activeOffers, requirements, opts) {
  const byEfficiency = [...activeOffers].sort((a, b) => scoreOffer(a, requirements) - scoreOffer(b, requirements));
  const byCoverage = [...activeOffers].sort((a, b) =>
    coverageKinds(b, requirements) - coverageKinds(a, requirements) ||
    coveredUnits(b, requirements) - coveredUnits(a, requirements) ||
    extraUnits(a, requirements) - extraUnits(b, requirements) ||
    a.price - b.price
  );
  const requiredBaseline = uniqueOffers(requirements.flatMap((requirement) =>
    byEfficiency
      .filter((offer) => offerCanSatisfy(offer, requirement))
      .slice(0, 1)
  ));
  const perRequirement = requirements.flatMap((requirement) =>
    byEfficiency.filter((offer) => offerCanSatisfy(offer, requirement)).slice(0, 6)
  );
  const coverageBaseline = byCoverage.slice(0, Math.max(1, Math.ceil(opts.maxCandidates * 0.6)));
  const essential = uniqueOffers([...requiredBaseline, ...coverageBaseline]);
  const optional = uniqueOffers([
    ...perRequirement,
    ...byCoverage.slice(0, Math.ceil(opts.maxCandidates * 0.6)),
    ...byEfficiency.slice(0, Math.ceil(opts.maxCandidates * 0.6))
  ]).filter((offer) => !essential.some((required) => required.id === offer.id));
  const optionalLimit = Math.max(0, opts.maxCandidates - essential.length);

  // 每項需求至少保留一個可重複購買的供應來源；需求種類超過上限時，
  // 正確性優先於 maxCandidates 的軟上限，避免把唯一單點兜底截掉。
  return [...essential, ...optional.slice(0, optionalLimit)];
}

function seedFeasiblePlans(plans, offers, requirements, people, unsatisfiableIds, planLimit) {
  for (const preferredOffer of [null, ...offers]) {
    const selected = minimizeSelection(
      buildGreedySelection(offers, requirements, preferredOffer),
      people,
      unsatisfiableIds,
      preferredOffer?.id
    );
    const totalPrice = selected.reduce((sum, entry) => sum + entry.offer.price * entry.quantity, 0);
    const offerCount = selected.reduce((sum, entry) => sum + entry.quantity, 0);
    const evaluated = evaluatePlan(selected, people, totalPrice, offerCount);
    if (evaluated.missingRequirements.every((requirement) => unsatisfiableIds.has(requirement.id))) {
      rememberPlan(plans, evaluated, planLimit);
    }
  }
}

function buildGreedySelection(offers, requirements, preferredOffer) {
  const selected = new Map();
  if (preferredOffer) selected.set(preferredOffer.id, { offer: preferredOffer, quantity: 1 });

  for (const requirement of requirements) {
    const provider = offers
      .filter((offer) => offerCanSatisfy(offer, requirement))
      .sort((a, b) =>
        a.price / matchingQuantity(a.items, requirement) - b.price / matchingQuantity(b.items, requirement) ||
        a.price - b.price ||
        String(a.id).localeCompare(String(b.id))
      )[0];
    if (!provider) continue;

    const quantity = Math.ceil(requirement.quantity / matchingQuantity(provider.items, requirement));
    const entry = selected.get(provider.id) ?? { offer: provider, quantity: 0 };
    entry.quantity += quantity;
    selected.set(provider.id, entry);
  }

  return [...selected.values()];
}

function minimizeSelection(selected, people, unsatisfiableIds, preferredId) {
  let minimized = selected.map((entry) => ({ ...entry }));
  const offerIds = selected
    .map((entry) => entry.offer.id)
    .sort((a, b) => Number(a === preferredId) - Number(b === preferredId));
  for (const offerId of offerIds) {
    while (true) {
      const entry = minimized.find((candidate) => candidate.offer.id === offerId);
      if (!entry || entry.quantity <= 0) break;
      const reduced = minimized
        .map((candidate) => candidate.offer.id === offerId ? { ...candidate, quantity: candidate.quantity - 1 } : candidate)
        .filter((candidate) => candidate.quantity > 0);
      const missing = evaluatePlan(reduced, people, 0, 0).missingRequirements;
      if (!missing.every((requirement) => unsatisfiableIds.has(requirement.id))) break;
      minimized = reduced;
    }
  }
  return minimized;
}

function optimisticAdditionalCost(missingRequirements, candidates, index, unsatisfiableIds) {
  let lowerBound = 0;
  for (const requirement of missingRequirements) {
    if (unsatisfiableIds.has(requirement.id)) continue;
    let cheapest = Number.POSITIVE_INFINITY;
    for (let candidateIndex = index; candidateIndex < candidates.length; candidateIndex += 1) {
      const { offer } = candidates[candidateIndex];
      const quantity = matchingQuantity(offer.items, requirement);
      if (quantity <= 0) continue;
      // Fractional unit price is an optimistic lower bound. Rounding each offer up
      // would be unsafe here because a cheaper combination may split the demand.
      cheapest = Math.min(cheapest, requirement.quantity * offer.price / quantity);
    }
    lowerBound = Math.max(lowerBound, cheapest);
  }
  return lowerBound;
}

function estimateMaxQuantity(offer, requirements, opts) {
  const relevant = requirements.filter((requirement) => offerCanSatisfy(offer, requirement));
  if (!relevant.length) return 0;

  const exactDemand = new Map();
  const broadDemand = new Map();
  for (const requirement of relevant) {
    const demand = requirement.type === "exact" ? exactDemand : broadDemand;
    const key = requirement.type === "exact" ? requirement.productKey : requirement.category;
    demand.set(key, (demand.get(key) ?? 0) + requirement.quantity);
  }

  let copies = 0;
  for (const [productKey, quantity] of exactDemand) {
    copies = Math.max(copies, Math.ceil(quantity / Number(offer.items[productKey])));
  }
  for (const [category, quantity] of broadDemand) {
    const exactQuantity = [...exactDemand]
      .filter(([productKey]) => productCategoryKey(productKey) === category)
      .reduce((sum, [, demandQuantity]) => sum + demandQuantity, 0);
    const unitsPerCopy = Object.entries(offer.items)
      .filter(([productKey]) => productCategoryKey(productKey) === category)
      .reduce((sum, [, itemQuantity]) => sum + itemQuantity, 0);
    copies = Math.max(copies, Math.ceil((quantity + exactQuantity) / unitsPerCopy));
  }

  return copies + opts.extraBuffer;
}

function hasRedundantOfferCopy(selected, people, unsatisfiableIds) {
  return selected.some((entry) => {
    if (entry.quantity <= 1) return false;
    const reduced = selected
      .map((candidate) => candidate === entry ? { ...candidate, quantity: candidate.quantity - 1 } : candidate)
      .filter((candidate) => candidate.quantity > 0);
    return evaluatePlan(reduced, people, 0, 0).missingRequirements.every((requirement) => unsatisfiableIds.has(requirement.id));
  });
}

function scoreOffer(offer, requirements) {
  const relevantUnits = requirements.reduce((sum, requirement) => sum + Math.min(requirement.quantity, matchingQuantity(offer.items, requirement)), 0);
  return offer.price / Math.max(1, relevantUnits);
}

function coverageKinds(offer, requirements) {
  return requirements.filter((requirement) => offerCanSatisfy(offer, requirement)).length;
}

function coveredUnits(offer, requirements) {
  return requirements.reduce((sum, requirement) => sum + Math.min(requirement.quantity, matchingQuantity(offer.items, requirement)), 0);
}

function extraUnits(offer, requirements) {
  const relevant = new Set(requirements.flatMap((requirement) =>
    requirement.type === "exact" ? [requirement.productKey] : categoryProducts(requirement.category).map((product) => product.key)
  ));
  return Object.entries(offer.items).reduce((sum, [key, quantity]) => sum + (relevant.has(key) ? 0 : quantity), 0);
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
    a.offerCount - b.offerCount ||
    String(b.latestEndDate).localeCompare(String(a.latestEndDate))
  );
}

function planKey(plan) {
  return plan.selectedOffers.map((offer) => `${offer.id}:${offer.quantity}`).join("|");
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
  const existing = items.find((item) => item.productKey === next.productKey && item.sourceId === next.sourceId);
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

function uniqueOffers(offers) {
  const seen = new Set();
  return offers.filter((offer) => {
    if (seen.has(offer.id)) return false;
    seen.add(offer.id);
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
    selectedOffers: [],
    selectedCoupons: [],
    providedItems: {},
    fulfilledItems: {},
    extraItems: {},
    extraItemDetails: [],
    missingItems: {},
    missingRequirements: [],
    assignment: [],
    offerCount: 0,
    couponCount: 0,
    people
  };
}
