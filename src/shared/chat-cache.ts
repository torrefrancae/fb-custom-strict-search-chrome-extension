import { isUsableListing } from "@src/shared/listing-quality";
import type { ListingRecord, SearchMode } from "@src/shared/types";

export type ChatCacheSnapshot = {
  mode: "buying" | "selling";
  href: string;
  updatedAt: number;
  listings: ListingRecord[];
};

const DIR_NAME = "chat-cache";
const memory = new Map<string, ChatCacheSnapshot>();

type StorageArea = {
  get: (keys: string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;
  remove: (keys: string | string[]) => Promise<void>;
};

function local(): StorageArea | undefined {
  return (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome?.storage?.local;
}

function fileName(mode: "buying" | "selling"): string {
  return `${mode}.json`;
}

function legacyKey(mode: "buying" | "selling"): string {
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

function leanListing(listing: ListingRecord): ListingRecord {
  const photos = listing.photos.filter((photo) => /^https:\/\//i.test(photo)).slice(0, 12);
  return {
    ...listing,
    photo: photos[0] || (/^https:\/\//i.test(listing.photo) ? listing.photo : ""),
    photos
  };
}

function sanitize(mode: "buying" | "selling", listings: ListingRecord[]): ListingRecord[] {
  const seen = new Set<string>();
  const out: ListingRecord[] = [];
  for (const listing of listings) {
    const next = leanListing(listing);
    if (!isUsableListing(next, mode) || seen.has(next.id)) {
      continue;
    }
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

async function cacheDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const storage = (
      globalThis as {
        navigator?: { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } };
      }
    ).navigator?.storage;
    if (!storage?.getDirectory) {
      return null;
    }
    const root = await storage.getDirectory();
    return root.getDirectoryHandle(DIR_NAME, { create: true });
  } catch {
    return null;
  }
}

async function readFile(mode: "buying" | "selling"): Promise<ChatCacheSnapshot | null> {
  const dir = await cacheDir();
  if (!dir) {
    return memory.get(mode) || null;
  }
  try {
    const handle = await dir.getFileHandle(fileName(mode));
    const file = await handle.getFile();
    const raw = JSON.parse(await file.text()) as Partial<ChatCacheSnapshot>;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return {
      mode,
      href: typeof raw.href === "string" ? raw.href : empty(mode).href,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
      listings: Array.isArray(raw.listings) ? sanitize(mode, raw.listings) : []
    };
  } catch {
    return null;
  }
}

async function writeFile(snap: ChatCacheSnapshot): Promise<void> {
  memory.set(snap.mode, snap);
  const dir = await cacheDir();
  if (!dir) {
    return;
  }
  const handle = await dir.getFileHandle(fileName(snap.mode), { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(snap));
  await writable.close();
}

async function migrateLegacy(mode: "buying" | "selling"): Promise<ChatCacheSnapshot | null> {
  const api = local();
  if (!api) {
    return null;
  }
  try {
    const key = legacyKey(mode);
    const stored = await api.get([key]);
    const value = stored?.[key];
    if (!value || typeof value !== "object") {
      return null;
    }
    const snap = value as Partial<ChatCacheSnapshot>;
    const next: ChatCacheSnapshot = {
      mode,
      href: typeof snap.href === "string" ? snap.href : empty(mode).href,
      updatedAt: typeof snap.updatedAt === "number" ? snap.updatedAt : Date.now(),
      listings: Array.isArray(snap.listings) ? sanitize(mode, snap.listings) : []
    };
    if (next.listings.length) {
      await writeFile(next);
    }
    await api.remove(key);
    return next.listings.length ? next : null;
  } catch {
    return null;
  }
}

export async function readChatCache(mode: SearchMode): Promise<ChatCacheSnapshot> {
  const chatMode = asChatMode(mode);
  if (!chatMode) {
    return empty("buying");
  }
  const fromFile = await readFile(chatMode);
  if (fromFile?.listings.length) {
    return fromFile;
  }
  const migrated = await migrateLegacy(chatMode);
  if (migrated?.listings.length) {
    return migrated;
  }
  return fromFile || empty(chatMode);
}

export async function writeChatCache(
  mode: SearchMode,
  listings: ListingRecord[],
  href = ""
): Promise<void> {
  const chatMode = asChatMode(mode);
  if (!chatMode) {
    return;
  }
  const cleaned = sanitize(chatMode, listings);
  if (!cleaned.length) {
    return;
  }
  const previous = await readChatCache(chatMode);
  await writeFile({
    mode: chatMode,
    href: href || previous.href,
    updatedAt: Date.now(),
    listings: cleaned
  });
}
