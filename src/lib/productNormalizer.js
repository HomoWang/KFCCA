export const PRODUCT_CATALOG = {
  egg_tart: { label: "蛋塔", category: "甜點" },
  fries: { label: "小薯", category: "配餐" },
  medium_fries: { label: "中薯", category: "配餐" },
  large_fries: { label: "大薯", category: "配餐" },
  nugget: { label: "雞塊", category: "炸雞" },
  fried_chicken: { label: "炸雞", category: "炸雞" },
  sichuan_fried_chicken: { label: "青花椒炸雞", category: "炸雞" },
  zinger_burger: { label: "卡啦雞腿堡", category: "漢堡" },
  peanut_zinger_burger: { label: "花生熔岩雞腿堡", category: "漢堡" },
  sichuan_zinger_burger: { label: "青花椒雞腿堡", category: "漢堡" },
  crispy_chicken_burger: { label: "脆雞堡", category: "漢堡" },
  new_orleans_burger: { label: "紐奧良烤雞腿堡", category: "漢堡" },
  shrimp_burger: { label: "蝦堡", category: "漢堡" },
  paper_chicken: { label: "紙包雞", category: "主餐" },
  drink: { label: "飲料", category: "飲料" },
  small_drink: { label: "小飲", category: "飲料" },
  medium_drink: { label: "中飲", category: "飲料" },
  popcorn_chicken: { label: "雞米花", category: "炸雞" },
  biscuit: { label: "比司吉", category: "配餐" },
  rice: { label: "雞汁風味飯", category: "配餐" },
  soup: { label: "濃湯", category: "配餐" },
  sweet_potato_ball: { label: "地瓜球", category: "配餐" },
  combo: { label: "套餐", category: "套餐" }
};

const RULES = [
  { key: "peanut_zinger_burger", patterns: ["花生熔岩雞腿堡", "花生熔岩咔啦雞腿堡", "花生脆雞堡"] },
  { key: "sichuan_zinger_burger", patterns: ["青花椒卡啦雞腿堡", "青花椒咔啦雞腿堡", "青花椒香麻咔啦雞腿堡"] },
  { key: "new_orleans_burger", patterns: ["紐奧良烤雞腿堡"] },
  { key: "shrimp_burger", patterns: ["蝦堡", "魚子海陸蝦堡"] },
  { key: "crispy_chicken_burger", patterns: ["脆雞堡", "原味脆雞堡"] },
  { key: "zinger_burger", patterns: ["卡啦雞腿堡", "咔啦雞腿堡", "卡拉雞腿堡"] },
  { key: "paper_chicken", patterns: ["紙包雞", "義式香草紙包雞"] },
  { key: "sichuan_fried_chicken", patterns: ["青花椒炸雞", "青花椒香麻脆雞"] },
  { key: "fried_chicken", patterns: ["炸雞", "咔啦脆雞", "卡啦脆雞", "脆雞", "無骨雞腿"] },
  { key: "egg_tart", patterns: ["蛋塔", "蛋撻", "奶皇流心蛋撻", "原味蛋撻", "葡式蛋撻"] },
  { key: "small_drink", patterns: ["小飲", "小杯", "(小)"] },
  { key: "medium_drink", patterns: ["中飲", "中杯", "(中)"] },
  { key: "drink", patterns: ["飲料", "可樂", "百事", "七喜", "冰紅茶", "紅茶", "綠茶", "檸檬風味紅茶", "無糖綠茶", "瓶裝"] },
  { key: "large_fries", patterns: ["大薯"] },
  { key: "medium_fries", patterns: ["中薯"] },
  { key: "fries", patterns: ["小薯", "薯條"] },
  { key: "nugget", patterns: ["雞塊", "上校雞塊", "蝦塊"] },
  { key: "popcorn_chicken", patterns: ["雞米花", "爆米花雞"] },
  { key: "biscuit", patterns: ["比司吉", "蜂蜜奶油餅乾"] },
  { key: "rice", patterns: ["雞汁風味飯"] },
  { key: "soup", patterns: ["小濃湯", "濃湯"] },
  { key: "sweet_potato_ball", patterns: ["地瓜球"] },
  { key: "combo", patterns: ["套餐", "XL", "桶"] }
];

const IGNORED_ITEM_RE = /(醬|餐具|紙袋)/;
const ITEM_ALIASES = {
  zinger_burger: ["peanut_zinger_burger", "sichuan_zinger_burger"],
  fried_chicken: ["sichuan_fried_chicken"],
  drink: ["small_drink", "medium_drink"],
  fries: ["medium_fries", "large_fries"]
};

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

export function expandItemAliases(items = {}) {
  const expanded = { ...items };
  for (const [parent, children] of Object.entries(ITEM_ALIASES)) {
    const childTotal = children.reduce((sum, child) => sum + Number(items[child] ?? 0), 0);
    if (childTotal > 0) expanded[parent] = Math.max(Number(expanded[parent] ?? 0), childTotal);
  }
  return expanded;
}

export function catalogOptions() {
  return Object.entries(PRODUCT_CATALOG).map(([key, value]) => ({ key, ...value }));
}
