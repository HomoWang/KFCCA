from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from gatherer.coupon import fetch_range_codes
from gatherer.history import read_history, update_history, write_history
from gatherer.izo import fetch_izo_codes, fetch_izo_coupon
from gatherer.official_api import OfficialApiClient, is_free_coupon, merge_coupon_data, normalize_raw_items

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
TAIPEI = timezone(timedelta(hours=8))
PRODUCT_LABELS = {
    "zinger_burger": "卡啦雞腿堡",
    "peanut_zinger_burger": "花生熔岩雞腿堡",
    "sichuan_zinger_burger": "青花椒雞腿堡",
    "crispy_chicken_burger": "脆雞堡",
    "new_orleans_burger": "紐奧良烤雞腿堡",
    "shrimp_burger": "蝦堡",
    "pork_burger": "起司豬肉堡",
    "peanut_cheese_egg_burger": "花生起司蛋堡",
    "crispy_chicken_spicy": "卡拉脆雞-辣",
    "crispy_chicken_original": "卡拉脆雞-原味",
    "sichuan_fried_chicken": "青花椒炸雞",
    "original_fried_chicken": "原味炸雞",
    "spicy_fried_chicken": "辣味炸雞",
    "fried_chicken_piece": "炸雞",
    "small_fries": "小薯",
    "medium_fries": "中薯",
    "large_fries": "大薯",
    "egg_tart": "蛋塔",
    "egg_tart_ice_cream": "蛋塔風味冰淇淋",
    "ice_cream_mochi": "冰淇淋大福",
    "drink": "飲料",
    "small_drink": "小飲",
    "medium_drink": "中飲",
    "pepsi": "百事可樂",
    "iced_tea": "冰紅茶",
    "seven_up": "七喜",
    "green_tea": "綠茶",
    "milk_tea": "冰奶茶",
    "apple_juice": "蘋果汁",
    "bottled_drink": "瓶裝飲料",
    "chicken_nuggets": "雞塊",
    "popcorn_chicken": "雞米花",
    "hash_brown": "薯餅",
    "onion_rings": "洋蔥圈",
    "biscuit": "比司吉",
    "sweet_potato_ball": "地瓜球",
    "qq_ball": "雙色轉轉QQ球",
    "strawberry_cheese_mochi": "草苺起司冰淇淋大福",
    "cod_ring": "鱈魚圈圈",
    "soup": "濃湯",
    "rice": "雞汁風味飯",
    "paper_chicken": "紙包雞",
    "omelet_flatbread": "總匯歐姆蛋燒餅",
    "sauce": "醬料",
    "combo": "套餐",
}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    source_map: dict[str, set[str]] = {}
    failures: list[dict[str, str]] = []

    izo_codes = fetch_izo_codes()
    logging.info("Candidate code count from kfc.izo.tw: %s", len(izo_codes))
    for code in izo_codes:
        source_map.setdefault(code, set()).add("kfc.izo.tw")

    range_codes = fetch_range_codes()
    logging.info("Candidate code count from ranges: %s", len(range_codes))
    for code in range_codes:
        source_map.setdefault(code, set()).add("range_scan")

    candidate_codes = sorted(source_map)
    max_candidates = parse_positive_int(os.environ.get("KFC_MAX_CANDIDATES"))
    if max_candidates:
        candidate_codes = candidate_codes[-max_candidates:]
        logging.info("KFC_MAX_CANDIDATES is set; limiting this run to %s highest candidate codes.", max_candidates)
    logging.info("Candidate code count total: %s", len(candidate_codes))

    client = OfficialApiClient()
    coupons: list[dict[str, Any]] = []
    official_verified = 0

    for code in candidate_codes:
        verified = None
        try:
            verified = client.verify_coupon(code)
        except Exception as exc:
            logging.warning("Official verification raised for %s: %s", code, exc)

        if not verified:
            failures.append({"code": code, "reason": "official_verification_failed"})
            continue

        official_verified += 1
        parsed = fetch_izo_coupon(code) if "kfc.izo.tw" in source_map.get(code, set()) else None
        coupon = merge_coupon_data(verified, parsed or {})

        try:
            details = client.fetch_coupon_details(code, coupon.get("productCode"))
            coupon = merge_coupon_data(coupon, details)
        except Exception as exc:
            logging.warning("Official detail fetch raised for %s: %s", code, exc)

        coupon["sourceCandidates"] = sorted(source_map.get(code, []))
        coupon["available"] = coupon.get("available", True) is not False
        coupon = finalize_coupon(coupon)
        if coupon["parseStatus"] != "ok":
            failures.append({"code": code, "reason": ",".join(coupon["parseIssues"])})
        coupons.append(coupon)

    if not coupons:
        logging.warning("No coupons verified. Existing public data will be preserved when available.")
        existing = read_existing_data()
        if existing.get("coupons"):
            write_data(existing)
            return 0

    now = datetime.now(TAIPEI).isoformat(timespec="seconds")
    data = {
        "lastUpdated": now,
        "source": {
            "candidateSources": sorted({source for sources in source_map.values() for source in sources}),
            "verifiedBy": "official_api",
            "detailSources": ["kfc.izo.tw/coupons/{code}", "checkCouponProduct", "GetQueryFoodDetail"],
        },
        "quality": build_quality_stats(candidate_codes, coupons, official_verified, failures),
        "coupons": sorted(coupons, key=lambda coupon: coupon.get("code", "")),
    }
    write_data(data)
    update_product_history(coupons, now)
    log_quality(data["quality"])
    logging.info("Wrote %s verified coupons.", len(coupons))
    return 0


def update_product_history(coupons: list[dict[str, Any]], now: str) -> None:
    # 累積每個 code / productKey 的首次出現日，供前端標記「新登場」。失敗不可中斷主流程。
    try:
        history_path = PUBLIC / "product-history.json"
        history = read_history(history_path)
        history = update_history(history, coupons, now[:10], now)
        write_history(history_path, history)
        logging.info("Updated product history (%s codes, %s products).", len(history["codes"]), len(history["products"]))
    except Exception as exc:
        logging.warning("Updating product history failed: %s", exc)


def finalize_coupon(coupon: dict[str, Any]) -> dict[str, Any]:
    raw_items = coupon.get("rawItems") if isinstance(coupon.get("rawItems"), list) else []
    items = coupon.get("items") if isinstance(coupon.get("items"), dict) else {}
    unknown_items = coupon.get("unknownItems") if isinstance(coupon.get("unknownItems"), list) else []

    if raw_items:
        normalized_items, normalized_unknown_items = normalize_raw_items(raw_items)
        items = normalized_items or items
        unknown_items = normalized_unknown_items

    parse_issues: list[str] = []
    if int(coupon.get("price") or 0) == 0 and not is_free_coupon(coupon):
        parse_issues.append("zero_price")
    if not raw_items:
        parse_issues.append("missing_items")
    if not coupon.get("startDate") or not coupon.get("endDate"):
        parse_issues.append("missing_dates")

    parse_status = parse_issues[0] if parse_issues else "ok"
    return {
        "code": str(coupon.get("code", "")),
        "title": coupon.get("title") or f"優惠券 {coupon.get('code', '')}",
        "description": coupon.get("description") or "",
        "price": int(coupon.get("price") or 0),
        "rawItems": raw_items,
        "items": items,
        "displayItems": build_display_items(items),
        "unknownItems": unknown_items,
        "startDate": coupon.get("startDate"),
        "endDate": coupon.get("endDate"),
        "available": coupon.get("available", True) is not False,
        "deliveryAvailable": coupon.get("deliveryAvailable") if coupon.get("deliveryAvailable") is not None else coupon.get("available", True) is not False,
        "parseStatus": parse_status,
        "parseIssues": parse_issues,
        "sourceCandidates": coupon.get("sourceCandidates", []),
        "sourceUrl": coupon.get("sourceUrl"),
        "verifiedAt": coupon.get("verifiedAt") or datetime.now(TAIPEI).isoformat(timespec="seconds"),
    }


def build_quality_stats(
    candidate_codes: list[str],
    coupons: list[dict[str, Any]],
    official_verified: int,
    failures: list[dict[str, str]],
) -> dict[str, Any]:
    parsed_price = sum(1 for coupon in coupons if int(coupon.get("price") or 0) > 0 or is_free_coupon(coupon))
    parsed_items = sum(1 for coupon in coupons if coupon.get("rawItems"))
    parsed_failures = [failure for failure in failures if failure["reason"] != "official_verification_failed"]
    return {
        "candidateCount": len(candidate_codes),
        "officialVerifiedCount": official_verified,
        "parsedPriceCount": parsed_price,
        "parsedItemsCount": parsed_items,
        "parseFailureCount": len(parsed_failures),
        "firstFailures": parsed_failures[:5],
    }


def log_quality(quality: dict[str, Any]) -> None:
    logging.info("Candidate code count: %s", quality["candidateCount"])
    logging.info("Official verification success count: %s", quality["officialVerifiedCount"])
    logging.info("Parsed price success count: %s", quality["parsedPriceCount"])
    logging.info("Parsed items success count: %s", quality["parsedItemsCount"])
    logging.info("Parse failure count: %s", quality["parseFailureCount"])
    logging.info("First 5 parse failures: %s", quality["firstFailures"])


def merge_item_quantities(existing: dict[str, Any], normalized: dict[str, int]) -> dict[str, int]:
    merged = {str(key): int(value) for key, value in existing.items() if int(value or 0) > 0}
    for key, value in normalized.items():
        merged[str(key)] = int(value)
    return merged


def build_display_items(items: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"productKey": str(key), "label": PRODUCT_LABELS.get(str(key), str(key)), "quantity": int(value)}
        for key, value in items.items()
        if int(value or 0) > 0
    ]


def parse_positive_int(value: str | None) -> int | None:
    if not value:
        return None
    try:
        parsed = int(value)
    except ValueError:
        logging.warning("Ignoring invalid KFC_MAX_CANDIDATES value: %s", value)
        return None
    return parsed if parsed > 0 else None


def read_existing_data() -> dict[str, Any]:
    path = PUBLIC / "coupon.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logging.warning("Existing coupon.json is not valid JSON.")
        return {}


def write_data(data: dict[str, Any]) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    json_text = json.dumps(data, ensure_ascii=False, indent=2)
    (PUBLIC / "coupon.json").write_text(json_text + "\n", encoding="utf-8")
    (PUBLIC / "coupon.js").write_text("window.KFC_COUPON_DATA = " + json_text + ";\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
