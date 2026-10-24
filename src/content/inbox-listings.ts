import { kindForMode, isHttpsPhoto, normalizeListing, uniquePhotos } from "@src/shared/listing-quality";
import { listingIdFromHref, threadIdFromHref } from "@src/shared/listing";
import type { ListingRecord, SearchMode } from "@src/shared/types";

const SKIP_LINE =
  /^(buying|selling|inbox|marketplace|all|unread|archived|filters?|see all|sponsored|marketplace access|browse all|notifications|create new listing|create multiple listings|location|categories|vehicles|property rentals|pending payment|paid|to be shipped|shipped|cash on delivery|completed|filter by label|within \d+)/i;

const TIME_RE =
  /^(?:\d{1,2}:\d{2}\s?(?:AM|PM|am|pm)?|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Yesterday|\d+[mhdw]|\d+\s*(?:min|mins|hour|hours|hr|hrs|day|days|week|weeks)(?:\s+ago)?)$/i;

function clean(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function textLines(root: HTMLElement): string[] {
  return (root.innerText || "")
    .split("\n")
    .map((line) => clean(line))
    .filter(Boolean)
    .filter((line) => !SKIP_LINE.test(line));
}

function photosFromRoot(root: HTMLElement): string[] {
  const urls: string[] = [];
  for (const img of root.querySelectorAll("img")) {
    for (const candidate of [img.currentSrc, img.src]) {
      if (candidate && isHttpsPhoto(candidate)) {
        urls.push(candidate);
      }
    }
  }
  return uniquePhotos(urls);
}

function onMarketplaceInbox(): boolean {
  try {
    return /\/marketplace\/inbox/i.test(window.location.pathname);
  } catch {
    return false;
  }
}

function threadIdAny(href: string): string {
  const match = href.match(/\/(?:marketplace|messages)\/t\/([^/?#]+)/i);
  if (!match?.[1]) {
    return "";
  }
  return decodeURIComponent(match[1]).replace(/^t_/, "");
}

function marketplaceThreadHref(href: string): string {
  const id = threadIdAny(href);
  if (!/^\d{6,}$/.test(id)) {
    return "";
  }
  return `https://www.facebook.com/marketplace/t/${id}/`;
}

function closestRow(anchor: HTMLElement): HTMLElement {
  let current: HTMLElement | null = anchor;
  let candidate = anchor;
  while (current && current.parentElement && current !== document.body) {
    const parent = current.parentElement;
    const links = parent.querySelectorAll(
      'a[href*="/marketplace/t/"], a[href*="/messages/t/"], a[href*="/marketplace/item/"], a[href*="/marketplace/inbox"]'
    ).length;
    if (links <= 2 && parent.childElementCount <= 12) {
      candidate = parent;
    }
    if (parent.getAttribute("role") === "row" || parent.getAttribute("role") === "listitem") {
      return parent;
    }
    current = parent;
  }
  return candidate;
}

function pickTitle(lines: string[], party: string): string {
  for (const line of lines) {
    if (party && line === party) {
      continue;
    }
    if (TIME_RE.test(line) && line.length < 28) {
      continue;
    }
    return line.replace(/^·\s*/, "");
  }
  return party || "Marketplace chat";
}

function stableId(party: string, title: string, href: string): string {
  const thread = threadIdFromHref(href);
  if (thread) {
    return thread;
  }
  const item = listingIdFromHref(href);
  if (item) {
    return item;
  }
  return `chat:${party.toLowerCase()}|${title.toLowerCase()}`.slice(0, 180);
}

function addListing(
  found: Map<string, ListingRecord>,
  partial: Parameters<typeof normalizeListing>[0]
): void {
  const listing = normalizeListing(partial);
  if (!listing.title) {
    return;
  }
  const current = found.get(listing.id);
  if (!current) {
    found.set(listing.id, listing);
    return;
  }
  const preferNextHref = /\/marketplace\/t\//i.test(listing.href);
  const keepHref =
    preferNextHref || !/\/marketplace\/t\//i.test(current.href)
      ? listing.href || current.href
      : current.href;
  const photos = uniquePhotos(listing.photos, current.photos, listing.photo, current.photo);
  found.set(listing.id, {
    ...current,
    title: listing.title.length >= current.title.length ? listing.title : current.title,
    description:
      listing.description.length >= current.description.length
        ? listing.description
        : current.description,
    photo: photos[0] || "",
    photos,
    href: keepHref,
    party: listing.party || current.party,
    numericId: listing.numericId || current.numericId
  });
}

function fromAnchors(root: ParentNode, mode: SearchMode, found: Map<string, ListingRecord>): void {
  const kind = kindForMode(mode);
  /*
   * Marketplace inbox rows often use /messages/t/ in the DOM. Rewrite those to
   * /marketplace/t/ only while we are on the Marketplace inbox page.
   */
  const selector = onMarketplaceInbox()
    ? 'a[href*="/marketplace/t/"], a[href*="/messages/t/"]'
    : 'a[href*="/marketplace/t/"]';
  const anchors = root.querySelectorAll<HTMLAnchorElement>(selector);

  for (const anchor of anchors) {
    const raw = (anchor.href || "").split("#")[0] || "";
    const href = marketplaceThreadHref(raw);
    if (!href) {
      continue;
    }
    const row = closestRow(anchor);
    const lines = textLines(row);
    if (lines.length < 1) {
      continue;
    }
    const party = lines[0] || "";
    const title = pickTitle(lines.slice(party ? 1 : 0), party);
    if (!title || SKIP_LINE.test(title) || SKIP_LINE.test(party)) {
      continue;
    }
    const description = lines.filter((line) => line !== title && line !== party).join(" · ");
    const id = stableId(party, title, href);
    const photos = photosFromRoot(row);
    addListing(found, {
      id,
      numericId: listingIdFromHref(href) || threadIdAny(href),
      title,
      description,
      price: "",
      photo: photos[0] || "",
      photos,
      href,
      kind,
      party
    });
  }
}

function fromTextLines(root: ParentNode, mode: SearchMode, found: Map<string, ListingRecord>): void {
  const kind = kindForMode(mode);
  const host = root instanceof Document ? root.body : root instanceof HTMLElement ? root : null;
  if (!host) {
    return;
  }

  /*
   * Text-only rows fill title/party when a real thread link was already found
   * for the same chat. They are never shown alone, because they have no openable
   * thread URL and would open a dead product page.
   */
  const lines = (host.innerText || "")
    .split(/\n+/)
    .map((line) => clean(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const party = lines[index] || "";
    const meta = lines[index + 1] || "";
    if (SKIP_LINE.test(party) || party.length > 80) {
      continue;
    }

    let title = "";
    let snippet = "";
    if (/^·\s+/.test(meta)) {
      title = meta.replace(/^·\s*/, "");
      snippet = lines[index + 2] || "";
    } else {
      continue;
    }

    if (!title || SKIP_LINE.test(title) || /^Within\b/i.test(title)) {
      continue;
    }
    if (TIME_RE.test(snippet)) {
      snippet = "";
    }

    const id = stableId(party, title, "");
    const current = found.get(id);
    if (!current) {
      continue;
    }
    addListing(found, {
      id,
      numericId: current.numericId,
      title,
      description: [snippet, party].filter(Boolean).join(" · "),
      price: "",
      photo: current.photo,
      photos: current.photos,
      href: current.href,
      kind,
      party
    });
  }
}

export function listingsFromInbox(
  root: ParentNode = document,
  mode: SearchMode = "buying"
): ListingRecord[] {
  if (mode !== "buying" && mode !== "selling") {
    return [];
  }
  const found = new Map<string, ListingRecord>();
  fromAnchors(root, mode, found);
  fromTextLines(root, mode, found);
  return [...found.values()];
}
