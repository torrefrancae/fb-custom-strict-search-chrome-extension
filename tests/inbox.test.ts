import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractInboxThreads } from "@src/shared/inbox-extract";
import { kindForMode, normalizeListing } from "@src/shared/listing-quality";

describe("chat listing shaping", () => {
  it("marks buying and selling kinds from the active mode", () => {
    assert.equal(kindForMode("buying"), "buying");
    assert.equal(kindForMode("selling"), "selling");
    assert.equal(kindForMode("marketplace"), "listing");
  });

  it("keeps a chat href when the row points at a marketplace thread", () => {
    const chat = normalizeListing({
      id: "100200300",
      numericId: "444444",
      title: "Honda Civic 2015",
      description: "Is this still available?",
      party: "Ana Seller",
      href: "https://www.facebook.com/marketplace/t/100200300/",
      kind: "buying",
      photo: "https://example.com/civic.jpg",
      price: ""
    });
    assert.equal(chat.kind, "buying");
    assert.match(chat.href, /\/marketplace\/t\//);
    assert.equal(chat.party, "Ana Seller");
  });
});

describe("extractInboxThreads", () => {
  it("reads marketplace thread payloads", () => {
    const rows = extractInboxThreads(
      {
        data: {
          edges: [
            {
              node: {
                __typename: "MarketplaceThread",
                thread_key: "t_900111222",
                snippet: { text: "Is the ninja still available?" },
                other_user: { name: "Ana Seller" },
                listing: {
                  id: "marketplace_listing:555666777",
                  marketplace_listing_title: "Kawasaki Ninja 300",
                  primary_listing_photo: { image: { uri: "https://example.com/ninja.jpg" } }
                }
              }
            }
          ]
        }
      },
      "buying"
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0]?.title || "", /Ninja/);
    assert.match(rows[0]?.party || "", /Ana/);
    assert.match(rows[0]?.href || "", /\/marketplace\/t\//);
  });

  it("ignores messenger group threads without a marketplace listing", () => {
    const rows = extractInboxThreads(
      {
        data: {
          edges: [
            {
              node: {
                __typename: "MessageThread",
                thread_key: "t_111222333",
                snippet: { text: "hello group" },
                other_user: { name: "Friends Group" }
              }
            }
          ]
        }
      },
      "buying"
    );
    assert.equal(rows.length, 0);
  });
});
