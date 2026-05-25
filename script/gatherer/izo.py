from __future__ import annotations

import logging
import re
import urllib.error
import urllib.request

IZO_URL = "https://kfc.izo.tw/"
COUPON_RE = re.compile(r"/coupons/(\d{5})(?:\D|$)")


def fetch_izo_codes(url: str = IZO_URL, timeout: int = 20) -> set[str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "KFCCa coupon updater (+https://github.com/)",
            "Accept": "text/html,application/xhtml+xml",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            html = response.read().decode("utf-8", errors="ignore")
    except (urllib.error.URLError, TimeoutError) as exc:
        logging.warning("Unable to fetch %s: %s", url, exc)
        return set()

    codes = set(COUPON_RE.findall(html))
    if not codes:
        logging.warning("No /coupons/xxxxx links found from %s; the HTML structure may have changed.", url)
    return codes
