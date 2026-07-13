import { canonicalProductKey, productCategoryKey, productLabel } from "./productCatalog.js";
import { isCouponCurrentlyAvailable } from "./couponParser.js";
import { canonicalizeItems, normalizeProductName } from "./productNormalizer.js";

export const DEFAULT_MAX_COMBO_VARIANTS = 48;

export function couponToOffer(coupon = {}) {
  const code = String(coupon.code ?? "").trim();
  return normalizeOffer({
    ...coupon,
    id: coupon.id ?? (code ? `coupon:${code}` : ""),
    kind: "coupon",
    code,
    title: coupon.title ?? code
  });
}

export function couponsToOffers(coupons = []) {
  return coupons.map(couponToOffer);
}

export function menuProductToOffer(product = {}) {
  if (!product.isSingleItem) return null;

  const fcode = String(product.fcode ?? "").trim();
  return normalizeOffer({
    id: fcode ? `alacarte:${fcode}` : "",
    kind: "alacarte",
    fcode,
    title: product.name ?? fcode,
    price: product.minPrice,
    items: menuBaseItems(product),
    startDate: product.startDate,
    endDate: product.endDate,
    mealPeriods: product.mealPeriods,
    soldOut: product.soldOut
  });
}

export function menuProductToOffers(product = {}, { maxComboVariants = DEFAULT_MAX_COMBO_VARIANTS } = {}) {
  const single = menuProductToOffer(product);
  if (single) return Object.keys(single.items).length ? [single] : [];
  return comboProductToOffers(product, { maxComboVariants });
}

export function menuProductsToOffers(products = [], options = {}) {
  return products.flatMap((product) => menuProductToOffers(product, options));
}

export function buildOfferPool({ coupons = [], menuProducts = [], maxComboVariants = DEFAULT_MAX_COMBO_VARIANTS } = {}) {
  return [...couponsToOffers(coupons), ...menuProductsToOffers(menuProducts, { maxComboVariants })];
}

export function resolveNativeComboOffers(offers = [], requirements = []) {
  const coverageDimensions = choiceCoverageDimensions(requirements);
  return offers.flatMap((offer) => {
    if (offer.expansionMode !== "native" || !offer.comboProduct || !Array.isArray(offer.choiceGroups)) {
      return [offer];
    }

    const states = offer.choiceGroups.reduce((current, group, groupIndex) => {
      const next = current.flatMap((state) => group.options.map((option, optionIndex) => ({
        optionIndices: [...state.optionIndices, optionIndex],
        items: addChoiceToItems(state.items, group, option),
        extra: state.extra + choiceExtra(group, option)
      })));
      return pruneChoiceStates(next, coverageDimensions, groupIndex);
    }, [{ optionIndices: [], items: menuBaseItems(offer.comboProduct), extra: 0 }]);

    return states
      .map((state) => buildComboOffer(offer.comboProduct, offer.choiceGroups, state.optionIndices, {
        fallback: false,
        variantCount: offer.theoreticalVariantCount
      }))
      .filter((candidate) => Object.keys(candidate.items).length)
      .map((candidate) => ({ ...candidate, expansionMode: "native", nativeChoiceSearch: true }));
  });
}

export function filterOffersByMealPeriod(offers = [], mealPeriod) {
  if (!mealPeriod) return [...offers];
  const selectedPeriod = String(mealPeriod);
  return offers.filter((offer) => !offer.mealPeriods?.length || offer.mealPeriods.includes(selectedPeriod));
}

export function normalizeOffer(offer = {}) {
  const kind = offer.kind ?? (offer.code ? "coupon" : "alacarte");
  const id = String(offer.id ?? "").trim();
  const price = offer.price === null || offer.price === undefined || offer.price === ""
    ? Number.NaN
    : Number(offer.price);
  const items = canonicalizeItems(offer.items);

  return {
    ...offer,
    id,
    kind,
    title: offer.title ?? offer.name ?? offer.code ?? offer.fcode ?? id,
    price,
    unitPrice: price,
    items,
    mealPeriods: Array.isArray(offer.mealPeriods) ? offer.mealPeriods.map(String) : undefined,
    displayItems: Array.isArray(offer.displayItems) && offer.displayItems.length
      ? offer.displayItems.map((item) => {
          const productKey = canonicalProductKey(item.productKey ?? item.key);
          return {
            productKey,
            label: item.label ?? productLabel(productKey),
            quantity: Number(item.quantity) || 1
          };
        })
      : itemObjectToDetails(items)
  };
}

export function isOfferCurrentlyAvailable(offer, now = new Date()) {
  return (
    Boolean(offer?.id) &&
    Number.isFinite(Number(offer.price)) &&
    Number(offer.price) >= 0 &&
    offer.soldOut !== true &&
    isCouponCurrentlyAvailable(offer, now)
  );
}

function comboProductToOffers(product, { maxComboVariants: _maxComboVariants }) {
  if (product.isSingleItem) return [];
  const fcode = String(product.fcode ?? "").trim();
  if (!fcode) return [];

  const groups = Array.isArray(product.choiceGroups)
    ? product.choiceGroups.filter((group) => Array.isArray(group.options) && group.options.length)
    : [];
  const variantCount = groups.reduce((count, group) => count * group.options.length, 1);
  if (groups.length) {
    const cheapest = groups.map((group) => cheapestOptionIndex(group.options));
    const template = buildComboOffer(product, groups, cheapest, { fallback: false, variantCount });
    return [normalizeOffer({
      ...template,
      id: `combo:${fcode}:native`,
      items: menuBaseItems(product),
      displayItems: undefined,
      comboProduct: product,
      choiceGroups: groups,
      selectedChoices: [],
      choiceSelections: [],
      variantLabel: "",
      expansionMode: "native",
      nativeChoiceSearch: true,
      theoreticalVariantCount: variantCount
    })];
  }
  const fixed = buildComboOffer(product, groups, [], { fallback: false, variantCount });
  return Object.keys(fixed.items).length ? [fixed] : [];
}

function addChoiceToItems(sourceItems, group, option) {
  const items = { ...sourceItems };
  const count = Math.max(1, Math.floor(Number(group.count) || 1));
  const unitQuantity = Math.max(1, Math.floor(Number(option.quantity) || 1));
  const isNoItem = option.isNoItem === true || String(option.name ?? "").trim().startsWith("不要");
  const productKey = canonicalProductKey(option.productKey) ?? normalizeProductName(option.name);
  if (productKey && !isNoItem) addItemQuantity(items, productKey, count * unitQuantity);
  return items;
}

function choiceExtra(group, option) {
  const count = Math.max(1, Math.floor(Number(group.count) || 1));
  return count * (Number(option.extra) || 0);
}

function choiceCoverageDimensions(requirements) {
  const exact = new Map();
  const broad = new Map();
  for (const requirement of requirements) {
    const target = requirement.type === "exact" ? exact : broad;
    const key = requirement.type === "exact" ? requirement.productKey : requirement.category;
    target.set(key, (target.get(key) ?? 0) + (Number(requirement.quantity) || 0));
  }
  return [
    ...[...exact].map(([key, quantity]) => ({ type: "exact", key, quantity })),
    ...[...broad].map(([key, quantity]) => ({
      type: "broad",
      key,
      quantity: quantity + [...exact].reduce((sum, [productKey, exactQuantity]) =>
        sum + (productCategoryKey(productKey) === key ? exactQuantity : 0), 0)
    }))
  ];
}

function pruneChoiceStates(states, coverageDimensions, groupIndex) {
  const bestByCoverage = new Map();
  for (const state of states) {
    const signature = coverageDimensions.map((dimension) => {
      const quantity = dimension.type === "exact"
        ? Number(state.items[dimension.key] ?? 0)
        : Object.entries(state.items).reduce((sum, [productKey, itemQuantity]) =>
            sum + (productCategoryKey(productKey) === dimension.key ? Number(itemQuantity) : 0), 0);
      return Math.min(dimension.quantity, quantity);
    }).join(",");
    const existing = bestByCoverage.get(signature);
    const stateKey = state.optionIndices.join(".");
    const existingKey = existing?.optionIndices.join(".") ?? "";
    const itemCount = Object.values(state.items).reduce((sum, quantity) => sum + Number(quantity), 0);
    const existingItemCount = existing
      ? Object.values(existing.items).reduce((sum, quantity) => sum + Number(quantity), 0)
      : Number.POSITIVE_INFINITY;
    if (!existing || state.extra < existing.extra ||
      (state.extra === existing.extra && itemCount < existingItemCount) ||
      (state.extra === existing.extra && itemCount === existingItemCount && stateKey < existingKey)) {
      bestByCoverage.set(signature, state);
    }
  }
  return [...bestByCoverage.values()].map((state) => ({ ...state, groupIndex }));
}

function buildComboOffer(product, groups, optionIndices, { fallback, variantCount }) {
  const items = menuBaseItems(product);
  const selectedChoices = [];
  const minimumChoiceExtra = groups.reduce((sum, group) => {
    const count = Math.max(1, Math.floor(Number(group.count) || 1));
    const cheapest = Math.min(...group.options.map((option) => Number(option.extra) || 0));
    return sum + count * cheapest;
  }, 0);
  const minimumPrice = Number.isFinite(Number(product.minPrice))
    ? Number(product.minPrice)
    : (Number(product.basePrice) || 0) + minimumChoiceExtra;
  let selectedChoiceExtra = 0;

  groups.forEach((group, groupIndex) => {
    const optionIndex = optionIndices[groupIndex];
    const option = group.options[optionIndex];
    const count = Math.max(1, Math.floor(Number(group.count) || 1));
    const unitQuantity = Math.max(1, Math.floor(Number(option.quantity) || 1));
    const quantity = count * unitQuantity;
    const extra = count * (Number(option.extra) || 0);
    const isNoItem = option.isNoItem === true || String(option.name ?? "").trim().startsWith("不需附");
    const productKey = canonicalProductKey(option.productKey) ?? normalizeProductName(option.name);
    selectedChoiceExtra += extra;
    if (productKey && !isNoItem) addItemQuantity(items, productKey, quantity);
    selectedChoices.push({
      groupIndex,
      optionIndex,
      groupCount: count,
      name: option.name ?? option.productKey ?? `選項 ${optionIndex + 1}`,
      productKey: isNoItem ? null : productKey,
      unitQuantity,
      quantity,
      unitExtra: Number(option.extra) || 0,
      extra,
      extraSubtotal: extra,
      isNoItem
    });
  });

  const fcode = String(product.fcode);
  const variantKey = optionIndices.length
    ? optionIndices.map((optionIndex, groupIndex) => `g${groupIndex}o${optionIndex}`).join(".")
    : "fixed";
  const price = minimumPrice + selectedChoiceExtra - minimumChoiceExtra;
  const variantLabel = selectedChoices
    .map((choice) => `${choice.name}${choice.groupCount > 1 ? ` ×${choice.groupCount}` : ""}`)
    .join("／");
  return normalizeOffer({
    id: `combo:${fcode}:${variantKey}`,
    kind: "combo",
    fcode,
    title: product.name ?? fcode,
    price,
    items,
    basePrice: product.basePrice,
    minPrice: product.minPrice,
    startDate: product.startDate,
    endDate: product.endDate,
    mealPeriods: product.mealPeriods,
    soldOut: product.soldOut,
    unknownItems: product.unknownItems,
    selectedChoices,
    choiceSelections: selectedChoices,
    variantLabel,
    variantFallback: fallback,
    variantCount,
    expansionMode: fallback ? "cheapest-only" : "full",
    theoreticalVariantCount: variantCount
  });
}

function cheapestOptionIndex(options) {
  return options.reduce((bestIndex, option, optionIndex) => {
    const best = options[bestIndex];
    const priceDifference = Number(option.extra ?? 0) - Number(best.extra ?? 0);
    return priceDifference < 0 ? optionIndex : bestIndex;
  }, 0);
}

function addItemQuantity(items, key, quantity) {
  items[key] = (Number(items[key]) || 0) + quantity;
}

function menuBaseItems(product) {
  const items = { ...(product.fixedItems ?? {}) };
  const choiceKeys = new Set((product.choiceGroups ?? [])
    .flatMap((group) => group.options ?? [])
    .map((option) => canonicalProductKey(option.productKey) ?? normalizeProductName(option.name))
    .filter(Boolean));

  const nameParts = String(product.name ?? "").split(/[+＋]/);
  const inferredItems = {};
  for (const namePart of nameParts) {
    const quantity = inferNameQuantity(namePart);
    const productKey = normalizeProductName(namePart);
    if (!productKey) continue;
    addItemQuantity(inferredItems, productKey, quantity);
  }

  for (const [productKey, quantity] of Object.entries(inferredItems)) {
    if (productKey === "combo" || choiceKeys.has(productKey)) continue;
    if (items[productKey]) {
      items[productKey] = Math.max(Number(items[productKey]) || 0, quantity);
      continue;
    }
    const category = productCategoryKey(productKey);
    const hasSameCategoryItem = category && Object.keys(items)
      .some((existingKey) => productCategoryKey(existingKey) === category);
    if (nameParts.length === 1 && hasSameCategoryItem) continue;
    addItemQuantity(items, productKey, quantity);
  }
  return items;
}

function inferNameQuantity(name) {
  const buyGet = String(name).match(/買\s*(\d+)\s*送\s*(\d+)/);
  if (buyGet) return Number(buyGet[1]) + Number(buyGet[2]);
  const count = String(name).match(/(\d+)\s*(?:塊|入|顆|份|杯)/);
  return count ? Number(count[1]) : 1;
}

function itemObjectToDetails(items = {}) {
  return Object.entries(items).map(([productKey, quantity]) => ({
    productKey,
    label: productLabel(productKey),
    quantity
  }));
}
