import { extractListings, parseFacebookBody } from "@src/shared/listing";
import type { ListingRecord } from "@src/shared/types";

function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

export function extractListingsFromText(text: string): ListingRecord[] {
  const found = new Map<string, ListingRecord>();
  const titleRe = /"marketplace_listing_title"\s*:\s*"((?:\\.|[^"\\])*)"/g;

  for (const match of text.matchAll(titleRe)) {
    const title = unescapeJson(match[1] || "");
    const index = match.index || 0;
    const slice = text.slice(Math.max(0, index - 900), Math.min(text.length, index + 1800));
    const idMatch =
      slice.match(/marketplace_listing:(\d{6,})/) ||
      slice.match(/\/marketplace\/item\/(\d{6,})/) ||
      slice.match(/"id"\s*:\s*"(\d{6,})"/);
    const descMatch =
      slice.match(/"redacted_description"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
      slice.match(/"marketplace_listing_description"\s*:\s*"((?:\\.|[^"\\])*)"/);
    const numericId = idMatch?.[1] || "";
    const id = numericId || title;
    const description = descMatch ? unescapeJson(descMatch[1] || "") : "";
    const current = found.get(id);
    if (!current || description.length > current.description.length) {
      found.set(id, { id, numericId, title, description });
    }
  }

  return [...found.values()];
}

export function extractListingsFromDocument(doc: Document): ListingRecord[] {
  const merged = new Map<string, ListingRecord>();

  const add = (listings: ListingRecord[]): void => {
    for (const listing of listings) {
      const current = merged.get(listing.id);
      if (!current || listing.description.length > current.description.length) {
        merged.set(listing.id, listing);
      }
    }
  };

  for (const script of doc.querySelectorAll("script")) {
    const text = script.textContent || "";
    if (!text.includes("marketplace_listing")) {
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
