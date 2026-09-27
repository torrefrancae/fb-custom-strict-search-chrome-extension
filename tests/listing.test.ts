import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { descriptionNearId, extractListingsFromText } from "@src/shared/hydrate";
import { extractListings, listingIdFromHref, parseFacebookBody } from "@src/shared/listing";

describe("extractListings", () => {
  it("walks nested marketplace payloads for title and description", () => {
    const listings = extractListings({
      data: {
        marketplace_search: {
          edges: [
            {
              node: {
                id: "marketplace_listing:998877665544",
                marketplace_listing_title: "Honda Civic 2015",
                listing_price: { formatted_amount: "PHP 280,000" },
                primary_listing_photo: { image: { uri: "https://example.com/civic.jpg" } },
                redacted_description: { text: "One owner, garage kept." }
              }
            }
          ]
        }
      }
    });

    assert.equal(listings.length, 1);
    assert.equal(listings[0]?.numericId, "998877665544");
    assert.equal(listings[0]?.title, "Honda Civic 2015");
    assert.equal(listings[0]?.description, "One owner, garage kept.");
    assert.equal(listings[0]?.price, "PHP 280,000");
    assert.equal(listings[0]?.photo, "https://example.com/civic.jpg");
    assert.deepEqual(listings[0]?.photos, ["https://example.com/civic.jpg"]);
  });
});

describe("parseFacebookBody", () => {
  it("strips the anti-hijack prefix", () => {
    const parsed = parseFacebookBody('for (;;);{"ok":true}');
    assert.deepEqual(parsed, { ok: true });
  });
});

describe("extractListingsFromText", () => {
  it("reads title, id, photo, and description from a raw payload string", () => {
    const listings = extractListingsFromText(
      '{"id":"marketplace_listing:555666777888","marketplace_listing_title":"Honda Civic 2015","redacted_description":{"text":"One owner"},"uri":"https://example.com/civic.jpg","uri":"https://example.com/civic-2.jpg"}'
    );
    assert.equal(listings[0]?.numericId, "555666777888");
    assert.equal(listings[0]?.title, "Honda Civic 2015");
    assert.equal(listings[0]?.description, "One owner");
    assert.equal(listings[0]?.photo, "https://example.com/civic.jpg");
    assert.deepEqual(listings[0]?.photos, [
      "https://example.com/civic.jpg",
      "https://example.com/civic-2.jpg"
    ]);
  });

  it("finds a description near a listing id even when far from the title", () => {
    const text =
      'xxxxxx marketplace_listing:999888777666 yyyyy "redacted_description":{"text":"Garage kept civic with clean papers"} zzzzz';
    assert.match(descriptionNearId(text, "999888777666"), /Garage kept/);
  });
});

describe("listingIdFromHref", () => {
  it("reads the item id from a marketplace href", () => {
    assert.equal(
      listingIdFromHref("https://www.facebook.com/marketplace/item/1234567890/?ref=search"),
      "1234567890"
    );
  });
});
