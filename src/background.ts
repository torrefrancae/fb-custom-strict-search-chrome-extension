import { ListingStore } from "@src/content/store";
import { writeChatCache } from "@src/shared/chat-cache";
import { emptySnapshot, writeHarvest } from "@src/shared/harvest-state";
import { fetchListingDetail } from "@src/shared/fetch-listing-detail";
import { usableListings } from "@src/shared/listing";
import {
  harvestUrl,
  inboxTabFromHref,
  queryFromHref
} from "@src/shared/query";
import {
  RUNTIME_SOURCE,
  type FetchListingDetailResponse,
  type ListingRecord,
  type RuntimeMessage,
  type SearchMode,
  type SnapshotMessage
} from "@src/shared/types";

const MATCH = /https:\/\/(www\.|web\.)?facebook\.com\/marketplace\//i;
const store = new ListingStore();
let harvestTabId = 0;
let harvestQuery = "";
let harvestHref = "https://www.facebook.com";
let harvestMode: SearchMode = "marketplace";

function searchPageUrl(): string {
  return chrome.runtime.getURL("search/search.html");
}

function inject(tabId: number): void {
  void chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["content/main.js"],
      world: "MAIN"
    })
    .catch(() => undefined);
  void chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["content/isolated.js"]
    })
    .catch(() => undefined);
}

function snapshot(): SnapshotMessage {
  return {
    source: RUNTIME_SOURCE,
    type: "snapshot",
    query: harvestQuery,
    href: harvestHref,
    mode: harvestMode,
    listings: store.all()
  };
}

function broadcast(): void {
  const next = snapshot();
  void writeHarvest(next);
  void chrome.runtime.sendMessage(next, () => undefined);
}

function pingHarvest(tabId: number): void {
  void chrome.tabs
    .sendMessage(tabId, {
      source: RUNTIME_SOURCE,
      type: "start-harvest",
      mode: harvestMode
    })
    .catch(() => undefined);
}

async function openSearchPage(): Promise<void> {
  const url = searchPageUrl();
  const existing = await chrome.tabs.query({ url });
  const tab = existing[0];
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

async function focusHarvest(): Promise<void> {
  if (!harvestTabId) {
    return;
  }
  await chrome.tabs.update(harvestTabId, { active: true }).catch(() => undefined);
}

async function stayOnSmartSearch(preferredTabId?: number): Promise<void> {
  if (preferredTabId) {
    await chrome.tabs.update(preferredTabId, { active: true }).catch(() => undefined);
    return;
  }
  const searchTabs = await chrome.tabs.query({ url: searchPageUrl() });
  if (searchTabs[0]?.id) {
    await chrome.tabs.update(searchTabs[0].id, { active: true }).catch(() => undefined);
  }
}

async function openHarvest(query: string, mode: SearchMode, stayOnTabId?: number): Promise<void> {
  harvestQuery = query;
  harvestMode = mode;
  harvestHref = "https://www.facebook.com";
  store.clear();
  await writeHarvest({ ...emptySnapshot(query), mode });
  const url = harvestUrl("https://www.facebook.com", mode, query);
  const current = harvestTabId ? await chrome.tabs.get(harvestTabId).catch(() => undefined) : undefined;
  if (current?.id) {
    harvestTabId = current.id;
    await chrome.tabs.update(current.id, { url, active: false });
  } else {
    const found = await chrome.tabs.query({
      url: [
        "https://www.facebook.com/marketplace/search/*",
        "https://web.facebook.com/marketplace/search/*",
        "https://www.facebook.com/marketplace/inbox*",
        "https://web.facebook.com/marketplace/inbox*"
      ]
    });
    if (found[0]?.id) {
      harvestTabId = found[0].id;
      await chrome.tabs.update(found[0].id, { url, active: false });
    } else {
      const created = await chrome.tabs.create({ url, active: false });
      harvestTabId = created.id || 0;
    }
  }
  await stayOnSmartSearch(stayOnTabId);
}

async function resolveListingDetail(href: string, id: string): Promise<ListingRecord | null> {
  if (harvestTabId) {
    try {
      const reply = (await chrome.tabs.sendMessage(harvestTabId, {
        source: RUNTIME_SOURCE,
        type: "fetch-listing-detail",
        href,
        id
      })) as FetchListingDetailResponse | undefined;
      if (reply?.listing) {
        return reply.listing;
      }
    } catch {
      /* harvest tab may not be ready yet */
    }
  }
  return fetchListingDetail(href, id);
}

chrome.action.onClicked.addListener(() => {
  void openSearchPage();
});

async function fetchImageDataUrl(url: string): Promise<string> {
  if (!/^https:\/\//i.test(url)) {
    return "";
  }
  const response = await fetch(url, {
    credentials: "omit",
    referrer: "https://www.facebook.com/",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) {
    return "";
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  const mime = response.headers.get("content-type") || "image/jpeg";
  return `data:${mime};base64,${btoa(binary)}`;
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message?.source !== RUNTIME_SOURCE) {
    return;
  }
  if (message.type === "start-search") {
    void openHarvest(message.query, message.mode || "marketplace", sender.tab?.id).then(() => broadcast());
    return;
  }
  if (message.type === "focus-harvest") {
    void focusHarvest();
    return;
  }
  if (message.type === "fetch-image") {
    void fetchImageDataUrl(message.url)
      .then((dataUrl) => {
        sendResponse({
          source: RUNTIME_SOURCE,
          type: "fetch-image-result",
          url: message.url,
          dataUrl
        });
      })
      .catch(() => {
        sendResponse({
          source: RUNTIME_SOURCE,
          type: "fetch-image-result",
          url: message.url,
          dataUrl: ""
        });
      });
    return true;
  }
  if (message.type === "fetch-listing-detail") {
    void resolveListingDetail(message.href, message.id)
      .then((listing) => {
        if (listing) {
          store.merge([listing]);
          broadcast();
        }
        sendResponse({
          source: RUNTIME_SOURCE,
          type: "fetch-listing-detail-result",
          id: message.id,
          listing
        });
      })
      .catch(() => {
        sendResponse({
          source: RUNTIME_SOURCE,
          type: "fetch-listing-detail-result",
          id: message.id,
          listing: null
        });
      });
    return true;
  }
  if (message.type === "harvest-listings") {
    const fromHarvest = Boolean(harvestTabId && sender.tab?.id === harvestTabId);
    const fromQuery =
      harvestMode === "marketplace" &&
      Boolean(harvestQuery && queryFromHref(message.href) === harvestQuery);
    const fromInbox =
      (harvestMode === "buying" || harvestMode === "selling") &&
      inboxTabFromHref(message.href) === harvestMode;
    if (!fromHarvest && !fromQuery && !fromInbox) {
      return;
    }
    const mode = message.mode || harvestMode;
    const rows =
      mode === "buying" || mode === "selling"
        ? usableListings(message.listings, mode)
        : message.listings;
    store.merge(rows);
    harvestHref = message.href || harvestHref;
    if (message.mode) {
      harvestMode = message.mode;
    }
    if (harvestMode === "buying" || harvestMode === "selling") {
      void writeChatCache(harvestMode, store.all(), harvestHref);
    }
    broadcast();
    return;
  }
  if (message.type === "request-snapshot") {
    sendResponse(snapshot());
  }
});

function onMarketplaceNav(tabId: number, url: string): void {
  if (!MATCH.test(url)) {
    return;
  }
  inject(tabId);
  if (tabId === harvestTabId) {
    pingHarvest(tabId);
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) {
    onMarketplaceNav(details.tabId, details.url);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    onMarketplaceNav(details.tabId, details.url);
  }
});
