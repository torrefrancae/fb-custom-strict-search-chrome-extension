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
    if (typeof record.short_name === "string") {
      return record.short_name.trim();
    }
  }
  return "";
}

function numericIdFrom(value: string): string {
  const match = value.match(/(\d{6,})/);
  return match ? match[1] : "";
}

function decodeId(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^\d{6,}$/.test(raw) || raw.includes("marketplace_thread") || raw.includes("message_thread")) {
    return raw;
  }
  try {
    const decoded =
      typeof atob === "function"
        ? atob(raw)
        : Buffer.from(raw, "base64").toString("utf8");
    if (decoded && /thread|message|\d{6,}/i.test(decoded)) {
      return decoded;
    }
  } catch {
    /* not base64 */
  }
  return raw;
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

function firstEdgeNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const edges = (value as Record<string, unknown>).edges;
  if (!Array.isArray(edges) || !edges[0] || typeof edges[0] !== "object") {
    return null;
  }
  const node = (edges[0] as Record<string, unknown>).node;
  return node && typeof node === "object" ? (node as Record<string, unknown>) : null;
}

function marketplaceListingNode(record: Record<string, unknown>): Record<string, unknown> | null {
  if (record.listing && typeof record.listing === "object") {
    return record.listing as Record<string, unknown>;
  }
  const threadData =
    record.marketplace_thread_data && typeof record.marketplace_thread_data === "object"
      ? (record.marketplace_thread_data as Record<string, unknown>)
      : null;
  if (threadData?.messageable_item && typeof threadData.messageable_item === "object") {
    return threadData.messageable_item as Record<string, unknown>;
  }
  return null;
}

function partyName(node: Record<string, unknown>): string {
  const participant = firstEdgeNode(node.other_participants);
  if (participant) {
    const actor =
      participant.messaging_actor && typeof participant.messaging_actor === "object"
        ? (participant.messaging_actor as Record<string, unknown>)
        : participant;
    const fromActor = asText(actor.short_name) || asText(actor.name) || asText(actor);
    if (fromActor) {
      return fromActor;
    }
  }
  const keys = ["other_user", "buyer", "seller", "participant", "messaging_actor", "user"];
  for (const key of keys) {
    const value = node[key];
    const name = asText(value);
    if (name) {
      return name;
    }
    if (value && typeof value === "object") {
      const nested =
        asText((value as Record<string, unknown>).short_name) ||
        asText((value as Record<string, unknown>).name);
      if (nested) {
        return nested;
      }
    }
  }
  const threadData =
    node.marketplace_thread_data && typeof node.marketplace_thread_data === "object"
      ? (node.marketplace_thread_data as Record<string, unknown>)
      : null;
  if (threadData?.seller && typeof threadData.seller === "object") {
    const seller = asText((threadData.seller as Record<string, unknown>).name);
    if (seller) {
      return seller;
    }
  }
  return "";
}

function snippetText(record: Record<string, unknown>): string {
  const message = firstEdgeNode(record.messages);
  if (message) {
    const fromMessage = asText(message.snippet) || asText(message.text) || asText(message.message);
    if (fromMessage) {
      return fromMessage;
    }
  }
  return (
    asText(record.snippet) ||
    asText(record.message_snippet) ||
    asText(record.latest_message) ||
    asText(record.text) ||
    ""
  );
}

function threadIdFromRecord(record: Record<string, unknown>): string {
  const key = record.thread_key;
  if (key && typeof key === "object") {
    const threadFbid = (key as Record<string, unknown>).thread_fbid;
    if (typeof threadFbid === "string" || typeof threadFbid === "number") {
      const id = numericIdFrom(String(threadFbid));
      if (id) {
        return id;
      }
    }
  }
  for (const candidate of [
    record.thread_key,
    record.thread_id,
    record.marketplace_thread_id,
    record.id
  ]) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      const decoded = decodeId(String(candidate));
      const id = numericIdFrom(decoded);
      if (id) {
        return id;
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
    /marketplace.*listing|GroupCommerceProductItem/i.test(typeName) ||
    Boolean(
      node.marketplace_listing_title ||
        node.listing_price ||
        node.primary_listing_photo ||
        node.marketplace_listing_id ||
        node.__isMarketplaceListingRenderable
    )
  );
}

function looksLikeThread(node: Record<string, unknown>): boolean {
  const typeName = String(node.__typename || "");
  if (/marketplace.*thread/i.test(typeName) || /commerce.*thread/i.test(typeName)) {
    return true;
  }
  if (node.marketplace_thread_id || node.marketplace_thread_data) {
    return true;
  }
  const listing = marketplaceListingNode(node);
  if (listing && looksLikeMarketplaceListing(listing)) {
    return Boolean(node.thread_key || node.messages || node.other_participants || typeName === "MessageThread");
  }
  return false;
}

export function extractInboxThreads(payload: unknown, mode: SearchMode): ListingRecord[] {
  if (mode !== "buying" && mode !== "selling") {
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
      const listingNode = marketplaceListingNode(record) || record;
      const title = listingTitle(listingNode) || listingTitle(record);
      const party = partyName(record);
      const snippet = snippetText(record);
      const threadId = threadIdFromRecord(record);
      const href = threadHref(threadId);
      if (href && isThreadHref(href) && (title || party)) {
        const itemId =
          numericIdFrom(String(listingNode.id || listingNode.listing_id || "")) ||
          numericIdFrom(String(record.listing_id || ""));
        const photos = uniquePhotos(pickPhotos(listingNode), pickPhotos(record));
        found.set(
          threadId,
          normalizeListing({
            id: threadId,
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
