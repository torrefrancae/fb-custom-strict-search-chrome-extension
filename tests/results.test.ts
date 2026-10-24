import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUsableListing, normalizeListing, preferDescription } from "@src/shared/listing-quality";
import { clipText, filterListings, listingItemUrl, searchStatus, visibleListings } from "@src/shared/results";
import type { ListingRecord } from "@src/shared/types";

function listing(partial: Partial<ListingRecord> & Pick<ListingRecord, "id" | "title">): ListingRecord {
  return normalizeListing({
    numericId: partial.numericId || partial.id,
    description: "",
    price: "",
    photo: "https://example.com/photo.jpg",
    href: `https://www.facebook.com/marketplace/item/${partial.numericId || partial.id}/`,
    kind: "listing",
    party: "",
    ...partial
  });
}

describe("filterListings", () => {
  const rows = [
    listing({
      id: "111111",
      title: "Honda Civic 2015",
      description: "One owner, garage kept",
      price: "PHP 280,000"
    }),
    listing({
      id: "222222",
      title: "Toyota Vios 2018",
      description: "Honda mats included",
      price: "PHP 90,000"
    }),
    listing({
      id: "333333",
      title: "Civic Hatchback",
      description: "2015 model year, wrecked",
      price: "PHP 310,000"
    }),
    listing({
      id: "444444",
      title: "Civic 2015 no price",
      description: "should be hidden",
      price: ""
    }),
    listing({
      id: "ghost",
      numericId: "",
      title: "Broken teaser",
      href: "",
      photo: ""
    })
  ];

  it("keeps only listings that have every search word", () => {
    const cards = filterListings(rows, "civic 2015", true, "");
    assert.deepEqual(
      cards.map((card) => card.id),
      ["111111", "333333"]
    );
    assert.equal(cards[0]?.href, "https://www.facebook.com/marketplace/item/111111/");
  });

  it("hides listings that match any Don't include word", () => {
    const cards = filterListings(rows, "civic 2015", true, "hatchback, wrecked");
    assert.deepEqual(
      cards.map((card) => card.id),
      ["111111"]
    );
  });

  it("keeps only listings that also match the advanced regex", () => {
    const macs = [
      listing({
        id: "700001",
        title: "MacBook Pro M1 16GB",
        description: "Apple silicon",
        price: "PHP 40,000"
      }),
      listing({
        id: "700002",
        title: "MacBook Pro Intel 16GB",
        description: "older chip",
        price: "PHP 25,000"
      }),
      listing({
        id: "700003",
        title: "MacBook Air 16GB",
        description: "M2 chip, light",
        price: "PHP 35,000"
      })
    ];
    const cards = filterListings(
      macs,
      "macbook 16gb",
      true,
      "",
      "https://www.facebook.com/",
      "marketplace",
      "m(1|2)"
    );
    assert.deepEqual(
      cards.map((card) => card.id),
      ["700001", "700003"]
    );
  });

  it("keeps only listings inside any price range", () => {
    const macs = [
      listing({
        id: "800001",
        title: "MacBook Pro 16GB",
        description: "ok",
        price: "PHP 40,000"
      }),
      listing({
        id: "800002",
        title: "MacBook Air 16GB",
        description: "ok",
        price: "PHP 8,000"
      }),
      listing({
        id: "800003",
        title: "MacBook Mini 16GB",
        description: "ok",
        price: "PHP 7"
      }),
      listing({
        id: "800004",
        title: "MacBook Old 16GB",
        description: "ok",
        price: "PHP 2,000"
      })
    ];
    const cards = filterListings(
      macs,
      "macbook 16gb",
      true,
      "",
      "https://www.facebook.com/",
      "marketplace",
      "",
      "5000-10000 and 5-10"
    );
    assert.deepEqual(
      cards.map((card) => card.id),
      ["800002", "800003"]
    );
  });

  it("returns no cards when the advanced regex is invalid", () => {
    const cards = filterListings(rows, "civic 2015", true, "", "https://www.facebook.com/", "marketplace", "(");
    assert.equal(cards.length, 0);
  });

  it("returns no cards when a price range is invalid", () => {
    const cards = filterListings(
      rows,
      "civic 2015",
      true,
      "",
      "https://www.facebook.com/",
      "marketplace",
      "",
      "5000"
    );
    assert.equal(cards.length, 0);
  });

  it("drops listings without an openable item link", () => {
    const cards = filterListings(rows, "broken teaser", true, "");
    assert.equal(cards.length, 0);
  });

  it("drops marketplace listings without a price", () => {
    const cards = filterListings(rows, "civic 2015", true, "");
    assert.equal(
      cards.some((card) => card.id === "444444"),
      false
    );
  });

  it("searches buying chats by item or person", () => {
    const chats = [
      listing({
        id: "thread-1",
        numericId: "444444",
        title: "Honda Civic 2015",
        party: "Ana Seller",
        description: "Is this still available?",
        href: "https://www.facebook.com/marketplace/t/100200300/",
        kind: "buying",
        photo: "https://example.com/chat.jpg"
      })
    ];
    const cards = filterListings(chats, "ana", true, "", "https://www.facebook.com/", "buying");
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.kind, "buying");
  });

  it("shows every buying chat when the search is empty or matches nothing", () => {
    const chats = [
      listing({
        id: "thread-1",
        numericId: "444444",
        title: "Honda Civic 2015",
        party: "Ana Seller",
        href: "https://www.facebook.com/marketplace/t/100200300/",
        kind: "buying"
      }),
      listing({
        id: "thread-2",
        numericId: "555555",
        title: "MacBook Pro",
        party: "Ben Seller",
        href: "https://www.facebook.com/marketplace/t/200300400/",
        kind: "buying"
      })
    ];
    const empty = visibleListings(chats, "", true, "", "https://www.facebook.com/", "buying");
    assert.equal(empty.cards.length, 2);
    assert.equal(empty.showingAll, true);

    const miss = visibleListings(chats, "zzzz", true, "", "https://www.facebook.com/", "buying");
    assert.equal(miss.cards.length, 2);
    assert.equal(miss.showingAll, true);
  });

  it("keeps separate selling chats that share one item numericId", () => {
    const chats = [
      listing({
        id: "100200300",
        numericId: "1499308081930636",
        title: "Unused tires",
        party: "Buyer A",
        href: "https://www.facebook.com/marketplace/t/100200300/",
        kind: "selling"
      }),
      listing({
        id: "200300400",
        numericId: "1499308081930636",
        title: "Unused tires",
        party: "Buyer B",
        href: "https://www.facebook.com/marketplace/t/200300400/",
        kind: "selling"
      })
    ];
    const cards = filterListings(chats, "", true, "", "https://www.facebook.com/", "selling");
    assert.deepEqual(
      cards.map((card) => card.id),
      ["100200300", "200300400"]
    );
  });
});

describe("isUsableListing", () => {
  it("requires a real item link, https photo, and a price for marketplace", () => {
    assert.equal(
      isUsableListing(
        listing({
          id: "111111",
          title: "Civic",
          price: "PHP 280,000",
          photo: "https://example.com/civic.jpg",
          href: "https://www.facebook.com/marketplace/item/111111/"
        }),
        "marketplace"
      ),
      true
    );
    assert.equal(
      isUsableListing(
        listing({
          id: "111111",
          title: "Civic",
          price: "PHP 280,000",
          photo: "",
          href: "https://www.facebook.com/marketplace/item/111111/"
        }),
        "marketplace"
      ),
      false
    );
    assert.equal(
      isUsableListing(
        listing({
          id: "111111",
          title: "Mac mini",
          price: "",
          photo: "https://example.com/mac.jpg",
          href: "https://www.facebook.com/marketplace/item/111111/"
        }),
        "marketplace"
      ),
      false
    );
    assert.equal(
      isUsableListing(
        listing({
          id: "111111",
          title: "Mac mini",
          price: "Contact seller",
          photo: "https://example.com/mac.jpg",
          href: "https://www.facebook.com/marketplace/item/111111/"
        }),
        "marketplace"
      ),
      false
    );
    assert.equal(
      isUsableListing(listing({ id: "x", numericId: "", title: "Civic", href: "", photo: "" }), "marketplace"),
      false
    );
  });

  it("requires a real marketplace thread link for chats", () => {
    assert.equal(
      isUsableListing(
        listing({
          id: "100200300",
          title: "Civic",
          kind: "buying",
          href: "https://www.facebook.com/marketplace/t/100200300/",
          photo: ""
        }),
        "buying"
      ),
      true
    );
    assert.equal(
      isUsableListing(
        listing({
          id: "x",
          title: "Civic",
          kind: "buying",
          href: "https://www.facebook.com/marketplace/inbox?targetTab=BUYER",
          photo: ""
        }),
        "buying"
      ),
      false
    );
    assert.equal(
      isUsableListing(
        listing({
          id: "999888777",
          title: "Group chat",
          kind: "buying",
          href: "https://www.facebook.com/messages/t/999888777/",
          photo: ""
        }),
        "buying"
      ),
      false
    );
  });
});

describe("preferDescription", () => {
  it("keeps the longer real description over a title echo", () => {
    assert.equal(
      preferDescription("Honda Civic", "Honda Civic", "One owner, garage kept, clean papers"),
      "One owner, garage kept, clean papers"
    );
  });
});

describe("listingItemUrl", () => {
  it("builds an item url from the harvest origin", () => {
    assert.equal(
      listingItemUrl("123456", "https://web.facebook.com/marketplace/search/?query=civic"),
      "https://web.facebook.com/marketplace/item/123456/"
    );
  });
});

describe("clipText", () => {
  it("keeps short text and trims long text", () => {
    assert.equal(clipText("One owner"), "One owner");
    assert.equal(clipText("x".repeat(400)).endsWith("..."), true);
  });
});

describe("searchStatus", () => {
  it("explains the empty, loading, and match states", () => {
    assert.match(searchStatus("", false, 0, 0), /Type a search/);
    assert.match(searchStatus("", false, 4, 4, "buying"), /Final results|Showing all 4/);
    assert.match(searchStatus("civic", true, 0, 0, "buying"), /Loading Buying chats/);
    assert.match(searchStatus("iphone", true, 0, 0, "marketplace"), /Loading Market list/);
    assert.match(searchStatus("iphone", true, 3, 8, "marketplace"), /Loading more Market list|not final|Keep waiting/);
    assert.match(searchStatus("zzzz", false, 4, 4, "selling", true), /Final results|Showing all 4/);
    assert.match(searchStatus("civic", false, 2, 5), /2 of 5/);
    assert.match(searchStatus("civic", false, 2, 5), /Final results|view details/i);
  });
});
