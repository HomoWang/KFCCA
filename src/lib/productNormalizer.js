import {
  canonicalProductKey,
  catalogOptions,
  categoryProducts,
  productCategories,
  productCategoryKey,
  PRODUCT_CATALOG,
  productLabel
} from "./productCatalog.js";

const RULES = productCategories.flatMap((category) =>
  category.products.map((product) => ({
    key: product.key,
    patterns: product.aliases ?? [product.label]
  }))
);
const FUZZY_RULES = [...RULES].sort((a, b) => longestPatternLength(b) - longestPatternLength(a));
const IGNORED_ITEM_RE = /(餐具|紙袋|刀叉|手套|湯匙|叉子|吸管|環保)/;

export { catalogOptions, PRODUCT_CATALOG, productLabel };

export function normalizeProductName(name = "") {
  const normalized = normalizeText(name);
  if (!normalized) return null;

  if (/(冰淇淋|冰心)/.test(normalized) && /(蛋塔|蛋撻)/.test(normalized)) {
    return "egg_tart_ice_cream";
  }

  const exact = RULES.find((rule) => rule.patterns.some((pattern) => normalized === normalizeText(pattern)));
  if (exact) return exact.key;

  const fuzzy = FUZZY_RULES.find((rule) => rule.patterns.some((pattern) => normalized.includes(normalizeText(pattern))));
  return fuzzy?.key ?? null;
}

export function normalizeRawItems(rawItems = []) {
  const items = {};
  const unknownItems = [];

  for (const raw of rawItems) {
    const name = raw?.name ?? "";
    const quantity = (Number(raw?.quantity ?? 1) || 1) * inferQuantityMultiplier(name);
    if (shouldIgnoreItem(name)) continue;
    const key = normalizeProductName(name);

    if (!key) {
      unknownItems.push({ name, quantity });
      continue;
    }

    items[key] = (items[key] ?? 0) + quantity;
  }

  return { items, unknownItems };
}

export function canonicalizeItems(items = {}) {
  const canonical = {};
  for (const [key, quantity] of Object.entries(items ?? {})) {
    const canonicalKey = canonicalProductKey(key);
    const value = Number(quantity);
    if (!canonicalKey || !Number.isFinite(value) || value <= 0) continue;
    canonical[canonicalKey] = (canonical[canonicalKey] ?? 0) + Math.floor(value);
  }
  return canonical;
}

export function expandItemAliases(items = {}) {
  const canonical = canonicalizeItems(items);
  const expanded = { ...canonical };
  for (const category of productCategories) {
    const childTotal = categoryProducts(category.key).reduce((sum, product) => sum + Number(canonical[product.key] ?? 0), 0);
    if (childTotal > 0) expanded[category.key] = Math.max(Number(expanded[category.key] ?? 0), childTotal);
  }
  return expanded;
}

export function aliasParentsForItem(key) {
  const categoryKey = productCategoryKey(key);
  return categoryKey ? [categoryKey] : [];
}

function inferQuantityMultiplier(name = "") {
  const text = String(name).trim();
  const prefix = text.match(/^(\d+)\s*(?:入|塊|顆|杯)/);
  if (prefix) return Number(prefix[1]);
  const nuggets = text.match(/雞塊\s*(\d+)\s*塊/);
  return nuggets ? Number(nuggets[1]) : 1;
}

function shouldIgnoreItem(name = "") {
  return IGNORED_ITEM_RE.test(String(name));
}

function normalizeText(value = "") {
  return String(value).trim().replace(/\s+/g, "");
}

function longestPatternLength(rule) {
  return Math.max(...rule.patterns.map((pattern) => normalizeText(pattern).length));
}
