import { kindForMode, isHttpsPhoto, isThreadHref, normalizeListing, uniquePhotos } from "@src/shared/listing-quality";
import type { ListingRecord, SearchMode } from "@src/shared/types";

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
  }
  return "";
}

function numericIdFrom(value: string): string {
  const match = value.match(/(\d{6,})/);
  return match ? match[1] : "";
}

function uriFromPhotoNode(candidate: unknown): string {
  if (!candidate || typeof candidate !== "object") {
    return "";
  }
  const record = candidate as Record<string, unknown>;
  const image = record.image || record;
  if (image && typeof image === "object") {
    const uri = (image as Record<string, unknown>).uri;
    if (typeof uri === "string" && isHttpsPhoto(uri)) {
      return uri;
    }
  }
  return "";
}

function pickPhotos(node: Record<string, unknown>): string[] {
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
  return uniquePhotos(urls);
}

function listingTitle(node: Record<string, unknown>): string {
  return (
    asText(node.marketplace_listing_title) ||
    asText(node.custom_title) ||
    asText(node.listing_title) ||
    asText(node.title) ||
    ""
  );
}

function partyName(node: Record<string, unknown>): string {
  const keys = ["other_user", "buyer", "seller", "participant", "messaging_actor", "user"];
  for (const key of keys) {
    const value = node[key];
    const name = asText(value);
    if (name) {
      return name;
    }
    if (value && typeof value === "object") {
      const nested = asText((value as Record<string, unknown>).name);
      if (nested) {
        return nested;
      }
    }
  }
  return "";
}

function threadHref(rawThreadId: string): string {
  const clean = String(rawThreadId || "")
    .replace(/^t_/, "")
    .trim();
  if (!/^\d{6,}$/.test(clean)) {
    return "";
  }
  return `https://www.facebook.com/marketplace/t/${clean}/`;
}

function looksLikeMarketplaceListing(node: Record<string, unknown>): boolean {
  const typeName = String(node.__typename || "");
  return (
    /marketplace.*listing/i.test(typeName) ||
    Boolean(
      node.marketplace_listing_title ||
        node.listing_price ||
        node.primary_listing_photo ||
        node.marketplace_listing_id
    )
  );
}

function looksLikeThread(node: Record<string, unknown>): boolean {
  const typeName = String(node.__typename || "");
  if (/marketplace.*thread/i.test(typeName) || /commerce.*thread/i.test(typeName)) {
    return true;
  }
  if (node.marketplace_thread_id) {
    return true;
  }
  /*
   * Messenger group chats also carry bare thread_key values. Only accept a
   * thread when it is tied to a marketplace listing payload.
   */
  const listing =
    node.listing && typeof node.listing === "object"
      ? (node.listing as Record<string, unknown>)
      : null;
  if (!listing || !looksLikeMarketplaceListing(listing)) {
    return false;
  }
  return Boolean(node.snippet || node.latest_message || node.message_snippet || node.thread_key);
}

export function extractInboxThreads(payload: unknown, mode: SearchMode): ListingRecord[] {
  if (mode === "marketplace") {
    return [];
  }

  const kind = kindForMode(mode);
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
    if (looksLikeThread(record)) {
      const listingNode =
        record.listing && typeof record.listing === "object"
          ? (record.listing as Record<string, unknown>)
          : record;
      const title = listingTitle(listingNode) || listingTitle(record);
      const party = partyName(record);
      const snippet =
        asText(record.snippet) ||
        asText(record.message_snippet) ||
        asText(record.latest_message) ||
        asText(record.text) ||
        "";
      const rawId = String(
        record.thread_key || record.thread_id || record.marketplace_thread_id || record.id || ""
      );
      const href = threadHref(rawId);
      if (!href || !isThreadHref(href)) {
        for (const value of Object.values(record)) {
          visit(value);
        }
        return;
      }
      const itemId =
        numericIdFrom(String(listingNode.id || listingNode.listing_id || "")) ||
        numericIdFrom(String(record.listing_id || ""));
      if (title || party) {
        const id = numericIdFrom(rawId) || rawId;
        const photos = uniquePhotos(pickPhotos(listingNode), pickPhotos(record));
        found.set(
          id,
          normalizeListing({
            id,
            numericId: itemId,
            title: title || party || "Marketplace chat",
            description: [snippet, party].filter(Boolean).join(" · "),
            price: "",
            photo: photos[0] || "",
            photos,
            href,
            kind,
            party
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
