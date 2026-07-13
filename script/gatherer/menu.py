from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import Any

from .official_api import (
    PRODUCT_CATEGORIES,
    TAIPEI,
    OfficialApiClient,
    normalize_name,
    normalize_product_name,
    parse_date,
    parse_price,
    should_ignore_item,
    today_slash,
)

# 菜單名稱的數量常寫在字尾（「咔啦脆雞2塊」「上校雞塊(4塊)」），與優惠券的字首慣例不同。
_COUNT_RE = re.compile(r"(\d+)\s*(?:塊|入|顆|份|杯)")
_BUY_GET_RE = re.compile(r"買\s*(\d+)\s*送\s*(\d+)")

GET_QUERY_MENU_URL = "https://olo-api.kfcclub.com.tw/menu/v1/GetQueryMenu"
GET_QUERY_FOOD_URL = "https://olo-api.kfcclub.com.tw/menu/v1/GetQueryFood"

# 官方 API 的四個用餐時段：1=早餐、2=午餐、3=下午茶、4=晚餐（依 checkCouponProduct 的探測慣例）。
MEAL_PERIODS = ("1", "2", "3", "4")


def fetch_menu_snapshot(client: OfficialApiClient, meal_periods: tuple[str, ...] = MEAL_PERIODS) -> dict[str, Any]:
    """掃描各時段菜單 → 分類商品列表 → 逐商品家族抓變體明細（單點/套餐）。

    GetQueryFoodDetail 以「家族 fcode」查詢會回傳該商品的全部變體
    （例如查單點漢堡會一併回傳 A/B/C/XL 套餐），因此明細只需對家族查一次。
    """
    throttle = max(0.0, client.config.sleep_seconds)
    families: dict[str, dict[str, Any]] = {}

    for period in meal_periods:
        menus = _fetch_menu_list(client, period)
        time.sleep(throttle)
        for menu in menus:
            menu_id = str(menu.get("MenuID") or "")
            menu_title = str(menu.get("Title") or "")
            if not menu_id:
                continue
            foods = _fetch_food_list(client, period, menu_id)
            time.sleep(throttle)
            for item in foods:
                fcode = str(item.get("Fcode") or "")
                if not fcode:
                    continue
                family = families.setdefault(fcode, {"name": str(item.get("Name") or ""), "mealPeriods": set(), "menus": {}})
                family["mealPeriods"].add(period)
                family["menus"][menu_id] = menu_title

    products: dict[str, dict[str, Any]] = {}
    for fcode, family in families.items():
        period = sorted(family["mealPeriods"])[0]
        menu_id = sorted(family["menus"])[0]
        variants = _fetch_food_detail(client, period, menu_id, fcode)
        time.sleep(throttle)
        for variant in variants:
            parsed = parse_food_variant(variant)
            if not parsed["fcode"]:
                continue
            existing = products.get(parsed["fcode"])
            if existing:
                existing["mealPeriods"] = sorted(set(existing["mealPeriods"]) | family["mealPeriods"])
                existing["menus"] = sorted(set(existing["menus"]) | set(family["menus"].values()))
                existing["familyFcodes"] = sorted(set(existing["familyFcodes"]) | {fcode})
            else:
                products[parsed["fcode"]] = {
                    **parsed,
                    "mealPeriods": sorted(family["mealPeriods"]),
                    "menus": sorted(set(family["menus"].values())),
                    "familyFcodes": [fcode],
                }

    return {
        "lastUpdated": datetime.now(TAIPEI).isoformat(timespec="seconds"),
        "shopCode": client.config.shop_code,
        "orderType": "2",
        "source": {"endpoints": ["GetQueryMenu", "GetQueryFood", "GetQueryFoodDetail"]},
        "products": sorted(products.values(), key=lambda product: product["fcode"]),
    }


def parse_food_variant(variant: dict[str, Any]) -> dict[str, Any]:
    """把 FoodDetail 的一個變體攤平成 offer 形狀。

    價格語意（由實測驗證）：實付 = Original_Price + Σ(所選選項的 MListPrice)。
    必選 slot（MinCount>=1）只有一個選項時視為固定內容物；多個選項為 choice group；
    MinCount=0 的 slot 是加購，不列入 minPrice。
    """
    base = parse_price(variant.get("Original_Price"))
    fixed_items: dict[str, int] = {}
    unknown_items: list[dict[str, Any]] = []
    choice_groups: list[dict[str, Any]] = []
    addon_groups: list[dict[str, Any]] = []
    min_price = base

    for slot in variant.get("Details") or []:
        if not isinstance(slot, dict):
            continue
        mlist = [entry for entry in (slot.get("MList") or []) if isinstance(entry, dict)]
        if not mlist:
            continue
        min_count = parse_price(slot.get("MinCount"))
        # 餐具／環保選項（需要刀叉、需要湯匙…）不是食物，整個 slot 濾掉。
        options = [option for option in (_parse_option(entry) for entry in mlist) if not should_ignore_item(option["name"])]
        if not options:
            continue

        if min_count <= 0:
            addon_groups.append({"maxCount": parse_price(slot.get("MaxCount")), "options": options})
            continue

        min_price += min(option["extra"] for option in options) * min_count
        if len(options) == 1:
            option = options[0]
            quantity = min_count * option["quantity"]
            if option["isNoItem"]:
                continue
            if option["productKey"]:
                fixed_items[option["productKey"]] = fixed_items.get(option["productKey"], 0) + quantity
            else:
                unknown_items.append({"name": option["name"], "quantity": quantity})
        else:
            choice_groups.append({"count": min_count, "options": options})

    name = normalize_name(variant.get("Name", ""))
    # 主商品本身常不會列在 slots 裡；部分 API 變體甚至把單點誤標為非 single。
    # 以商品名補內容物，但若同品項已在固定／任選 slot 中就不重複計數。
    choice_keys = {
        option["productKey"]
        for group in choice_groups
        for option in group["options"]
        if option.get("productKey")
    }
    inferred_items = _infer_named_items(name)
    is_compound_name = len(re.split(r"[+＋]", name)) > 1
    for key, quantity in inferred_items.items():
        if key == "combo" or key in choice_keys:
            continue
        if key in fixed_items:
            fixed_items[key] = max(fixed_items[key], quantity)
            continue
        category = PRODUCT_CATEGORIES.get(key)
        has_same_category_item = category and any(
            PRODUCT_CATEGORIES.get(existing_key) == category for existing_key in fixed_items
        )
        if not is_compound_name and has_same_category_item:
            continue
        fixed_items[key] = quantity
    if not fixed_items and not choice_groups and not inferred_items:
        unknown_items.append({"name": name, "quantity": _infer_count(name)})

    return {
        "fcode": str(variant.get("Fcode") or ""),
        "name": name,
        "isSingleItem": bool(variant.get("isSingleItem")),
        "soldOut": bool(variant.get("SoldOut")),
        "basePrice": base,
        "minPrice": min_price,
        "startDate": parse_date(variant.get("StartDate")),
        "endDate": parse_date(variant.get("EndDate")),
        "fixedItems": fixed_items,
        "unknownItems": unknown_items,
        "choiceGroups": choice_groups,
        "addonGroups": addon_groups,
    }


def _parse_option(entry: dict[str, Any]) -> dict[str, Any]:
    name = normalize_name(entry.get("Name", ""))
    return {
        "name": name,
        "productKey": normalize_product_name(name.replace(" ", "")),
        "extra": parse_price(entry.get("MListPrice")),
        "quantity": _infer_count(name),
        "isNoItem": name.startswith("不需附"),
    }


def _infer_count(name: str) -> int:
    buy_get = _BUY_GET_RE.search(name)
    if buy_get:
        return int(buy_get.group(1)) + int(buy_get.group(2))
    match = _COUNT_RE.search(name)
    return int(match.group(1)) if match else 1


def _infer_named_items(name: str) -> dict[str, int]:
    items: dict[str, int] = {}
    for part in re.split(r"[+＋]", name):
        key = normalize_product_name(part.replace(" ", ""))
        if not key:
            continue
        items[key] = items.get(key, 0) + _infer_count(part)
    return items


def _fetch_menu_list(client: OfficialApiClient, period: str) -> list[dict[str, Any]]:
    payload = client._post(
        GET_QUERY_MENU_URL,
        {
            "shopcode": client.config.shop_code,
            "mealperiod": period,
            "ordertype": "2",
            "ismember": "0",
            "parentid": "0",
            "orderdate": today_slash(),
        },
        "GetQueryMenu",
    )
    data = _payload_data(payload)
    menus = data.get("Menu") if isinstance(data, dict) else None
    return [menu for menu in (menus or []) if isinstance(menu, dict)]


def _fetch_food_list(client: OfficialApiClient, period: str, menu_id: str) -> list[dict[str, Any]]:
    payload = client._post(
        GET_QUERY_FOOD_URL,
        {
            "shopcode": client.config.shop_code,
            "mealperiod": period,
            "ordertype": "2",
            "ismember": "0",
            "menuid": menu_id,
            "parentid": "0",
            "orderdate": today_slash(),
        },
        "GetQueryFood",
    )
    data = _payload_data(payload)
    groups = data.get("Foods") if isinstance(data, dict) else None
    items: list[dict[str, Any]] = []
    for group in groups or []:
        if not isinstance(group, dict):
            continue
        items.extend(entry for entry in (group.get("Details") or []) if isinstance(entry, dict))
    return items


def _fetch_food_detail(client: OfficialApiClient, period: str, menu_id: str, fcode: str) -> list[dict[str, Any]]:
    payload = client._post(
        client.config.query_food_detail_url,
        {
            "shopcode": client.config.shop_code,
            "fcode": fcode,
            "menuid": menu_id,
            "mealperiod": period,
            "ordertype": "2",
            "orderdate": today_slash(),
        },
        "GetQueryFoodDetail",
    )
    data = _payload_data(payload)
    detail = data.get("FoodDetail") if isinstance(data, dict) else None
    if isinstance(detail, dict):
        return [detail]
    if isinstance(detail, list):
        return [variant for variant in detail if isinstance(variant, dict)]
    logging.warning("No FoodDetail for %s (period %s).", fcode, period)
    return []


def _payload_data(payload: Any) -> Any:
    if not isinstance(payload, dict) or payload.get("Success") is not True:
        return {}
    return payload.get("Data") or {}
