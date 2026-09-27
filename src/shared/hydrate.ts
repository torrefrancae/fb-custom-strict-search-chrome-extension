import { extractListings, parseFacebookBody } from "@src/shared/listing";
import {
  isUsableListing,
  mergeListing,
  normalizeListing,
  preferDescription,
  uniquePhotos
} from "@src/shared/listing-quality";
import type { ListingRecord } from "@src/shared/types";

function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

const DESCRIPTION_PATTERNS = [
  /"redacted_description"\s*:\s*\{\s*(?:[^{}]*?)"text"\s*:\s*"((?:\\.|[^"\\])*)"/,
  /"marketplace_listing_description"\s*:\s*"((?:\\.|[^"\\])*)"/,
  /"listing_description"\s*:\s*"((?:\\.|[^"\\])*)"/,
  /"share_commerce_description"\s*:\s*"((?:\\.|[^"\\])*)"/
];

function readDescription(slice: string): string {
  for (const pattern of DESCRIPTION_PATTERNS) {
    const match = slice.match(pattern);
    if (match?.[1]) {
      return unescapeJson(match[1]).trim();
    }
  }
  return "";
}

export function descriptionNearId(text: string, id: string): string {
  if (!id || !text) {
    return "";
  }
  const markers = [
    `marketplace_listing:${id}`,
    `/marketplace/item/${id}`,
    `"id":"${id}"`,
    `"id": "${id}"`
  ];
  let best = "";
  for (const marker of markers) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(marker, from);
      if (index < 0) {
        break;
      }
      const slice = text.slice(Math.max(0, index - 4000), Math.min(text.length, index + 12000));
      const description = readDescription(slice);
      if (description.length > best.length) {
        best = description;
      }
      from = index + marker.length;
    }
  }
  if (best) {
    return best;
  }

  /*
   * Some item pages put the description far from the id token. Fall back to the
   * longest redacted_description block on the page when we already know the item id.
   */
  for (const match of text.matchAll(/"redacted_description"\s*:\s*\{\s*(?:[^{}]*?)"text"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    const description = unescapeJson(match[1] || "").trim();
    if (description.length > best.length) {
      best = description;
    }
  }
  return best;
}

export function extractListingsFromText(text: string): ListingRecord[] {
  const found = new Map<string, ListingRecord>();
  const titleRe = /"marketplace_listing_title"\s*:\s*"((?:\\.|[^"\\])*)"/g;

  for (const match of text.matchAll(titleRe)) {
    const title = unescapeJson(match[1] || "");
    const index = match.index || 0;
    const slice = text.slice(Math.max(0, index - 2500), Math.min(text.length, index + 8000));
    const idMatch =
      slice.match(/marketplace_listing:(\d{6,})/) ||
      slice.match(/\/marketplace\/item\/(\d{6,})/) ||
      slice.match(/"id"\s*:\s*"(\d{6,})"/);
    const numericId = idMatch?.[1] || "";
    if (!numericId) {
      continue;
    }
    const current = found.get(numericId);
    const description = preferDescription(
      title,
      readDescription(slice) || descriptionNearId(text, numericId),
      current?.description || ""
    );
    const photos = uniquePhotos(
      [...slice.matchAll(/"uri"\s*:\s*"(https:\\\/\\\/[^"]+|https:\/\/[^"]+)"/g)].map((hit) =>
        unescapeJson(hit[1] || "").replace(/\\\//g, "/")
      ),
      current?.photos,
      current?.photo
    );
    const next = normalizeListing({
      id: numericId,
      numericId,
      title,
      description,
      price: current?.price || "",
      photo: photos[0] || "",
      photos,
      href: `https://www.facebook.com/marketplace/item/${numericId}/`,
      kind: "listing",
      party: ""
    });
    if (photos.length || isUsableListing(next, "marketplace")) {
      found.set(numericId, next);
    } else if (description) {
      found.set(numericId, next);
    }
  }

  return [...found.values()];
}

export function extractListingsFromDocument(doc: Document): ListingRecord[] {
  const merged = new Map<string, ListingRecord>();

  const add = (listings: ListingRecord[]): void => {
    for (const listing of listings) {
      const key = listing.numericId || listing.id;
      if (!/^\d{6,}$/.test(key)) {
        continue;
      }
      merged.set(key, mergeListing(merged.get(key), listing));
    }
  };

  for (const script of doc.querySelectorAll("script")) {
    const text = script.textContent || "";
    if (!text.includes("marketplace_listing") && !text.includes("redacted_description")) {
      continue;
    }
    const parsed = parseFacebookBody(text);
    if (parsed) {
      add(extractListings(parsed));
    }
    add(extractListingsFromText(text));
  }

  return [...merged.values()];
}
