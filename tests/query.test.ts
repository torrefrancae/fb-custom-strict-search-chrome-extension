import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { threadIdFromHref } from "@src/shared/listing";
import {
  facebookSearchUrl,
  harvestUrl,
  inboxTabFromHref,
  isFacebookSearchPath,
  isMarketplaceInboxPath,
  isMarketplaceSearchPath,
  isMarketplaceUrl,
  marketplaceInboxUrl
} from "@src/shared/query";

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

describe("facebook search helpers", () => {
  it("builds facebook posts search urls", () => {
    assert.equal(
      facebookSearchUrl("https://www.facebook.com", "honda civic"),
      "https://www.facebook.com/search/posts/?q=honda+civic"
    );
    assert.equal(
      harvestUrl("https://www.facebook.com", "facebook", "iphone"),
      "https://www.facebook.com/search/posts/?q=iphone"
    );
    assert.equal(isFacebookSearchPath("/search/posts/"), true);
    assert.equal(isFacebookSearchPath("/search/top"), true);
    assert.equal(isFacebookSearchPath("/marketplace/search/"), false);
  });
});

describe("marketplace inbox helpers", () => {
  it("builds buying and selling inbox urls", () => {
    assert.equal(
      marketplaceInboxUrl("https://www.facebook.com", "buying"),
      "https://www.facebook.com/marketplace/inbox?targetTab=BUYER"
    );
    assert.equal(
      harvestUrl("https://www.facebook.com", "selling", "civic"),
      "https://www.facebook.com/marketplace/inbox?targetTab=SELLER"
    );
  });

  it("reads the inbox tab from the page href", () => {
    assert.equal(inboxTabFromHref("https://www.facebook.com/marketplace/inbox?targetTab=BUYER"), "buying");
    assert.equal(inboxTabFromHref("https://www.facebook.com/marketplace/inbox?targetTab=SELLER"), "selling");
    assert.equal(isMarketplaceInboxPath("/marketplace/inbox"), true);
  });

  it("reads marketplace thread ids", () => {
    assert.equal(threadIdFromHref("https://www.facebook.com/marketplace/t/100200300/?ref=inbox"), "100200300");
  });
});
