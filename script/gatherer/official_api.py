from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.cookiejar import CookieJar
from typing import Any

TAIPEI = timezone(timedelta(hours=8))

GET_EVOUCHER_URL = "https://olo-api.kfcclub.com.tw/customer/v1/getEVoucherAPI"
CHECK_COUPON_PRODUCT_URL = "https://olo-api.kfcclub.com.tw/customer/v1/checkCouponProduct"
QUERY_FOOD_DETAIL_URL = "https://olo-api.kfcclub.com.tw/menu/v1/GetQueryFoodDetail"
QUERY_DELIVERY_SHOPS_URL = "https://olo-api.kfcclub.com.tw/menu/v1/QueryDeliveryShops"
QUERY_DELIVERY_TIME_URL = "https://olo-api.kfcclub.com.tw/menu/v1/QueryDeliveryTime"

DATE_RE = re.compile(r"(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})")
FREE_RE = re.compile(r"(免費|0\s*元|零元|兌換|贈)")

PRODUCT_RULES: list[tuple[str, list[str]]] = [
    ("peanut_zinger_burger", ["花生熔岩雞腿堡", "花生熔岩咔啦雞腿堡", "花生脆雞堡"]),
    ("sichuan_zinger_burger", ["青花椒卡啦雞腿堡", "青花椒咔啦雞腿堡", "青花椒香麻咔啦雞腿堡"]),
    ("new_orleans_burger", ["紐奧良烤雞腿堡"]),
    ("shrimp_burger", ["蝦堡", "魚子海陸蝦堡"]),
    ("crispy_chicken_burger", ["脆雞堡", "原味脆雞堡"]),
    ("pork_burger", ["起司豬肉堡", "豬肉堡"]),
    ("zinger_burger", ["卡啦雞腿堡", "咔啦雞腿堡", "卡拉雞腿堡"]),
    ("paper_chicken", ["紙包雞", "義式香草紙包雞"]),
    ("spicy_crispy_chicken", ["卡拉脆雞-辣", "卡啦脆雞-辣", "咔啦脆雞-辣", "卡拉脆雞(辣)", "卡啦脆雞(辣)", "咔啦脆雞(辣)"]),
    ("original_crispy_chicken", ["卡拉脆雞-原味", "卡啦脆雞-原味", "咔啦脆雞-原味", "卡拉脆雞(原味)", "卡啦脆雞(原味)", "咔啦脆雞(原味)"]),
    ("sichuan_fried_chicken", ["青花椒炸雞", "青花椒香麻脆雞"]),
    ("fried_chicken", ["炸雞", "咔啦脆雞", "卡啦脆雞", "脆雞", "無骨雞腿"]),
    ("egg_tart", ["蛋塔", "蛋撻", "奶皇流心蛋撻", "冰心蛋塔"]),
    ("small_drink", ["小飲", "小杯", "(小)"]),
    ("medium_drink", ["中飲", "中杯", "(中)"]),
    ("drink", ["飲料", "可樂", "百事", "七喜", "冰紅茶", "紅茶", "綠茶", "檸檬風味紅茶", "無糖綠茶", "瓶裝"]),
    ("large_fries", ["大薯"]),
    ("medium_fries", ["中薯"]),
    ("fries", ["小薯", "薯條"]),
    ("nugget", ["雞塊", "上校雞塊", "蝦塊"]),
    ("popcorn_chicken", ["雞米花", "爆米花雞"]),
    ("biscuit", ["比司吉", "蜂蜜奶油餅乾"]),
    ("rice", ["雞汁風味飯"]),
    ("soup", ["小濃湯", "濃湯"]),
    ("sweet_potato_ball", ["地瓜球"]),
    ("combo", ["套餐", "XL", "桶"]),
]
IGNORED_ITEM_RE = re.compile(r"(醬|餐具|紙袋)")


@dataclass
class OfficialApiConfig:
    get_evoucher_url: str = GET_EVOUCHER_URL
    check_coupon_product_url: str = CHECK_COUPON_PRODUCT_URL
    query_food_detail_url: str = QUERY_FOOD_DETAIL_URL
    shop_code: str = "TWI104"
    timeout: int = 20
    retries: int = 2
    sleep_seconds: float = 0.8

    @classmethod
    def from_env(cls) -> "OfficialApiConfig":
        return cls(
            get_evoucher_url=os.environ.get("KFC_GET_EVOUCHER_URL")
            or os.environ.get("KFC_OFFICIAL_API_URL")
            or GET_EVOUCHER_URL,
            check_coupon_product_url=os.environ.get("KFC_CHECK_COUPON_PRODUCT_URL") or CHECK_COUPON_PRODUCT_URL,
            query_food_detail_url=os.environ.get("KFC_QUERY_FOOD_DETAIL_URL") or QUERY_FOOD_DETAIL_URL,
            shop_code=os.environ.get("SHOP_CODE") or os.environ.get("KFC_SHOP_CODE") or "TWI104",
            timeout=int(os.environ.get("KFC_API_TIMEOUT", "20")),
            retries=int(os.environ.get("KFC_API_RETRIES", "2")),
            sleep_seconds=float(os.environ.get("KFC_API_SLEEP", "0.8")),
        )


class OfficialApiClient:
    def __init__(self, config: OfficialApiConfig | None = None) -> None:
        self.config = config or OfficialApiConfig.from_env()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
        self._delivery_initialized = False

    def verify_coupon(self, code: str) -> dict[str, Any] | None:
        payload = self._post(
            self.config.get_evoucher_url,
            {
                "voucherNo": code,
                "phone": "",
                "memberId": "",
                "orderType": "2",
                "mealPeriod": "3",
                "shopCode": self.config.shop_code,
            },
            "getEVoucherAPI",
        )
        if not payload or is_invalid_payload(payload):
            return None

        data = extract_coupon_payload(payload)
        if not isinstance(data, dict):
            return None

        product_code = first_value(data, ["productCode", "ProductCode", "fcode", "Fcode"])
        title = first_value(data, ["productName", "couponName", "name", "title"])
        return {
            "code": code,
            "title": str(title).strip() if title else f"優惠券 {code}",
            "description": str(title).strip() if title else "",
            "price": parse_price(first_value(data, ["amount", "price", "couponPrice", "discountAmount"])),
            "startDate": parse_date(first_value(data, ["startDate", "StartDate"])),
            "endDate": parse_date(first_value(data, ["endDate", "EndDate"])),
            "available": True,
            "deliveryAvailable": None,
            "productCode": str(product_code).strip() if product_code else None,
            "rawItems": [],
            "items": {},
            "unknownItems": [],
            "verifiedAt": datetime.now(TAIPEI).isoformat(timespec="seconds"),
        }

    def fetch_coupon_details(self, code: str, product_code: str | None = None) -> dict[str, Any]:
        product_code = product_code or self._lookup_product_code(code)
        if not product_code:
            return {}

        meal_period = self._find_available_meal_period(code)
        if not meal_period:
            return {"deliveryAvailable": False}

        payload = self._post(
            self.config.query_food_detail_url,
            {
                "shopcode": self.config.shop_code,
                "fcode": product_code,
                "menuid": "",
                "mealperiod": meal_period,
                "ordertype": "2",
                "orderdate": today_slash(),
            },
            "GetQueryFoodDetail",
        )
        if not payload or is_invalid_payload(payload):
            return {}
        data = extract_coupon_payload(payload)
        return convert_food_detail_data(data, code)

    def _lookup_product_code(self, code: str) -> str | None:
        verified = self.verify_coupon(code)
        return verified.get("productCode") if verified else None

    def _find_available_meal_period(self, code: str) -> str | None:
        for period in ("1", "2", "3", "4"):
            payload = self._post(
                self.config.check_coupon_product_url,
                {
                    "orderDate": today_slash(),
                    "orderType": "2",
                    "mealPeriod": period,
                    "shopCode": self.config.shop_code,
                    "couponCode": code,
                    "memberId": "",
                },
                "checkCouponProduct",
            )
            if payload and payload.get("Message") == "OK" and payload.get("Success") is True:
                return period
        return None

    def _post(self, url: str, body: dict[str, Any], label: str) -> Any:
        self._init_delivery_info()
        for attempt in range(self.config.retries + 1):
            try:
                request = urllib.request.Request(
                    url,
                    data=json.dumps(body).encode("utf-8"),
                    method="POST",
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "application/json,text/plain,*/*",
                        "Content-Type": "application/json",
                        "Origin": "https://www.kfcclub.com.tw",
                        "Referer": "https://www.kfcclub.com.tw/",
                    },
                )
                with self.opener.open(request, timeout=self.config.timeout) as response:
                    return json.loads(response.read().decode("utf-8", errors="replace"))
            except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
                logging.warning("%s failed (attempt %s): %s", label, attempt + 1, exc)
                if attempt < self.config.retries:
                    time.sleep(self.config.sleep_seconds * (attempt + 1))
        return None

    def _init_delivery_info(self) -> None:
        if self._delivery_initialized:
            return
        self._delivery_initialized = True
        for url, body, label in (
            (
                QUERY_DELIVERY_SHOPS_URL,
                {"shopCode": self.config.shop_code, "orderType": "2", "platform": "1"},
                "QueryDeliveryShops",
            ),
            (
                QUERY_DELIVERY_TIME_URL,
                {"shopCode": self.config.shop_code, "orderType": "2", "orderDate": today_slash(), "addQt": "0", "sdeQt": "0"},
                "QueryDeliveryTime",
            ),
        ):
            try:
                self._post_without_init(url, body, label)
            except Exception as exc:
                logging.debug("%s initialization skipped: %s", label, exc)

    def _post_without_init(self, url: str, body: dict[str, Any], label: str) -> Any:
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json,text/plain,*/*",
                "Content-Type": "application/json",
                "Origin": "https://www.kfcclub.com.tw",
                "Referer": "https://www.kfcclub.com.tw/",
            },
        )
        with self.opener.open(request, timeout=self.config.timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
        if payload.get("Message") != "OK" or payload.get("Success") is not True:
            logging.debug("%s init response not OK: %s", label, payload)
        return payload


def convert_food_detail_data(data: Any, code: str) -> dict[str, Any]:
    detail = data.get("FoodDetail") if isinstance(data, dict) else None
    if isinstance(detail, list):
        detail = detail[0] if detail else None
    if not isinstance(detail, dict):
        return {}

    raw_items: list[dict[str, Any]] = []
    price = parse_price(detail.get("Original_Price"))
    for food in detail.get("Details", []):
        if not isinstance(food, dict):
            continue
        mlist = food.get("MList") or []
        if not mlist or not isinstance(mlist[0], dict):
            continue
        main_item = mlist[0]
        quantity = parse_price(food.get("MinCount")) or 1
        raw_items.append({"name": normalize_name(main_item.get("Name", "")), "quantity": quantity})
        price += parse_price(main_item.get("MListPrice")) * quantity

    items, unknown_items = normalize_raw_items(raw_items)
    title = normalize_name(detail.get("Name", "")) or f"優惠券 {code}"
    return {
        "code": code,
        "title": title,
        "description": " + ".join(f"{item['name']}x{item['quantity']}" for item in raw_items),
        "price": price,
        "rawItems": raw_items,
        "items": items,
        "unknownItems": unknown_items,
        "startDate": parse_date(detail.get("StartDate")),
        "endDate": parse_date(detail.get("EndDate")),
        "productCode": detail.get("Fcode"),
        "available": True,
        "deliveryAvailable": True,
        "verifiedAt": datetime.now(TAIPEI).isoformat(timespec="seconds"),
    }


def merge_coupon_data(base: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in extra.items():
        if value in (None, "", [], {}):
            continue
        if key == "price" and int(merged.get("price") or 0) > 0 and int(value or 0) == 0:
            continue
        if key in {"rawItems", "unknownItems"}:
            existing = merged.get(key) or []
            merged[key] = value if len(value) > len(existing) else existing
            continue
        if key == "items":
            existing = merged.get(key) or {}
            merged[key] = value if len(value) >= len(existing) else existing
            continue
        if merged.get(key) in (None, "", [], {}, 0) or value not in (None, "", [], {}, 0):
            merged[key] = value
    return merged


def extract_coupon_payload(payload: Any) -> Any:
    if isinstance(payload, list):
        return payload[0] if payload else None
    if not isinstance(payload, dict):
        return None
    for key in ("Data", "data", "Result", "result", "coupon", "couponData"):
        value = payload.get(key)
        if value not in (None, "", [], {}):
            return value
    return payload


def is_invalid_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return True
    message = str(payload.get("Message") or payload.get("message") or payload.get("msg") or "")
    success = payload.get("Success", payload.get("success", None))
    status = str(payload.get("status") or payload.get("resultCode") or payload.get("code") or "").lower()
    if success is False or status in {"false", "0", "invalid", "notfound", "404"}:
        return True
    return any(token in message for token in ("無效", "不存在", "查無", "錯誤"))


def first_value(data: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def parse_price(value: Any) -> int:
    if isinstance(value, (int, float)):
        return int(value)
    match = re.search(r"\d+", str(value or "").replace(",", ""))
    return int(match.group(0)) if match else 0


def parse_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value)
    match = DATE_RE.search(text)
    if not match:
        return text[:10] if re.match(r"20\d{2}-\d{2}-\d{2}", text) else None
    year, month, day = match.groups()
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def normalize_name(name: Any) -> str:
    text = str(name or "").strip()
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    return text


def normalize_raw_items(raw_items: list[dict[str, Any]]) -> tuple[dict[str, int], list[dict[str, Any]]]:
    items: dict[str, int] = {}
    unknown: list[dict[str, Any]] = []
    for raw in raw_items:
        name = str(raw.get("name", "")).replace(" ", "")
        quantity = int(raw.get("quantity") or 1) * infer_quantity_multiplier(name)
        if should_ignore_item(name):
            continue
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


def infer_quantity_multiplier(name: str) -> int:
    match = re.match(r"(\d+)\s*(?:入|塊|顆)", name)
    if match:
        return int(match.group(1))
    match = re.search(r"雞塊\s*(\d+)\s*塊", name)
    return int(match.group(1)) if match else 1


def should_ignore_item(name: str) -> bool:
    return bool(IGNORED_ITEM_RE.search(name))


def is_free_coupon(coupon: dict[str, Any]) -> bool:
    text = f"{coupon.get('title', '')} {coupon.get('description', '')}"
    return bool(FREE_RE.search(text))


def today_slash() -> str:
    return datetime.now(TAIPEI).strftime("%Y/%m/%d")
