import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractFacebookPosts } from "@src/shared/facebook-extract";
import { isPostHref, isUsableListing } from "@src/shared/listing-quality";
import { parseFacebookBody } from "@src/shared/listing";
import { filterListings, visibleListings } from "@src/shared/results";
import { normalizeListing } from "@src/shared/listing-quality";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const liveSample = join(root, ".idea", "facebook-search-sample.json");

const synthetic = {
  data: {
    serpResponse: {
      results: {
        edges: [
          {
            node: {
              role: "TOP_PUBLIC_POSTS",
              rendering_strategy: {
                view_model: {
                  __typename: "SearchPostViewModel",
                  click_model: {
                    story: {
                      __typename: "Story",
                      post_id: "100200300400",
                      permalink_url:
                        "https://www.facebook.com/groups/123/posts/100200300400/",
                      actors: [{ name: "Ana Seller" }],
                      message: {
                        __typename: "TextWithEntities",
                        text: "For sale Honda Civic 2015 PHP 280,000 clean title"
                      },
                      attachments: [
                        {
                          media: {
                            __typename: "Photo",
                            image: { uri: "https://example.com/civic.jpg" }
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          {
            node: {
              role: "TOP_PUBLIC_POSTS",
              rendering_strategy: {
                view_model: {
                  __typename: "SearchPostViewModel",
                  click_model: {
                    story: {
                      __typename: "Story",
                      post_id: "200300400500",
                      permalink_url: "https://www.facebook.com/bob/posts/pfbid02example/",
                      actors: [{ name: "Bob Buyer" }],
                      comet_sections: {
                        content: {
                          story: {
                            message: {
                              __typename: "TextWithEntities",
                              text: "Looking for a MacBook Pro 16GB near Manila"
                            }
                          }
                        }
                      },
                      attachments: []
                    }
                  }
                }
              }
            }
          }
        ]
      }
    }
  }
};

describe("extractFacebookPosts", () => {
  it("reads synthetic facebook search stories", () => {
    const posts = extractFacebookPosts(synthetic);
    assert.equal(posts.length, 2);
    assert.equal(posts[0]?.id, "100200300400");
    assert.equal(posts[0]?.party, "Ana Seller");
    assert.match(posts[0]?.price || "", /280/);
    assert.equal(posts[0]?.photo, "https://example.com/civic.jpg");
    assert.equal(isUsableListing(posts[0]!, "facebook"), true);
    assert.equal(isUsableListing(posts[1]!, "facebook"), true);
  });

  it("reads a live facebook search graphql sample when present", () => {
    if (!existsSync(liveSample)) {
      return;
    }
    const payload = parseFacebookBody(readFileSync(liveSample, "utf8"));
    assert.ok(payload);
    const posts = extractFacebookPosts(payload);
    assert.ok(posts.length >= 3, `expected several posts, got ${posts.length}`);
    assert.equal(
      posts.every((post) => isUsableListing(post, "facebook") && isPostHref(post.href)),
      true
    );
  });
});

describe("facebook result filtering", () => {
  it("filters facebook posts like marketplace search", () => {
    const rows = [
      normalizeListing({
        id: "1",
        numericId: "1",
        title: "Honda Civic 2015",
        description: "For sale PHP 280,000",
        price: "PHP 280,000",
        photo: "https://example.com/a.jpg",
        href: "https://www.facebook.com/x/posts/pfbid01/",
        kind: "facebook",
        party: "Ana"
      }),
      normalizeListing({
        id: "2",
        numericId: "2",
        title: "Toyota Vios",
        description: "Daily driver",
        price: "",
        photo: "https://example.com/b.jpg",
        href: "https://www.facebook.com/y/posts/pfbid02/",
        kind: "facebook",
        party: "Ben"
      })
    ];
    const cards = filterListings(rows, "civic 2015", true, "", "https://www.facebook.com/", "facebook");
    assert.deepEqual(
      cards.map((card) => card.id),
      ["1"]
    );
    const empty = visibleListings(rows, "", true, "", "https://www.facebook.com/", "facebook");
    assert.equal(empty.cards.length, 0);
  });
});

describe("isPostHref", () => {
  it("keeps facebook post and group post links", () => {
    assert.equal(isPostHref("https://www.facebook.com/someone/posts/pfbid02abc/"), true);
    assert.equal(isPostHref("https://www.facebook.com/groups/123/posts/456789012345/"), true);
    assert.equal(isPostHref("https://www.facebook.com/marketplace/item/123/"), false);
  });
});
