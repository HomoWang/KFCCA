from __future__ import annotations

import logging
import os
import re

RANGE_RE = re.compile(r"^\s*(\d{5})(?:\s*[-:]\s*(\d{5}))?\s*$")


def parse_ranges(value: str | None) -> set[str]:
    codes: set[str] = set()
    if not value:
        return codes

    for part in re.split(r"[,;\n]+", value):
        part = part.strip()
        if not part:
            continue
        match = RANGE_RE.match(part)
        if not match:
            logging.warning("Ignoring invalid coupon range: %s", part)
            continue
        start = int(match.group(1))
        end = int(match.group(2) or match.group(1))
        if start > end:
            start, end = end, start
        if end - start > 5000:
            logging.warning("Range %s is large; cap it to avoid excessive requests.", part)
            end = start + 5000
        codes.update(f"{code:05d}" for code in range(start, end + 1))
    return codes


def fetch_range_codes(env: dict[str, str] | None = None) -> set[str]:
    env = env or os.environ
    return parse_ranges(env.get("COUPON_RANGES")) | parse_ranges(env.get("CHECK_RANGES"))
