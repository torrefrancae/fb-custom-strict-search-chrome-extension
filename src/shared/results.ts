import { compileMatchRegex, listingMatchesQuery, listingMatchesRegex } from "@src/shared/match";
import { compilePriceRanges, listingMatchesPriceRanges } from "@src/shared/price-range";
import { isOpenableHref, isUsableListing } from "@src/shared/listing-quality";
import type { ListingRecord, SearchMode } from "@src/shared/types";

export type ResultCard = {
  id: string;
  title: string;
  description: string;
  price: string;
  photo: string;
  photos: string[];
  href: string;
  kind: SearchMode | "listing";
  party: string;
};

export function listingItemUrl(numericId: string, href = "https://www.facebook.com/"): string {
  let origin = "https://www.facebook.com";
  try {
    origin = new URL(href).origin;
  } catch {
    /* keep the public Marketplace host */
  }
  return numericId ? `${origin}/marketplace/item/${numericId}/` : `${origin}/marketplace/`;
}

export function clipText(text: string, max = 360): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3)}...`;
}

function cardHref(listing: ListingRecord): string {
  if (isOpenableHref(listing.href)) {
    return listing.href;
  }
  return "";
}

function rowDescription(title: string, description: string, party: string): string {
  const parts: string[] = [];
  if (party && party !== title) {
    parts.push(party);
  }
  const clean = description.replace(/\s+/g, " ").trim();
  if (clean && clean.toLowerCase() !== title.trim().toLowerCase()) {
    parts.push(clean);
  }
  return parts.join(" · ");
}

export function filterListings(
  listings: ListingRecord[],
  query: string,
  substring: boolean,
  exclude: string,
  href = "https://www.facebook.com/",
  mode: SearchMode = "marketplace",
  matchRegex = "",
  priceRanges = ""
): ResultCard[] {
  const advanced = compileMatchRegex(matchRegex);
  if (advanced.pattern && !advanced.regex) {
    return [];
  }
  const prices = compilePriceRanges(priceRanges);
  if (prices.raw && (prices.error || prices.ranges.length === 0)) {
    return [];
  }
  const seen = new Set<string>();
  const cards: ResultCard[] = [];
  for (const listing of listings) {
    if (!isUsableListing(listing, mode)) {
      continue;
    }
    const id = listing.numericId || listing.id;
    if (!id || seen.has(id)) {
      continue;
    }
    const hayTitle = [listing.title, listing.party].filter(Boolean).join(" ");
    const hayDescription = [listing.description, listing.party].filter(Boolean).join(" ");
    if (!listingMatchesQuery(hayTitle, hayDescription, query, substring, exclude)) {
      continue;
    }
    if (
      !listingMatchesRegex(
        listing.title,
        listing.description,
        listing.price,
        listing.party,
        advanced
      )
    ) {
      continue;
    }
    if (!listingMatchesPriceRanges(listing.price, prices)) {
      continue;
    }
    const openHref = cardHref(listing);
    if (!openHref) {
      continue;
    }
    seen.add(id);
    cards.push({
      id,
      title: listing.title,
      description: rowDescription(listing.title, listing.description, listing.party),
      price: listing.price,
      photo: listing.photo || listing.photos[0] || "",
      photos: listing.photos.length ? listing.photos : listing.photo ? [listing.photo] : [],
      href: openHref,
      kind: listing.kind,
      party: listing.party
    });
  }
  return cards;
}

export type VisibleResult = {
  cards: ResultCard[];
  showingAll: boolean;
};

export function visibleListings(
  listings: ListingRecord[],
  query: string,
  substring: boolean,
  exclude: string,
  href = "https://www.facebook.com/",
  mode: SearchMode = "marketplace",
  matchRegex = "",
  priceRanges = ""
): VisibleResult {
  if (mode === "marketplace") {
    return {
      cards: query
        ? filterListings(listings, query, substring, exclude, href, mode, matchRegex, priceRanges)
        : [],
      showingAll: false
    };
  }

  const matched = filterListings(
    listings,
    query,
    substring,
    exclude,
    href,
    mode,
    matchRegex,
    priceRanges
  );
  if (matched.length > 0) {
    return { cards: matched, showingAll: !query };
  }

  const all = filterListings(listings, "", substring, exclude, href, mode, matchRegex, priceRanges);
  return { cards: all, showingAll: all.length > 0 };
}

export function searchStatus(
  query: string,
  loading: boolean,
  shown: number,
  total: number,
  mode: SearchMode = "marketplace",
  showingAllChats = false
): string {
  const place =
    mode === "buying" ? "Buying chats" : mode === "selling" ? "Selling chats" : "Market list";
  if (loading && total > 0) {
    if (mode !== "marketplace" && showingAllChats) {
      return `Still searching ${place} - ${total} chats collected so far.`;
    }
    if (query) {
      return `Still searching ${place} - ${shown} of ${total} match so far.`;
    }
    return `Still searching ${place} - ${total} collected so far.`;
  }
  if (mode !== "marketplace" && !query) {
    if (loading && total === 0) {
      return `Searching ${place} - scrolling inbox now.`;
    }
    if (total === 0) {
      return `No chats yet. Use Harvest if Facebook asks you to log in.`;
    }
    return `Search finished. Showing all ${total} ${place.toLowerCase()}. Type to narrow them down.`;
  }
  if (!query) {
    return "Type a search. Results open in a detail modal.";
  }
  if (loading && total === 0) {
    return `Searching ${place} for "${query}" - collecting results now.`;
  }
  if (total === 0) {
    return `Search finished. No results for "${query}". Use Harvest if Facebook asks you to log in.`;
  }
  if (showingAllChats) {
    return `Search finished. No matches for that search. Showing all ${total} ${place.toLowerCase()}.`;
  }
  return `Search finished. ${shown} of ${total} match. Click a row to view details.`;
}
