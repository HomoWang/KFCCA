from __future__ import annotations

import html
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

IZO_URL = "https://kfc.izo.tw/"
COUPON_RE = re.compile(r"/coupons/(\d{5})(?:\D|$)")
PRICE_RE = re.compile(r"(\d{1,5})\s*元")
DATE_RE = re.compile(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})")
ITEM_RE = re.compile(r"(?P<name>[^+]+?)(?:\s*[xX]\s*(?P<qty>\d+))?\s*$")


@dataclass
class IzoCoupon:
    code: str
    title: str | None = None
    description: str | None = None
    price: int = 0
    rawItems: list[dict[str, Any]] | None = None
    startDate: str | None = None
    endDate: str | None = None
    sourceUrl: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "title": self.title or f"優惠券 {self.code}",
            "description": self.description or "",
            "price": self.price,
            "rawItems": self.rawItems or [],
            "startDate": self.startDate,
            "endDate": self.endDate,
            "sourceUrl": self.sourceUrl,
        }


class VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._skip_depth:
            self._skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = html.unescape(data).strip()
        if text:
            self.parts.append(re.sub(r"\s+", " ", text))


def fetch_izo_codes(url: str = IZO_URL, timeout: int = 20) -> set[str]:
    page = fetch_text(url, timeout=timeout)
    if not page:
        return set()

    codes = set(COUPON_RE.findall(page))
    if not codes:
        logging.warning("No /coupons/xxxxx links found from %s; the HTML structure may have changed.", url)
    return codes


def fetch_izo_coupon(code: str, timeout: int = 20) -> dict[str, Any] | None:
    url = urllib.parse.urljoin(IZO_URL, f"/coupons/{code}")
    page = fetch_text(url, timeout=timeout)
    if not page:
        return None
    return parse_izo_coupon_page(code, page, url).to_dict()


def fetch_text(url: str, timeout: int = 20) -> str | None:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KFCCa coupon updater (+https://github.com/)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as exc:
        logging.warning("Unable to fetch %s: %s", url, exc)
        return None


def parse_izo_coupon_page(code: str, page: str, url: str | None = None) -> IzoCoupon:
    parser = VisibleTextParser()
    parser.feed(page)
    lines = [line.strip() for line in parser.parts if line.strip()]

    title = parse_title(page, code)
    price = 0
    description = None
    start_date = None
    end_date = None

    for index, line in enumerate(lines):
        if line != code:
            continue

        price = find_previous_price(lines, index)
        discount = lines[index + 1] if index + 1 < len(lines) and "折" in lines[index + 1] else ""
        description = find_description(lines, index)
        title = " ".join(part for part in [f"{price}元" if price else "", code, discount] if part) or title
        dates = find_dates(lines, index)
        if dates:
            start_date = dates[0] if len(dates) > 1 else None
            end_date = dates[-1]
        break

    if price == 0:
        price = parse_price_from_meta(page)
    if not description:
        description = parse_description_from_meta(page)
    if not end_date:
        dates = [format_date(match) for match in DATE_RE.finditer(" ".join(lines[:80]))]
        if dates:
            start_date = dates[0] if len(dates) > 1 else None
            end_date = dates[-1]

    return IzoCoupon(
        code=code,
        title=title,
        description=description,
        price=price,
        rawItems=parse_raw_items(description or ""),
        startDate=start_date,
        endDate=end_date,
        sourceUrl=url,
    )


def find_previous_price(lines: list[str], index: int) -> int:
    for candidate in reversed(lines[max(0, index - 4) : index]):
        match = PRICE_RE.search(candidate)
        if match and "原價" not in candidate:
            return int(match.group(1))
    return 0


def find_description(lines: list[str], index: int) -> str | None:
    for candidate in lines[index + 1 : index + 8]:
        if "+" in candidate or re.search(r"[xX]\s*\d+", candidate):
            return candidate
    return None


def find_dates(lines: list[str], index: int) -> list[str]:
    for candidate in lines[index + 1 : index + 10]:
        if "期限" in candidate or DATE_RE.search(candidate):
            dates = [format_date(match) for match in DATE_RE.finditer(candidate)]
            if dates:
                return dates
    return []


def parse_title(page: str, code: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", page, flags=re.I | re.S)
    if not match:
        return f"優惠券 {code}"
    title = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", match.group(1)))).strip()
    return title or f"優惠券 {code}"


def parse_description_from_meta(page: str) -> str | None:
    match = re.search(
        r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+content=["\']([^"\']+)["\']',
        page,
        flags=re.I | re.S,
    )
    if not match:
        return None
    return html.unescape(match.group(1)).strip()


def parse_price_from_meta(page: str) -> int:
    description = parse_description_from_meta(page) or ""
    match = re.search(r"只賣\s*(\d{1,5})\s*元", description)
    return int(match.group(1)) if match else 0


def parse_raw_items(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for part in re.split(r"\s*\+\s*", text):
        part = part.strip()
        if not part or "優惠券代碼" in part or "期限" in part:
            continue
        match = ITEM_RE.match(part)
        if not match:
            rows.append({"name": part, "quantity": 1})
            continue
        name = match.group("name").strip()
        quantity = int(match.group("qty") or "1")
        if name:
            rows.append({"name": name, "quantity": quantity})
    return rows


def format_date(match: re.Match[str]) -> str:
    year, month, day = match.groups()
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
