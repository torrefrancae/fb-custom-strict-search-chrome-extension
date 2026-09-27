import { parsePriceAmount } from "@src/shared/price-range";
import type { ListingKind, ListingRecord, SearchMode } from "@src/shared/types";

const MAX_PHOTOS = 12;

export function isHttpsPhoto(photo: string): boolean {
  return /^https:\/\//i.test(photo) && !/data:|blob:/i.test(photo);
}

export function uniquePhotos(...groups: Array<string | string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group ? [group] : [];
    for (const raw of list) {
      const photo = String(raw || "").trim();
      if (!isHttpsPhoto(photo) || seen.has(photo)) {
        continue;
      }
      seen.add(photo);
      out.push(photo);
      if (out.length >= MAX_PHOTOS) {
        return out;
      }
    }
  }
  return out;
}

export function normalizeListing(partial: Partial<ListingRecord> & Pick<ListingRecord, "id" | "title">): ListingRecord {
  const photos = uniquePhotos(partial.photos, partial.photo);
  return {
    id: partial.id,
    numericId: partial.numericId || "",
    title: partial.title.trim(),
    description: (partial.description || "").trim(),
    price: (partial.price || "").trim(),
    photo: photos[0] || "",
    photos,
    href: (partial.href || "").trim(),
    kind: partial.kind || "listing",
    party: (partial.party || "").trim()
  };
}

export function itemIdFromHref(href: string): string {
  try {
    const match = new URL(href, "https://www.facebook.com").pathname.match(
      /\/marketplace\/item\/(\d{6,})/i
    );
    return match?.[1] || "";
  } catch {
    return "";
  }
}

export function isItemHref(href: string): boolean {
  return Boolean(itemIdFromHref(href));
}

export function isThreadHref(href: string): boolean {
  if (!href) {
    return false;
  }
  try {
    const url = new URL(href, "https://www.facebook.com");
    if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) {
      return false;
    }
    return /\/marketplace\/t\/[^/?#]+/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isOpenableHref(href: string): boolean {
  return isItemHref(href) || isThreadHref(href);
}

export function isUsableListing(listing: ListingRecord, mode: SearchMode = "marketplace"): boolean {
  if (!listing.title.trim()) {
    return false;
  }

  if (mode === "marketplace") {
    const itemId = itemIdFromHref(listing.href) || (/^\d{6,}$/.test(listing.numericId) ? listing.numericId : "");
    if (!itemId || !isItemHref(listing.href)) {
      return false;
    }
    if (listing.numericId && listing.numericId !== itemId) {
      return false;
    }
    if (parsePriceAmount(listing.price) === null) {
      return false;
    }
    return listing.photos.some(isHttpsPhoto) || isHttpsPhoto(listing.photo);
  }

  return isThreadHref(listing.href);
}

export function kindForMode(mode: SearchMode): ListingKind {
  if (mode === "buying") {
    return "buying";
  }
  if (mode === "selling") {
    return "selling";
  }
  return "listing";
}

export function preferDescription(title: string, first: string, second: string): string {
  const score = (value: string): number => {
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) {
      return 0;
    }
    const lower = text.toLowerCase();
    const titleLower = title.trim().toLowerCase();
    if (titleLower && lower === titleLower) {
      return 1;
    }
    if (titleLower && lower.startsWith(titleLower) && text.length <= titleLower.length + 48) {
      return 2;
    }
    return 10 + Math.min(text.length, 800);
  };
  return score(first) >= score(second) ? first.trim() : second.trim();
}

export function mergeListing(previous: ListingRecord | undefined, next: ListingRecord): ListingRecord {
  if (!previous) {
    return next;
  }
  const href = isOpenableHref(next.href)
    ? next.href
    : isOpenableHref(previous.href)
      ? previous.href
      : next.href || previous.href;
  const photos = uniquePhotos(next.photos, previous.photos, next.photo, previous.photo);
  const title = next.title.length >= previous.title.length ? next.title : previous.title;
  return {
    id: next.id || previous.id,
    numericId: next.numericId || previous.numericId,
    title,
    description: preferDescription(title, next.description, previous.description),
    price: next.price || previous.price,
    photo: photos[0] || "",
    photos,
    href,
    kind: next.kind || previous.kind,
    party: next.party || previous.party
  };
}
