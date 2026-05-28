import assert from "node:assert/strict";
import test from "node:test";
import { couponMatchesItemFilters, makeFilterId } from "../src/lib/couponFilters.js";

test("coupon list filters use AND logic for multiple broad filters", () => {
  const burgerDrink = { items: { zinger_burger: 1, small_drink: 1 } };
  const burgerOnly = { items: { zinger_burger: 1 } };
  const drinkOnly = { items: { small_drink: 1 } };
  const filters = [makeFilterId("broad", "burger"), makeFilterId("broad", "drink")];

  assert.equal(couponMatchesItemFilters(burgerDrink, filters), true);
  assert.equal(couponMatchesItemFilters(burgerOnly, filters), false);
  assert.equal(couponMatchesItemFilters(drinkOnly, filters), false);
});

test("coupon list filters can combine exact products", () => {
  const tartDrink = { items: { egg_tart: 1, drink: 1 } };
  const tartOnly = { items: { egg_tart: 1 } };
  const filters = [makeFilterId("exact", "egg_tart"), makeFilterId("exact", "drink")];

  assert.equal(couponMatchesItemFilters(tartDrink, filters), true);
  assert.equal(couponMatchesItemFilters(tartOnly, filters), false);
});
