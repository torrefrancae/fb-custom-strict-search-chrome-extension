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

  it("does not mark civic inside civics", () => {
    assert.deepEqual(findTokenRanges("many civics for sale", ["civic"]), []);
  });
});

describe("tokenize", () => {
  it("splits on punctuation and ignores order later", () => {
    assert.deepEqual(tokenize("Honda, Civic 2015"), ["honda", "civic", "2015"]);
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

  it("does not treat civic as a match inside civics", () => {
    assert.equal(haystackHasAllTokens("many civics for sale", ["civic"]), false);
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
});
