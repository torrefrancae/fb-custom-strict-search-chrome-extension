import {
  isHttpsPhoto,
  isPostHref,
  kindForMode,
  normalizeListing,
  uniquePhotos
} from "@src/shared/listing-quality";
import { parsePriceAmount } from "@src/shared/price-range";
import type { ListingRecord } from "@src/shared/types";

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (typeof record.name === "string") {
      return record.name.trim();
    }
    if (typeof record.short_name === "string") {
      return record.short_name.trim();
    }
  }
  return "";
}

function cleanPostHref(href: string): string {
  try {
    const url = new URL(href, "https://www.facebook.com");
    if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) {
      return "";
    }
    const keep = new URLSearchParams();
    for (const key of ["fbid", "id", "story_fbid", "set"]) {
      const value = url.searchParams.get(key);
      if (value) {
        keep.set(key, value);
      }
    }
    url.search = keep.toString();
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function actorName(node: Record<string, unknown>): string {
  if (Array.isArray(node.actors) && node.actors[0]) {
    const name = asText(node.actors[0]);
    if (name) {
      return name;
    }
  }
  return asText(node.owning_profile) || asText(node.author) || "";
}

function messageText(node: Record<string, unknown>): string {
  const direct = asText(node.message) || asText(node.story_message) || asText(node.message_text);
  if (direct) {
    return direct;
  }
  let best = "";
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== "object" || depth > 8) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    if (
      record.__typename === "TextWithEntities" &&
      typeof record.text === "string" &&
      record.text.trim().length > best.length
    ) {
      best = record.text.trim();
    }
    for (const nested of Object.values(record)) {
      visit(nested, depth + 1);
    }
  };
  visit(node.comet_sections, 0);
  visit(node.message, 0);
  visit(node.attachments, 0);
  return best;
}

function titleFromMessage(message: string, party: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const first = lines[0] || "";
  if (first) {
    return first.length > 120 ? `${first.slice(0, 117)}...` : first;
  }
  return party || "Facebook post";
}

function priceFromText(text: string): string {
  const match = text.match(
    /(?:php|usd|eur|gbp|cad|aud|₱|\$|€|£)\s?[\d,.]+(?:\s?(?:k|m))?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s?(?:k|m)\b/i
  );
  if (!match) {
    return "";
  }
  const raw = match[0].trim();
  return parsePriceAmount(raw) === null ? "" : raw;
}

function pickStoryPhotos(node: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (!value || typeof value !== "object" || depth > 10 || urls.length >= 12) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.uri === "string" && isHttpsPhoto(record.uri)) {
      urls.push(record.uri);
    }
    if (record.image && typeof record.image === "object") {
      const uri = (record.image as Record<string, unknown>).uri;
      if (typeof uri === "string" && isHttpsPhoto(uri)) {
        urls.push(uri);
      }
    }
    for (const nested of Object.values(record)) {
      visit(nested, depth + 1);
    }
  };
  visit(node.attachments, 0);
  visit(node.comet_sections, 0);
  return uniquePhotos(urls);
}

function looksLikeStory(node: Record<string, unknown>): boolean {
  if (String(node.__typename || "") !== "Story") {
    return false;
  }
  const postId = String(node.post_id || "");
  const href = cleanPostHref(String(node.permalink_url || node.url || ""));
  return Boolean(postId && href && isPostHref(href));
}

export function extractFacebookPosts(payload: unknown): ListingRecord[] {
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
    if (looksLikeStory(record)) {
      const postId = String(record.post_id || "");
      const href = cleanPostHref(String(record.permalink_url || record.url || ""));
      const message = messageText(record);
      const party = actorName(record);
      const title = titleFromMessage(message, party);
      const photos = pickStoryPhotos(record);
      const price = priceFromText(message);
      if (postId && href && title) {
        const current = found.get(postId);
        const nextPhotos = uniquePhotos(photos, current?.photos, current?.photo);
        found.set(
          postId,
          normalizeListing({
            id: postId,
            numericId: postId,
            title: title.length >= (current?.title.length || 0) ? title : current?.title || title,
            description: message.length >= (current?.description.length || 0) ? message : current?.description || "",
            price: price || current?.price || "",
            photo: nextPhotos[0] || "",
            photos: nextPhotos,
            href,
            kind: kindForMode("facebook"),
            party: party || current?.party || ""
          })
        );
      }
    }

    for (const value of Object.values(record)) {
      visit(value);
    }
  };

  visit(payload);
  return [...found.values()];
}
