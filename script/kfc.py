from __future__ import annotations

import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

from gatherer.coupon import fetch_range_codes
from gatherer.izo import fetch_izo_codes
from gatherer.official_api import OfficialApiClient

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
TAIPEI = timezone(timedelta(hours=8))


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    source_map: dict[str, set[str]] = {}

    izo_codes = fetch_izo_codes()
    logging.info("Fetched %s candidate codes from kfc.izo.tw.", len(izo_codes))
    for code in izo_codes:
        source_map.setdefault(code, set()).add("kfc.izo.tw")

    range_codes = fetch_range_codes()
    logging.info("Generated %s candidate codes from ranges.", len(range_codes))
    for code in range_codes:
        source_map.setdefault(code, set()).add("range_scan")

    candidate_codes = sorted(source_map)
    logging.info("Verifying %s unique candidate codes.", len(candidate_codes))

    client = OfficialApiClient()
    coupons = []
    if not client.config.url:
        logging.warning("KFC_OFFICIAL_API_URL is not set; official verification is skipped for this run.")
    else:
        for code in candidate_codes:
            try:
                coupon = client.verify_coupon(code)
            except Exception:
                logging.exception("Unexpected error while verifying %s; continue.", code)
                continue
            if not coupon:
                continue
            coupon["sourceCandidates"] = sorted(source_map.get(code, []))
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
        },
        "coupons": sorted(coupons, key=lambda coupon: coupon.get("code", "")),
    }
    write_data(data)
    logging.info("Wrote %s verified coupons.", len(coupons))
    return 0


def read_existing_data() -> dict:
    path = PUBLIC / "coupon.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logging.warning("Existing coupon.json is not valid JSON.")
        return {}


def write_data(data: dict) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    json_text = json.dumps(data, ensure_ascii=False, indent=2)
    (PUBLIC / "coupon.json").write_text(json_text + "\n", encoding="utf-8")
    (PUBLIC / "coupon.js").write_text("window.KFC_COUPON_DATA = " + json_text + ";\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
