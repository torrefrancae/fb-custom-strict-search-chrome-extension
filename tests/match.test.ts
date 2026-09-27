import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileMatchRegex,
  findTokenRanges,
  haystackHasAllTokens,
  listingHitsExclude,
  listingMatchesQuery,
  listingMatchesRegex,
  parseExcludeTerms,
  tokenize
} from "@src/shared/match";

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

  it("hides a matching listing when an exclude word is in the title", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic parts 2015", "Clean title", "civic 2015", true, "parts"),
      false
    );
  });

  it("hides a matching listing when an exclude word is in the description", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic 2015", "Wrecked, for rebuild", "civic 2015", true, "wrecked"),
      false
    );
  });

  it("hides a listing when any comma-separated exclude word matches", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic 2015", "Sold as parts", "civic 2015", true, "wrecked, parts"),
      false
    );
  });

  it("keeps a listing when none of the exclude words appear", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic 2015", "One owner, garage kept", "civic 2015", true, "parts, wrecked"),
      true
    );
  });

  it("treats an empty exclude field as no extra filter", () => {
    assert.equal(listingMatchesQuery("Honda Civic 2015", "Clean papers", "civic 2015", true, ""), true);
    assert.equal(listingMatchesQuery("Honda Civic 2015", "Clean papers", "civic 2015", true, "  ,  "), true);
  });

  it("treats one comma slot with two words as a phrase", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic 2015", "One owner, garage kept", "civic 2015", true, "one owner"),
      false
    );
    assert.equal(
      listingMatchesQuery("Honda Civic 2015", "One owner, garage kept", "civic 2015", true, "one crash"),
      true
    );
  });

  it("uses substring mode on exclude words", () => {
    assert.equal(
      listingMatchesQuery("Honda Civic 2015 parts", "OEM set", "civic 2015", true, "part"),
      false
    );
    assert.equal(
      listingMatchesQuery("Honda Civic 2015 parts", "OEM set", "civic 2015", false, "part"),
      true
    );
  });
});

describe("parseExcludeTerms", () => {
  it("splits on commas and trims empty slots", () => {
    assert.deepEqual(parseExcludeTerms("parts, wrecked, sold"), ["parts", "wrecked", "sold"]);
    assert.deepEqual(parseExcludeTerms(" parts,,  wrecked ,"), ["parts", "wrecked"]);
  });
});

describe("listingHitsExclude", () => {
  it("returns false when there is nothing to exclude", () => {
    assert.equal(listingHitsExclude("Honda Civic", "Clean title", ""), false);
  });
});

describe("compileMatchRegex", () => {
  it("compiles optional case-insensitive patterns and reports invalid ones", () => {
    assert.equal(compileMatchRegex("").pattern, "");
    assert.equal(compileMatchRegex("m(1|2)").error, "");
    assert.equal(compileMatchRegex("m(1|2)").regex?.flags.includes("i"), true);
    assert.match(compileMatchRegex("(").error, /./);
    assert.equal(
      listingMatchesRegex("MacBook Pro M2 16GB", "Apple silicon", "PHP 45,000", "", compileMatchRegex("m(1|2)")),
      true
    );
    assert.equal(
      listingMatchesRegex("MacBook Pro Intel 16GB", "older chip", "PHP 25,000", "", compileMatchRegex("m(1|2)")),
      false
    );
    assert.equal(
      listingMatchesRegex("MacBook", "has M1 inside note", "PHP 30,000", "", compileMatchRegex("m(1|2)")),
      true
    );
  });
});
