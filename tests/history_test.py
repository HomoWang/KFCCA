from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "script"))

from gatherer.history import update_history, update_menu_history


class MenuHistoryTest(unittest.TestCase):
    def test_initial_menu_snapshot_uses_existing_baseline(self) -> None:
        history = {"baselineDate": "2026-06-16", "codes": {}, "products": {}}

        updated = update_menu_history(history, [{"fcode": "A1"}], "2026-07-13")

        self.assertEqual(updated["menuProducts"], {"A1": "2026-06-16"})

    def test_later_menu_product_uses_current_date(self) -> None:
        history = {
            "baselineDate": "2026-06-16",
            "codes": {},
            "products": {},
            "menuProducts": {"A1": "2026-06-16"},
        }

        updated = update_menu_history(history, [{"fcode": "A1"}, {"fcode": "NEW"}], "2026-07-13")

        self.assertEqual(updated["menuProducts"]["NEW"], "2026-07-13")

    def test_coupon_history_update_preserves_menu_history(self) -> None:
        history = {
            "baselineDate": "2026-06-16",
            "codes": {},
            "products": {},
            "menuProducts": {"A1": "2026-06-16"},
        }

        updated = update_history(history, [{"code": "C1", "items": {}}], "2026-07-13")

        self.assertEqual(updated["menuProducts"], history["menuProducts"])


if __name__ == "__main__":
    unittest.main()
