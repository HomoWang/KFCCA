from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


def read_history(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logging.warning("Existing product-history.json is not valid JSON.")
        return {}


def write_history(path: Path, history: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(history, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def update_history(
    existing: dict[str, Any],
    coupons: list[dict[str, Any]],
    today: str,
    updated_at: str | None = None,
) -> dict[str, Any]:
    """更新「首次出現日」歷史。

    冷啟動：首次建立（既有無 baselineDate）時，baselineDate 設為 today，
    本批所有 code/product 的 firstSeen 一律記為 today（== baselineDate）。
    前端 isNew 判定要求 firstSeen 晚於 baselineDate，故導入當天不會出現假新品。
    之後的執行只為「新出現」的 code/product 補上當天日期，既有日期永不覆寫。
    """
    existing = existing if isinstance(existing, dict) else {}
    baseline = existing.get("baselineDate") or today
    codes = dict(existing.get("codes") or {})
    products = dict(existing.get("products") or {})

    for coupon in coupons:
        code = str(coupon.get("code", "")).strip()
        if code and code not in codes:
            codes[code] = today
        items = coupon.get("items") if isinstance(coupon.get("items"), dict) else {}
        for product_key in items:
            key = str(product_key).strip()
            if key and key not in products:
                products[key] = today

    return {
        "baselineDate": baseline,
        "updatedAt": updated_at or today,
        "codes": codes,
        "products": products,
    }
