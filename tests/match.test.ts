import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findTokenRanges, haystackHasAllTokens, listingMatchesQuery, tokenize } from "@src/shared/match";

describe("findTokenRanges", () => {
  it("finds whole words in any order", () => {
    const ranges = findTokenRanges("2015 Honda Civic LX", ["civic", "2015"]);
    assert.deepEqual(ranges, [
      { start: 0, end: 4 },
      { start: 11, end: 16 }
    ]);
  });

  it("does not mark civic inside civics in exact mode", () => {
    assert.deepEqual(findTokenRanges("many civics for sale", ["civic"], false), []);
  });

  it("marks 250 inside z250sl in substring mode", () => {
    assert.deepEqual(findTokenRanges("ninja z250sl", ["ninja", "250"], true), [
      { start: 0, end: 5 },
      { start: 7, end: 10 }
    ]);
  });

  it("marks 48 GB when the query token is 48gb", () => {
    assert.deepEqual(findTokenRanges("MacBook 48 GB RAM", ["48gb"], true), [{ start: 8, end: 13 }]);
  });
});

describe("tokenize", () => {
  it("splits on punctuation and ignores order later", () => {
    assert.deepEqual(tokenize("Honda, Civic 2015"), ["honda", "civic", "2015"]);
  });

  it("joins a size number with its unit", () => {
    assert.deepEqual(tokenize("macbook 48 gb"), ["macbook", "48gb"]);
    assert.deepEqual(tokenize("macbook 48gb"), ["macbook", "48gb"]);
  });
});

describe("listingMatchesQuery", () => {
  it("keeps a listing when every word is present in any order", () => {
    assert.equal(
      listingMatchesQuery("2015 Honda Civic LX", "Clean title, one owner", "civic honda 2015"),
      true
    );
  });

  it("keeps a listing when words are split across title and description", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic", "Year 2015, well kept", "2015 honda"),
      true
    );
  });

  it("drops a listing when one word is missing", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic 2014", "Great condition", "honda civic 2015"),
      false
    );
  });

  it("does not treat civic as a match inside civics in exact mode", () => {
    assert.equal(haystackHasAllTokens("many civics for sale", ["civic"], false), false);
  });

  it("keeps ninja z250sl when substring matching ninja 250", () => {
    assert.equal(listingMatchesQuery("Kawasaki ninja z250sl", "abs model", "ninja 250", true), true);
  });

  it("hides ninja z250sl when exact matching ninja 250", () => {
    assert.equal(listingMatchesQuery("Kawasaki ninja z250sl", "abs model", "ninja 250", false), false);
  });

  it("does not treat a 250k price as a 250 model match", () => {
    assert.equal(
      listingMatchesQuery("Kawasaki ninja zx 650", "PHP250,000 Clean title", "ninja 250", true),
      false
    );
  });

  it("still keeps ninja 250r with a 250k price in substring mode", () => {
    assert.equal(
      listingMatchesQuery("Kawasaki ninja 250r", "PHP250,000", "ninja 250", true),
      true
    );
  });

  it("treats an empty query as a match", () => {
    assert.equal(listingMatchesQuery("Anything", "", ""), true);
  });

  it("keeps a listing when every word is only in the title", () => {
    assert.equal(listingMatchesQuery("Honda Civic 2015", "Clean papers", "civic 2015"), true);
  });

  it("keeps a listing when every word is only in the description", () => {
    assert.equal(listingMatchesQuery("Family sedan", "2015 Honda Civic, one owner", "honda civic"), true);
  });

  it("hides a listing when a word is in neither the title nor the description", () => {
    assert.equal(
      listingMatchesQuery("Toyota Vios 2018", "Honda floor mats included", "civic 2015"),
      false
    );
  });

  it("treats 48gb and 48 GB as the same memory size", () => {
    assert.equal(listingMatchesQuery("MacBook Pro M3 Max", "48 GB RAM 1TB", "macbook 48gb"), true);
    assert.equal(listingMatchesQuery("MacBook Pro 48GB", "Unified Memory", "macbook 48 gb"), true);
  });

  it("does not treat a 48-core GPU plus 16GB as 48gb", () => {
    assert.equal(
      listingMatchesQuery("MacBook Pro M3 Max 16/48", "18GB RAM 16GB unified", "macbook 48gb"),
      false
    );
  });
});
