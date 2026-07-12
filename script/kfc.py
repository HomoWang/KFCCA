from __future__ import annotations

import json
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from gatherer.coupon import fetch_range_codes
from gatherer.history import read_history, update_history, write_history
from gatherer.izo import fetch_izo_codes, fetch_izo_coupon
from gatherer.official_api import (
    PRODUCT_LABELS,
    OfficialApiClient,
    is_free_coupon,
    merge_coupon_data,
    normalize_raw_items,
)

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
TAIPEI = timezone(timedelta(hours=8))


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

    # 對官方 API 的禮貌性節流：每個候選碼之間固定延遲（retry backoff 另計）。
    throttle_seconds = max(0.0, client.config.sleep_seconds)

    for index, code in enumerate(candidate_codes):
        if index and throttle_seconds:
            time.sleep(throttle_seconds)

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

    grace_days = parse_positive_int(os.environ.get("KFC_EXPIRED_GRACE_DAYS")) or 14
    coupons = prune_expired_coupons(coupons, datetime.now(TAIPEI).strftime("%Y-%m-%d"), grace_days)

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


def prune_expired_coupons(coupons: list[dict[str, Any]], today: str, grace_days: int) -> list[dict[str, Any]]:
    # 過期太久的券對使用者無意義，只讓資料檔無限膨脹；保留寬限期是為了前端「已過季」區塊。
    # endDate 缺漏的券保留（前端會標示 missing_dates）。
    cutoff = (date.fromisoformat(today) - timedelta(days=grace_days)).isoformat()
    kept = [coupon for coupon in coupons if not coupon.get("endDate") or str(coupon["endDate"]) >= cutoff]
    if len(kept) < len(coupons):
        logging.info("Pruned %s coupon(s) that expired more than %s days ago.", len(coupons) - len(kept), grace_days)
    return kept


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


if __name__ == "__main__":
    raise SystemExit(main())
