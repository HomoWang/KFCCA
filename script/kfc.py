from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from gatherer.coupon import fetch_range_codes
from gatherer.izo import fetch_izo_codes, fetch_izo_coupon
from gatherer.official_api import OfficialApiClient, is_free_coupon, merge_coupon_data, normalize_raw_items

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
    log_quality(data["quality"])
    logging.info("Wrote %s verified coupons.", len(coupons))
    return 0


def finalize_coupon(coupon: dict[str, Any]) -> dict[str, Any]:
    raw_items = coupon.get("rawItems") if isinstance(coupon.get("rawItems"), list) else []
    items = coupon.get("items") if isinstance(coupon.get("items"), dict) else {}
    unknown_items = coupon.get("unknownItems") if isinstance(coupon.get("unknownItems"), list) else []

    if raw_items and not items:
        items, unknown_items = normalize_raw_items(raw_items)

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
        "unknownItems": unknown_items,
        "startDate": coupon.get("startDate"),
        "endDate": coupon.get("endDate"),
        "available": coupon.get("available", True) is not False,
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
