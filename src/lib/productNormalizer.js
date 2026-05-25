export const PRODUCT_CATALOG = {
  zinger_burger: { label: "咔啦雞腿堡", category: "漢堡" },
  burger: { label: "漢堡", category: "漢堡" },
  fried_chicken: { label: "炸雞", category: "炸雞" },
  egg_tart: { label: "蛋撻", category: "蛋塔" },
  drink: { label: "飲料", category: "飲料" },
  fries: { label: "薯條", category: "薯條" },
  combo: { label: "套餐", category: "套餐" },
  nugget: { label: "雞塊", category: "炸雞" },
  popcorn_chicken: { label: "雞米花", category: "炸雞" },
  biscuit: { label: "比司吉", category: "套餐" }
};

const RULES = [
  { key: "zinger_burger", patterns: ["咔啦雞腿堡", "卡拉雞腿堡", "辣味咔啦", "咔啦堡", "卡啦堡"] },
  { key: "fried_chicken", patterns: ["炸雞", "雞腿", "雞翅", "雞塊(塊肉)", "上校雞塊肉"] },
  { key: "egg_tart", patterns: ["蛋撻", "蛋塔", "原味蛋撻", "葡式蛋撻"] },
  { key: "drink", patterns: ["百事", "可樂", "七喜", "汽水", "紅茶", "無糖綠茶", "飲料", "冰茶"] },
  { key: "fries", patterns: ["薯條", "香酥脆薯"] },
  { key: "nugget", patterns: ["雞塊", "上校雞塊"] },
  { key: "popcorn_chicken", patterns: ["雞米花", "爆米花雞"] },
  { key: "biscuit", patterns: ["比司吉", "蜂蜜奶油"] },
  { key: "burger", patterns: ["漢堡", "堡"] },
  { key: "combo", patterns: ["套餐", "XL", "超值餐"] }
];

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
    const quantity = Number(raw?.quantity ?? 1) || 1;
    const key = normalizeProductName(name);

    if (!key) {
      unknownItems.push({ name, quantity });
      continue;
    }

    items[key] = (items[key] ?? 0) + quantity;
  }

  return { items, unknownItems };
}

export function productLabel(key) {
  return PRODUCT_CATALOG[key]?.label ?? key;
}

export function catalogOptions() {
  return Object.entries(PRODUCT_CATALOG).map(([key, value]) => ({ key, ...value }));
}
