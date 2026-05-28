export const productCategories = [
  {
    key: "burger",
    label: "漢堡",
    broadOptionLabel: "任一漢堡",
    products: [
      { key: "zinger_burger", label: "卡啦雞腿堡", aliases: ["卡啦雞腿堡", "咔啦雞腿堡", "卡拉雞腿堡"] },
      { key: "peanut_zinger_burger", label: "花生熔岩雞腿堡", aliases: ["花生熔岩雞腿堡", "花生熔岩咔啦雞腿堡", "花生脆雞堡"] },
      { key: "sichuan_zinger_burger", label: "青花椒雞腿堡", aliases: ["青花椒卡啦雞腿堡", "青花椒咔啦雞腿堡", "青花椒香麻咔啦雞腿堡"] },
      { key: "crispy_chicken_burger", label: "脆雞堡", aliases: ["脆雞堡", "原味脆雞堡"] },
      { key: "new_orleans_burger", label: "紐奧良烤雞腿堡", aliases: ["紐奧良烤雞腿堡"] },
      { key: "shrimp_burger", label: "蝦堡", aliases: ["蝦堡", "魚子海陸蝦堡", "黃金魚子海陸堡"] },
      { key: "pork_burger", label: "起司豬肉堡", aliases: ["起司豬肉堡", "豬肉堡"] },
      { key: "peanut_cheese_egg_burger", label: "花生起司蛋堡", aliases: ["花生起司蛋堡"] }
    ]
  },
  {
    key: "fried_chicken",
    label: "炸雞",
    broadOptionLabel: "任一炸雞",
    products: [
      { key: "crispy_chicken_spicy", label: "卡拉脆雞-辣", aliases: ["卡拉脆雞-辣", "卡啦脆雞-辣", "咔啦脆雞-辣", "卡拉脆雞(辣)", "卡啦脆雞(辣)", "咔啦脆雞(辣)", "咔啦脆雞辣味", "辣味卡拉脆雞"] },
      { key: "crispy_chicken_original", label: "卡拉脆雞-原味", aliases: ["卡拉脆雞-原味", "卡啦脆雞-原味", "咔啦脆雞-原味", "卡拉脆雞(原味)", "卡啦脆雞(原味)", "咔啦脆雞(原味)", "咔啦脆雞原味", "原味卡拉脆雞"] },
      { key: "sichuan_fried_chicken", label: "青花椒炸雞", aliases: ["青花椒炸雞", "青花椒卡拉脆雞", "青花椒香麻脆雞"] },
      { key: "original_fried_chicken", label: "原味炸雞", aliases: ["原味炸雞"] },
      { key: "spicy_fried_chicken", label: "辣味炸雞", aliases: ["辣味炸雞"] },
      { key: "fried_chicken_piece", label: "炸雞", aliases: ["炸雞", "咔啦脆雞", "卡啦脆雞", "脆雞", "無骨雞腿"] }
    ]
  },
  {
    key: "fries",
    label: "薯條",
    broadOptionLabel: "任一薯條",
    products: [
      { key: "small_fries", label: "小薯", aliases: ["小薯", "小份薯條", "香酥脆薯(小)"] },
      { key: "medium_fries", label: "中薯", aliases: ["中薯", "中份薯條", "香酥脆薯(中)"] },
      { key: "large_fries", label: "大薯", aliases: ["大薯", "大份薯條", "薯條(大)", "香酥脆薯(大)"] }
    ]
  },
  {
    key: "egg_tart",
    label: "蛋塔",
    broadOptionLabel: "任一蛋塔",
    products: [
      { key: "egg_tart", label: "蛋塔", aliases: ["蛋塔", "蛋撻", "原味蛋塔", "原味蛋撻", "葡式蛋撻", "奶皇流心蛋撻"] }
    ]
  },
  {
    key: "ice_cream",
    label: "冰淇淋",
    broadOptionLabel: "任一冰淇淋",
    products: [
      { key: "egg_tart_ice_cream", label: "蛋塔風味冰淇淋", aliases: ["蛋塔風味冰淇淋", "蛋撻風味冰淇淋", "冰心蛋塔冰淇淋", "冰心蛋撻風味冰淇淋"] },
      { key: "strawberry_cheese_mochi", label: "草苺起司冰淇淋大福", aliases: ["草苺起司冰淇淋大福", "草莓起司冰淇淋大福", "冰淇淋大福"] }
    ]
  },
  {
    key: "drink",
    label: "飲料",
    broadOptionLabel: "任一飲料",
    products: [
      { key: "pepsi", label: "百事可樂", aliases: ["百事可樂", "可樂"] },
      { key: "iced_tea", label: "冰紅茶", aliases: ["冰紅茶", "紅茶", "檸檬風味紅茶"] },
      { key: "seven_up", label: "七喜", aliases: ["七喜"] },
      { key: "green_tea", label: "綠茶", aliases: ["綠茶", "無糖綠茶"] },
      { key: "milk_tea", label: "冰奶茶", aliases: ["經典冰奶茶", "冰奶茶"] },
      { key: "apple_juice", label: "蘋果汁", aliases: ["蘋果汁"] },
      { key: "bottled_drink", label: "瓶裝飲料", aliases: ["瓶裝"] },
      { key: "small_drink", label: "小飲", aliases: ["小飲", "小杯飲料", "小杯"] },
      { key: "medium_drink", label: "中飲", aliases: ["中飲", "中杯飲料", "中杯"] },
      { key: "drink", label: "飲料", aliases: ["飲料"] }
    ]
  },
  {
    key: "snack",
    label: "點心",
    broadOptionLabel: "任一點心",
    products: [
      { key: "chicken_nuggets", label: "雞塊", aliases: ["雞塊", "上校雞塊", "蝦塊"] },
      { key: "popcorn_chicken", label: "雞米花", aliases: ["雞米花", "爆米花雞"] },
      { key: "hash_brown", label: "薯餅", aliases: ["薯餅"] },
      { key: "onion_rings", label: "洋蔥圈", aliases: ["洋蔥圈"] },
      { key: "biscuit", label: "比司吉", aliases: ["比司吉", "蜂蜜奶油餅乾"] },
      { key: "sweet_potato_ball", label: "地瓜球", aliases: ["地瓜球"] },
      { key: "qq_ball", label: "雙色轉轉QQ球", aliases: ["雙色轉轉QQ球"] },
      { key: "cod_ring", label: "鱈魚圈圈", aliases: ["鱈魚圈圈", "鱈魚圈"] },
      { key: "soup", label: "濃湯", aliases: ["小濃湯", "濃湯"] }
    ]
  },
  {
    key: "side",
    label: "配餐",
    broadOptionLabel: "任一配餐",
    hiddenInCalculator: true,
    products: [
      { key: "rice", label: "雞汁風味飯", aliases: ["雞汁風味飯"] },
      { key: "paper_chicken", label: "紙包雞", aliases: ["紙包雞", "義式香草紙包雞"] },
      { key: "omelet_flatbread", label: "總匯歐姆蛋燒餅", aliases: ["總匯歐姆蛋燒餅"] },
      { key: "sauce", label: "醬料", aliases: ["糖醋醬", "南洋酸甜醬", "青花椒香麻沾醬", "醬料", "沾醬"] },
      { key: "combo", label: "套餐", aliases: ["套餐", "XL", "桶"] }
    ]
  }
];

export const productCategoryMap = Object.fromEntries(productCategories.map((category) => [category.key, category]));

export const PRODUCT_CATALOG = Object.fromEntries(
  productCategories.flatMap((category) => [
    [category.key, { label: category.broadOptionLabel, category: category.label, type: "broad" }],
    ...category.products.map((product) => [
      product.key,
      { ...product, category: category.label, categoryKey: category.key, type: "exact" }
    ])
  ])
);

export const legacyProductKeyMap = {
  fries: "small_fries",
  nugget: "chicken_nuggets",
  fried_chicken: "fried_chicken_piece",
  spicy_crispy_chicken: "crispy_chicken_spicy",
  original_crispy_chicken: "crispy_chicken_original"
};

export function canonicalProductKey(key) {
  return legacyProductKeyMap[key] ?? key;
}

export function productLabel(key) {
  return PRODUCT_CATALOG[canonicalProductKey(key)]?.label ?? key;
}

export function productCategoryKey(key) {
  return PRODUCT_CATALOG[canonicalProductKey(key)]?.categoryKey ?? null;
}

export function broadLabel(categoryKey) {
  return productCategoryMap[categoryKey]?.broadOptionLabel ?? productLabel(categoryKey);
}

export function isCategoryKey(key) {
  return Boolean(productCategoryMap[key]);
}

export function categoryProducts(categoryKey) {
  return productCategoryMap[categoryKey]?.products ?? [];
}

export function calculatorCategories() {
  return productCategories.filter((category) => !category.hiddenInCalculator);
}

export function catalogOptions() {
  return Object.entries(PRODUCT_CATALOG).map(([key, value]) => ({ key, ...value }));
}
