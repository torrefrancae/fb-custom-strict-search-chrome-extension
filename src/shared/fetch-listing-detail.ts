import { extractListingsFromText, descriptionNearId } from "@src/shared/hydrate";
import { extractListings, parseFacebookBody } from "@src/shared/listing";
import { isUsableListing, mergeListing, normalizeListing, preferDescription } from "@src/shared/listing-quality";
import type { ListingRecord } from "@src/shared/types";

function itemIdFromHref(href: string): string {
  const match = href.match(/\/marketplace\/item\/(\d{6,})/i);
  return match?.[1] || "";
}

function listingsFromHtml(html: string): ListingRecord[] {
  const found = new Map<string, ListingRecord>();
  const add = (listings: ListingRecord[]): void => {
    for (const listing of listings) {
      const key = listing.numericId || listing.id;
      if (!key) {
        continue;
      }
      found.set(key, mergeListing(found.get(key), normalizeListing(listing)));
    }
  };

  add(extractListingsFromText(html));
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const text = match[1] || "";
    if (!/marketplace_listing|redacted_description|listing_description/i.test(text)) {
      continue;
    }
    const cleaned = text.replace(/^<!--/, "").replace(/-->$/, "");
    const parsed = parseFacebookBody(cleaned);
    if (parsed) {
      add(extractListings(parsed));
    }
    add(extractListingsFromText(cleaned));
  }

  return [...found.values()];
}

export async function fetchListingDetail(href: string, id: string): Promise<ListingRecord | null> {
  if (!/^https:\/\/(www\.|web\.)?facebook\.com\/marketplace\/item\//i.test(href)) {
    return null;
  }

  const response = await fetch(href, {
    credentials: "include",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const targetId = id || itemIdFromHref(href);
  const listings = listingsFromHtml(html);
  const found = new Map(listings.map((listing) => [listing.numericId || listing.id, listing]));

  let exact = targetId ? found.get(targetId) : undefined;
  const nearDescription = targetId ? descriptionNearId(html, targetId) : "";
  if (exact && nearDescription) {
    exact = normalizeListing({
      ...exact,
      description: preferDescription(exact.title, nearDescription, exact.description)
    });
  } else if (!exact && targetId && nearDescription) {
    exact = normalizeListing({
      id: targetId,
      numericId: targetId,
      title: targetId,
      description: nearDescription,
      price: "",
      photo: "",
      photos: [],
      href: href.split("?")[0] || href,
      kind: "listing",
      party: ""
    });
  }

  if (exact) {
    if (exact.title === exact.numericId && listings[0]?.title) {
      exact = mergeListing(exact, listings[0]);
    }
    if (exact.description || isUsableListing(exact, "marketplace")) {
      return exact;
    }
  }

  const first = listings.find((listing) => listing.description || isUsableListing(listing, "marketplace"));
  return first || exact || null;
}
