import { isUsableListing } from "@src/shared/listing-quality";
import type { ListingRecord, SearchMode } from "@src/shared/types";

export type ChatCacheSnapshot = {
  mode: "buying" | "selling";
  href: string;
  updatedAt: number;
  listings: ListingRecord[];
};

type StorageArea = {
  get: (keys: string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;
  set: (value: Record<string, unknown>) => Promise<void>;
};

function local(): StorageArea | undefined {
  return (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome?.storage?.local;
}

function keyFor(mode: "buying" | "selling"): string {
  return mode === "buying" ? "chat-cache-buying" : "chat-cache-selling";
}

function empty(mode: "buying" | "selling"): ChatCacheSnapshot {
  return {
    mode,
    href: "https://www.facebook.com/marketplace/inbox",
    updatedAt: 0,
    listings: []
  };
}

function asChatMode(mode: SearchMode): "buying" | "selling" | "" {
  return mode === "buying" || mode === "selling" ? mode : "";
}

function sanitize(mode: "buying" | "selling", listings: ListingRecord[]): ListingRecord[] {
  const seen = new Set<string>();
  const out: ListingRecord[] = [];
  for (const listing of listings) {
    if (!isUsableListing(listing, mode) || seen.has(listing.id)) {
      continue;
    }
    seen.add(listing.id);
    out.push(listing);
  }
  return out;
}

export async function readChatCache(mode: SearchMode): Promise<ChatCacheSnapshot> {
  const chatMode = asChatMode(mode);
  if (!chatMode) {
    return empty("buying");
  }
  const stored = await local()?.get([keyFor(chatMode)]);
  const value = stored?.[keyFor(chatMode)];
  if (!value || typeof value !== "object") {
    return empty(chatMode);
  }
  const snap = value as Partial<ChatCacheSnapshot>;
  const listings = Array.isArray(snap.listings) ? sanitize(chatMode, snap.listings) : [];
  return {
    mode: chatMode,
    href: typeof snap.href === "string" ? snap.href : empty(chatMode).href,
    updatedAt: typeof snap.updatedAt === "number" ? snap.updatedAt : 0,
    listings
  };
}

export async function writeChatCache(
  mode: SearchMode,
  listings: ListingRecord[],
  href = ""
): Promise<void> {
  const chatMode = asChatMode(mode);
  const api = local();
  if (!chatMode || !api) {
    return;
  }
  const cleaned = sanitize(chatMode, listings);
  if (!cleaned.length) {
    return;
  }
  const previous = await readChatCache(chatMode);
  await api.set({
    [keyFor(chatMode)]: {
      mode: chatMode,
      href: href || previous.href,
      updatedAt: Date.now(),
      listings: cleaned
    } satisfies ChatCacheSnapshot
  });
}
