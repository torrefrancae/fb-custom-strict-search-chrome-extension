import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMarketplaceSearchPath, isMarketplaceUrl } from "@src/shared/query";

describe("isMarketplaceUrl", () => {
  it("keeps Marketplace search and browse URLs", () => {
    assert.equal(isMarketplaceUrl("https://www.facebook.com/marketplace/search/?query=macbook"), true);
    assert.equal(isMarketplaceUrl("https://www.facebook.com/marketplace/"), true);
    assert.equal(isMarketplaceUrl("https://web.facebook.com/marketplace/item/123"), true);
  });

  it("hides the panel on regular Facebook pages", () => {
    assert.equal(isMarketplaceUrl("https://www.facebook.com/"), false);
    assert.equal(isMarketplaceUrl("https://www.facebook.com/watch"), false);
    assert.equal(isMarketplaceUrl("https://www.facebook.com/groups/feed"), false);
  });
});

describe("isMarketplaceSearchPath", () => {
  it("allows search and browse but not a single item page", () => {
    assert.equal(isMarketplaceSearchPath("/marketplace/search/"), true);
    assert.equal(isMarketplaceSearchPath("/marketplace/"), true);
    assert.equal(isMarketplaceSearchPath("/marketplace/item/123"), false);
  });
});
