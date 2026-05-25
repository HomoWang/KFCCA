from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any

TAIPEI = timezone(timedelta(hours=8))
QUANTITY_RE = re.compile(r"(?:x|X|＊|\*)\s*(\d+)|(\d+)\s*(?:份|個|入|顆|杯|塊|支)")


PRODUCT_RULES: list[tuple[str, list[str]]] = [
    ("zinger_burger", ["咔啦雞腿堡", "卡拉雞腿堡", "辣味咔啦", "咔啦堡", "卡啦堡"]),
    ("fried_chicken", ["炸雞", "雞腿", "雞翅", "雞塊(塊肉)", "上校雞塊肉"]),
    ("egg_tart", ["蛋撻", "蛋塔", "原味蛋撻", "葡式蛋撻"]),
    ("drink", ["百事", "可樂", "七喜", "汽水", "紅茶", "無糖綠茶", "飲料", "冰茶"]),
    ("fries", ["薯條", "香酥脆薯"]),
    ("nugget", ["雞塊", "上校雞塊"]),
    ("popcorn_chicken", ["雞米花", "爆米花雞"]),
    ("biscuit", ["比司吉", "蜂蜜奶油"]),
    ("burger", ["漢堡", "堡"]),
    ("combo", ["套餐", "XL", "超值餐"]),
]


@dataclass
class OfficialApiConfig:
    url: str | None
    method: str = "POST"
    timeout: int = 20
    retries: int = 2
    sleep_seconds: float = 0.8

    @classmethod
    def from_env(cls) -> "OfficialApiConfig":
        return cls(
            url=os.environ.get("KFC_OFFICIAL_API_URL"),
            method=os.environ.get("KFC_OFFICIAL_API_METHOD", "POST").upper(),
            timeout=int(os.environ.get("KFC_API_TIMEOUT", "20")),
            retries=int(os.environ.get("KFC_API_RETRIES", "2")),
            sleep_seconds=float(os.environ.get("KFC_API_SLEEP", "0.8")),
        )


class OfficialApiClient:
    def __init__(self, config: OfficialApiConfig | None = None) -> None:
        self.config = config or OfficialApiConfig.from_env()

    def verify_coupon(self, code: str) -> dict[str, Any] | None:
        if not self.config.url:
            logging.warning("KFC_OFFICIAL_API_URL is not set; skip official verification for %s.", code)
            return None

        for attempt in range(self.config.retries + 1):
            try:
                payload = self._request(code)
                coupon = self._normalize_response(code, payload)
                if coupon:
                    return coupon
                return None
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError, TypeError) as exc:
                logging.warning("Official API verification failed for %s (attempt %s): %s", code, attempt + 1, exc)
                if attempt < self.config.retries:
                    time.sleep(self.config.sleep_seconds * (attempt + 1))
            finally:
                time.sleep(self.config.sleep_seconds)
        return None

    def _request(self, code: str) -> Any:
        url = self.config.url or ""
        data = None
        if self.config.method == "GET":
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}couponNo={code}"
        else:
            data = json.dumps({"couponNo": code, "couponCode": code, "code": code}).encode("utf-8")

        request = urllib.request.Request(
            url,
            data=data,
            method=self.config.method,
            headers={
                "User-Agent": "KFCCa coupon updater",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
            text = response.read().decode("utf-8", errors="ignore")
        return json.loads(text)

    def _normalize_response(self, code: str, payload: Any) -> dict[str, Any] | None:
        data = extract_coupon_payload(payload)
        if not data or is_invalid_payload(data):
            logging.info("Coupon %s is invalid or unavailable.", code)
            return None

        title = first_value(data, ["title", "name", "couponName", "productName", "mealName"]) or f"優惠券 {code}"
        description = first_value(data, ["description", "desc", "memo", "content"]) or title
        price = parse_price(first_value(data, ["price", "salePrice", "amount", "couponPrice"]))
        start_date = parse_date(first_value(data, ["startDate", "startTime", "beginDate", "effectiveDate"]))
        end_date = parse_date(first_value(data, ["endDate", "endTime", "expireDate", "expiryDate"]))
        raw_items = extract_raw_items(data, title, description)
        items, unknown_items = normalize_raw_items(raw_items)
        now = datetime.now(TAIPEI).isoformat(timespec="seconds")

        return {
            "code": code,
            "title": title,
            "description": description,
            "price": price,
            "startDate": start_date,
            "endDate": end_date,
            "available": True,
            "items": items,
            "rawItems": raw_items,
            "unknownItems": unknown_items,
            "sourceCandidates": [],
            "verifiedAt": now,
        }


def extract_coupon_payload(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, list):
        return payload[0] if payload and isinstance(payload[0], dict) else None
    if not isinstance(payload, dict):
        return None
    for key in ("data", "result", "coupon", "couponData"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value[0]
    return payload


def is_invalid_payload(data: dict[str, Any]) -> bool:
    status = str(first_value(data, ["status", "resultCode", "code", "success", "isValid", "valid"])).lower()
    message = str(first_value(data, ["message", "msg", "error"]) or "")
    return status in {"false", "0", "invalid", "notfound", "404"} or "無效" in message or "不存在" in message


def first_value(data: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def parse_price(value: Any) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"\d+", str(value or "0").replace(",", ""))
    return int(match.group(0)) if match else 0


def parse_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value)
    match = re.search(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})", text)
    if not match:
        return text[:10] if re.match(r"20\d{2}-\d{2}-\d{2}", text) else None
    year, month, day = match.groups()
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def extract_raw_items(data: dict[str, Any], title: str, description: str) -> list[dict[str, Any]]:
    for key in ("items", "products", "details", "mealItems"):
        value = data.get(key)
        if isinstance(value, list):
            rows = []
            for item in value:
                if isinstance(item, dict):
                    name = first_value(item, ["name", "title", "productName", "itemName"])
                    if name:
                        rows.append({"name": str(name), "quantity": parse_price(first_value(item, ["quantity", "qty", "count"]) or 1) or 1})
                elif isinstance(item, str):
                    rows.extend(parse_items_from_text(item))
            if rows:
                return rows
    return parse_items_from_text(f"{title} {description}")


def parse_items_from_text(text: str) -> list[dict[str, Any]]:
    rows = []
    for part in re.split(r"[+＋、,，/／\n]", text):
        part = part.strip()
        if not part:
            continue
        match = QUANTITY_RE.search(part)
        quantity = int(next((group for group in (match.groups() if match else []) if group), "1"))
        name = QUANTITY_RE.sub("", part).strip() or part
        rows.append({"name": name, "quantity": quantity})
    return rows


def normalize_raw_items(raw_items: list[dict[str, Any]]) -> tuple[dict[str, int], list[dict[str, Any]]]:
    items: dict[str, int] = {}
    unknown: list[dict[str, Any]] = []
    for raw in raw_items:
        name = str(raw.get("name", "")).replace(" ", "")
        quantity = int(raw.get("quantity") or 1)
        key = normalize_product_name(name)
        if not key:
            unknown.append({"name": raw.get("name", ""), "quantity": quantity})
            continue
        items[key] = items.get(key, 0) + quantity
    return items, unknown


def normalize_product_name(name: str) -> str | None:
    for key, patterns in PRODUCT_RULES:
        if name in patterns:
            return key
    for key, patterns in PRODUCT_RULES:
        if any(pattern in name for pattern in patterns):
            return key
    return None
