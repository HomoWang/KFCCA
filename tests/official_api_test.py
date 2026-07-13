from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "script"))

from gatherer.official_api import OfficialApiClient, OfficialApiConfig


class StubOfficialApiClient(OfficialApiClient):
    def __init__(self, available_periods: set[str]) -> None:
        super().__init__(OfficialApiConfig(sleep_seconds=0))
        self.available_periods = available_periods
        self.requests: list[tuple[str, dict]] = []

    def _post(self, url: str, body: dict, label: str):
        self.requests.append((label, body))
        if label == "checkCouponProduct":
            success = body["mealPeriod"] in self.available_periods
            return {"Message": "OK" if success else "Unavailable", "Success": success}
        if label == "GetQueryFoodDetail":
            return {"Data": {"FoodDetail": [{"Fcode": "F1", "Name": "測試套餐", "Original_Price": 99, "Details": []}]}}
        raise AssertionError(f"Unexpected request: {label}")


class OfficialApiMealPeriodTest(unittest.TestCase):
    @patch.object(OfficialApiClient, "_init_delivery_info", return_value=None)
    def test_collects_every_available_period_and_uses_first_for_details(self, _init) -> None:
        client = StubOfficialApiClient({"1", "3", "4"})

        details = client.fetch_coupon_details("12345", "F1")

        self.assertEqual(details["mealPeriods"], ["1", "3", "4"])
        detail_request = next(body for label, body in client.requests if label == "GetQueryFoodDetail")
        self.assertEqual(detail_request["mealperiod"], "1")

    @patch.object(OfficialApiClient, "_init_delivery_info", return_value=None)
    def test_no_available_period_marks_coupon_unavailable_for_delivery(self, _init) -> None:
        client = StubOfficialApiClient(set())

        details = client.fetch_coupon_details("12345", "F1")

        self.assertEqual(details, {"deliveryAvailable": False, "mealPeriods": []})
        self.assertFalse(any(label == "GetQueryFoodDetail" for label, _body in client.requests))


if __name__ == "__main__":
    unittest.main()
