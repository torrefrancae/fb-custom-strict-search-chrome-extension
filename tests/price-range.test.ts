import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compilePriceRanges,
  listingMatchesPriceRanges,
  parsePriceAmount
} from "@src/shared/price-range";

describe("parsePriceAmount", () => {
  it("reads plain, comma, currency, and k/m prices", () => {
    assert.equal(parsePriceAmount("PHP 280,000"), 280000);
    assert.equal(parsePriceAmount("₱5,000"), 5000);
    assert.equal(parsePriceAmount("7.5k"), 7500);
    assert.equal(parsePriceAmount("1.2m"), 1200000);
    assert.equal(parsePriceAmount(""), null);
  });
});

describe("compilePriceRanges", () => {
  it("parses multiple ranges separated by comma or and", () => {
    const filter = compilePriceRanges("5000-10000 and 5-10");
    assert.equal(filter.error, "");
    assert.deepEqual(filter.ranges, [
      { min: 5000, max: 10000 },
      { min: 5, max: 10 }
    ]);
    assert.deepEqual(compilePriceRanges("5k-10k, 100-200").ranges, [
      { min: 5000, max: 10000 },
      { min: 100, max: 200 }
    ]);
  });

  it("reports bad ranges", () => {
    assert.match(compilePriceRanges("5000").error, /Bad price range/);
    assert.match(compilePriceRanges("abc-def").error, /Bad price range/);
  });
});

describe("listingMatchesPriceRanges", () => {
  it("keeps prices inside any range", () => {
    const filter = compilePriceRanges("5000-10000, 5-10");
    assert.equal(listingMatchesPriceRanges("PHP 7,500", filter), true);
    assert.equal(listingMatchesPriceRanges("8", filter), true);
    assert.equal(listingMatchesPriceRanges("PHP 3,000", filter), false);
    assert.equal(listingMatchesPriceRanges("", filter), false);
    assert.equal(listingMatchesPriceRanges("PHP 7,500", compilePriceRanges("")), true);
  });
});
