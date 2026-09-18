import type { ListingRecord } from "@src/shared/types";

const TITLE_KEYS = [
  "marketplace_listing_title",
  "custom_title",
  "listing_title",
  "marketplace_listing_preview_title"
];

const DESCRIPTION_KEYS = [
  "redacted_description",
  "marketplace_listing_description",
  "listing_description",
  "description"
];

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.message === "string") {
      return record.message.trim();
    }
  }
  return "";
}

function numericIdFrom(value: string): string {
  const match = value.match(/(\d{6,})/);
  return match ? match[1] : "";
}

function pickTitle(node: Record<string, unknown>): string {
  for (const key of TITLE_KEYS) {
    const text = asText(node[key]);
    if (text) {
      return text;
    }
  }
  return "";
}

function pickDescription(node: Record<string, unknown>): string {
  for (const key of DESCRIPTION_KEYS) {
    const text = asText(node[key]);
    if (text) {
      return text;
    }
  }

  const story = node.story;
  if (story && typeof story === "object") {
    const message = (story as Record<string, unknown>).message;
    const text = asText(message);
    if (text) {
      return text;
    }
  }

  return "";
}

function looksLikeListing(node: Record<string, unknown>, title: string): boolean {
  if (!title) {
    return false;
  }

  return Boolean(
    node.listing_price ||
      node.formatted_price ||
      node.primary_listing_photo ||
      node.marketplace_listing_title ||
      node.custom_title ||
      node.is_sold === true ||
      node.is_sold === false
  );
}

export function extractListings(payload: unknown): ListingRecord[] {
  const found = new Map<string, ListingRecord>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    const record = node as Record<string, unknown>;
    const title = pickTitle(record);
    if (looksLikeListing(record, title)) {
      const rawId = String(record.id || record.listing_id || record.story_id || title);
      const numericId = numericIdFrom(rawId) || numericIdFrom(title);
      const id = numericId || rawId;
      const current = found.get(id);
      const description = pickDescription(record);
      if (!current || description.length > current.description.length) {
        found.set(id, {
          id,
          numericId,
          title,
          description
        });
      }
    }

    for (const value of Object.values(record)) {
      visit(value);
    }
  };

  visit(payload);
  return [...found.values()];
}

export function parseFacebookBody(text: string): unknown {
  const trimmed = text.replace(/^for \(;;\);/, "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function listingIdFromHref(href: string): string {
  const match = href.match(/\/marketplace\/item\/(\d+)/);
  return match ? match[1] : "";
}
