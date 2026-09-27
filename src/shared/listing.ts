import { isHttpsPhoto, isUsableListing, normalizeListing, preferDescription, uniquePhotos } from "@src/shared/listing-quality";
import type { ListingRecord, SearchMode } from "@src/shared/types";

function listingItemUrl(numericId: string): string {
  return `https://www.facebook.com/marketplace/item/${numericId}/`;
}

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

function pickPrice(node: Record<string, unknown>): string {
  const raw = node.listing_price || node.formatted_price;
  if (typeof raw === "string") {
    return raw.trim();
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return (
      asText(record.formatted_amount) ||
      asText(record.formatted_amount_zeros_stripped) ||
      asText(record.text)
    );
  }
  return "";
}

function uriFromPhotoNode(candidate: unknown): string {
  if (!candidate || typeof candidate !== "object") {
    return "";
  }
  const record = candidate as Record<string, unknown>;
  const image = record.image || record.listing_image || record;
  if (image && typeof image === "object") {
    const uri = (image as Record<string, unknown>).uri;
    if (typeof uri === "string" && isHttpsPhoto(uri)) {
      return uri;
    }
  }
  if (typeof record.uri === "string" && isHttpsPhoto(record.uri)) {
    return record.uri;
  }
  return "";
}

function collectPhotoNodes(node: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const push = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        push(item);
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.edges)) {
      for (const edge of record.edges) {
        if (edge && typeof edge === "object") {
          push((edge as Record<string, unknown>).node || edge);
        }
      }
      return;
    }
    const uri = uriFromPhotoNode(record);
    if (uri) {
      urls.push(uri);
    }
  };

  push(node.primary_listing_photo);
  push(node.listing_photo);
  push(node.listing_photos);
  push(node.photos);
  push(node.image);
  push(node.photo);
  return urls;
}

function pickPhotos(node: Record<string, unknown>): string[] {
  return uniquePhotos(collectPhotoNodes(node));
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

  const attrs = node.attribute_data || node.marketplace_listing_attributes || node.attributes;
  if (Array.isArray(attrs)) {
    const parts: string[] = [];
    for (const item of attrs) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const label = asText(record.name) || asText(record.label);
      const value = asText(record.value) || asText(record.text);
      if (label && value) {
        parts.push(`${label}: ${value}`);
      } else if (value) {
        parts.push(value);
      }
    }
    if (parts.length) {
      return parts.join(" · ");
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
  const descriptions = new Map<string, string>();

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
    const rawId = String(record.id || record.listing_id || record.story_id || "");
    const numericId = numericIdFrom(rawId);
    const description = pickDescription(record);
    if (numericId && description) {
      const previous = descriptions.get(numericId) || "";
      if (description.length >= previous.length) {
        descriptions.set(numericId, description);
      }
    }

    const title = pickTitle(record);
    if (looksLikeListing(record, title)) {
      const listingId = numericId || numericIdFrom(title);
      if (!listingId) {
        for (const value of Object.values(record)) {
          visit(value);
        }
        return;
      }
      const id = listingId;
      const current = found.get(id);
      const nextDescription = preferDescription(
        title,
        pickDescription(record),
        preferDescription(title, descriptions.get(id) || "", current?.description || "")
      );
      const photos = uniquePhotos(pickPhotos(record), current?.photos, current?.photo);
      const next = normalizeListing({
        id,
        numericId: listingId,
        title: title.length >= (current?.title.length || 0) ? title : current?.title || "",
        description: nextDescription,
        price: pickPrice(record) || current?.price || "",
        photo: photos[0] || "",
        photos,
        href: listingItemUrl(listingId),
        kind: "listing",
        party: current?.party || ""
      });
      if (isUsableListing(next, "marketplace") || next.description) {
        found.set(id, next);
      }
    }

    for (const value of Object.values(record)) {
      visit(value);
    }
  };

  visit(payload);

  for (const [id, description] of descriptions) {
    const current = found.get(id);
    if (!current) {
      continue;
    }
    const next = normalizeListing({
      ...current,
      description: preferDescription(current.title, description, current.description)
    });
    found.set(id, next);
  }

  return [...found.values()].filter(
    (listing) => isUsableListing(listing, "marketplace") || Boolean(listing.description && listing.photo)
  );
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

export function threadIdFromHref(href: string): string {
  const match = href.match(/\/marketplace\/t\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

export function usableListings(listings: ListingRecord[], mode: SearchMode = "marketplace"): ListingRecord[] {
  return listings.filter((listing) => isUsableListing(listing, mode));
}
