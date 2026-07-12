from __future__ import annotations

import json
import logging
from pathlib import Path

from gatherer.menu import fetch_menu_snapshot
from gatherer.official_api import OfficialApiClient

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    client = OfficialApiClient()
    try:
        snapshot = fetch_menu_snapshot(client)
    except Exception as exc:
        logging.warning("Menu snapshot failed: %s", exc)
        snapshot = None

    products = (snapshot or {}).get("products") or []
    if not products:
        # 菜單抓取失敗不覆寫舊檔，行為與 coupon 流程的保留策略一致。
        logging.warning("No menu products fetched; existing public/menu.json is preserved.")
        return 0

    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "menu.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    singles = sum(1 for product in products if product["isSingleItem"])
    logging.info("Wrote %s menu products (%s a la carte, %s combos).", len(products), singles, len(products) - singles)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
