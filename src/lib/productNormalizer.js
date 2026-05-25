export const PRODUCT_CATALOG = {
  zinger_burger: { label: "卡啦雞腿堡", category: "漢堡" },
  burger: { label: "漢堡", category: "漢堡" },
  fried_chicken: { label: "炸雞", category: "炸雞" },
  egg_tart: { label: "蛋塔", category: "甜點" },
  drink: { label: "飲料", category: "飲料" },
  fries: { label: "薯條", category: "配餐" },
  nugget: { label: "雞塊", category: "炸雞" },
  popcorn_chicken: { label: "雞米花", category: "炸雞" },
  biscuit: { label: "比司吉", category: "配餐" },
  rice: { label: "雞汁風味飯", category: "配餐" },
  soup: { label: "濃湯", category: "配餐" },
  sweet_potato_ball: { label: "地瓜球", category: "配餐" },
  combo: { label: "套餐", category: "套餐" }
};

const RULES = [
  { key: "zinger_burger", patterns: ["卡啦雞腿堡", "咔啦雞腿堡", "青花椒卡啦雞腿堡", "雙層卡啦雞腿堡"] },
  { key: "fried_chicken", patterns: ["炸雞", "青花椒炸雞", "咔啦脆雞", "卡啦脆雞"] },
  { key: "egg_tart", patterns: ["蛋塔", "蛋撻", "奶皇流心蛋撻", "冰心蛋塔"] },
  { key: "drink", patterns: ["小飲", "中飲", "大飲", "可樂", "百事", "七喜", "冰紅茶", "綠茶", "紅茶", "茶", "瓶裝"] },
  { key: "fries", patterns: ["小薯", "中薯", "大薯", "薯條"] },
  { key: "nugget", patterns: ["雞塊", "上校雞塊", "蝦塊"] },
  { key: "popcorn_chicken", patterns: ["雞米花", "爆米花雞"] },
  { key: "biscuit", patterns: ["比司吉", "蜂蜜奶油餅乾"] },
  { key: "rice", patterns: ["雞汁風味飯"] },
  { key: "soup", patterns: ["小濃湯", "濃湯"] },
  { key: "sweet_potato_ball", patterns: ["地瓜球"] },
  { key: "burger", patterns: ["漢堡", "蝦堡", "脆雞堡", "烤雞腿堡", "花生熔岩"] },
  { key: "combo", patterns: ["套餐", "XL", "桶"] }
];
const IGNORED_ITEM_RE = /(醬|餐具|紙袋)/;

export function normalizeProductName(name = "") {
  const normalized = String(name).trim().replace(/\s+/g, "");
  if (!normalized) return null;
  const exact = RULES.find((rule) => rule.patterns.some((pattern) => normalized === pattern));
  if (exact) return exact.key;
  const fuzzy = RULES.find((rule) => rule.patterns.some((pattern) => normalized.includes(pattern)));
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

function inferQuantityMultiplier(name = "") {
  const text = String(name).trim();
  const match = text.match(/^(\d+)\s*(?:入|塊|顆)/) ?? text.match(/雞塊\s*(\d+)\s*塊/);
  return match ? Number(match[1]) : 1;
}

function shouldIgnoreItem(name = "") {
  return IGNORED_ITEM_RE.test(String(name));
}

export function productLabel(key) {
  return PRODUCT_CATALOG[key]?.label ?? key;
}

export function catalogOptions() {
  return Object.entries(PRODUCT_CATALOG).map(([key, value]) => ({ key, ...value }));
}
