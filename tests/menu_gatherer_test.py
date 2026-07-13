from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "script"))

from gatherer.menu import parse_food_variant


def option(name: str, extra: int = 0) -> dict:
    return {"Name": name, "MListPrice": extra}


def slot(*options: dict, min_count: int = 1) -> dict:
    return {"MinCount": min_count, "MaxCount": min_count, "MList": list(options)}


def variant(name: str, *details: dict, single: bool = False) -> dict:
    return {
        "Fcode": "TEST",
        "Name": name,
        "isSingleItem": single,
        "SoldOut": False,
        "Original_Price": 50,
        "Details": list(details),
    }


class MenuGathererTest(unittest.TestCase):
    def test_name_fallback_does_not_add_a_second_fries_size(self) -> None:
        parsed = parse_food_variant(variant(
            "青花椒薯條",
            slot(option("香酥脆薯(中)")),
            slot(option("青花椒香麻沾醬(小)")),
        ))

        self.assertEqual(parsed["fixedItems"], {"medium_fries": 1, "sauce": 1})

    def test_name_quantity_reconciles_with_incomplete_fixed_slots(self) -> None:
        parsed = parse_food_variant(variant(
            "1顆原味蛋撻+1顆鐵觀音珍奶蛋撻",
            slot(option("原味蛋撻")),
            single=True,
        ))

        self.assertEqual(parsed["fixedItems"], {"egg_tart": 2})

    def test_buy_get_and_compound_names_infer_quantities(self) -> None:
        buy_get = parse_food_variant(variant("甜辣爆脆無骨雞腿霸(是拉差醬)買5送1"))
        compound = parse_food_variant(variant("上校雞塊4塊+香酥脆薯(小)"))

        self.assertEqual(buy_get["fixedItems"], {"fried_chicken_piece": 6})
        self.assertEqual(compound["fixedItems"], {"chicken_nuggets": 4, "small_fries": 1})

    def test_no_item_choice_is_marked_and_never_becomes_fixed_sauce(self) -> None:
        choice = parse_food_variant(variant(
            "上校雞塊4塊",
            slot(option("糖醋醬"), option("不需附糖醋醬")),
        ))
        fixed = parse_food_variant(variant(
            "咔啦雞腿堡",
            slot(option("不需附糖醋醬")),
        ))

        self.assertEqual(choice["fixedItems"], {"chicken_nuggets": 4})
        self.assertTrue(choice["choiceGroups"][0]["options"][1]["isNoItem"])
        self.assertEqual(fixed["fixedItems"], {"zinger_burger": 1})

    def test_shrimp_nuggets_are_not_chicken_nuggets(self) -> None:
        parsed = parse_food_variant(variant("黃金超蝦塊3塊"))

        self.assertEqual(parsed["fixedItems"], {"shrimp_nuggets": 3})
        self.assertNotIn("chicken_nuggets", parsed["fixedItems"])

    def test_unmapped_name_is_preserved_as_unknown(self) -> None:
        parsed = parse_food_variant(variant("蜂蜜糖球"))

        self.assertEqual(parsed["fixedItems"], {})
        self.assertEqual(parsed["unknownItems"], [{"name": "蜂蜜糖球", "quantity": 1}])


if __name__ == "__main__":
    unittest.main()
