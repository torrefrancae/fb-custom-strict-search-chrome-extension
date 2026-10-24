import { ListingStore } from "@src/content/store";
import { readChatCache, writeChatCache } from "@src/shared/chat-cache";
import { emptySnapshot, writeHarvest } from "@src/shared/harvest-state";
import { fetchListingDetail } from "@src/shared/fetch-listing-detail";
import { usableListings } from "@src/shared/listing";
import {
  harvestUrl,
  inboxTabFromHref,
  isFacebookHost,
  queryFromHref
} from "@src/shared/query";
import {
  RUNTIME_SOURCE,
  type CacheLaneStatus,
  type CacheProgressMessage,
  type FetchListingDetailResponse,
  type HuntProgressMessage,
  type ListingRecord,
  type RuntimeMessage,
  type SearchMode,
  type SnapshotMessage
} from "@src/shared/types";

type ChatMode = "buying" | "selling";

const MATCH = /https:\/\/(www\.|web\.)?facebook\.com\/(marketplace\/|search\/)/i;
const store = new ListingStore();
const chatStores: Record<ChatMode, ListingStore> = {
  buying: new ListingStore(),
  selling: new ListingStore()
};
const chatTabs: Record<ChatMode, number> = { buying: 0, selling: 0 };
const chatHref: Record<ChatMode, string> = {
  buying: "https://www.facebook.com/marketplace/inbox",
  selling: "https://www.facebook.com/marketplace/inbox"
};
const chatStatus: Record<ChatMode, CacheLaneStatus> = {
  buying: "idle",
  selling: "idle"
};
let harvestTabId = 0;
let harvestQuery = "";
let harvestHref = "https://www.facebook.com";
let harvestMode: SearchMode = "marketplace";
let huntActive = false;
let huntWatch: Promise<void> | null = null;
let huntDoneCount = 0;
let warmingChats = false;
const openingChat: Record<ChatMode, Promise<void> | null> = {
  buying: null,
  selling: null
};

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

function pingHarvest(tabId: number, mode: SearchMode = harvestMode): void {
  void chrome.tabs
    .sendMessage(tabId, {
      source: RUNTIME_SOURCE,
      type: "start-harvest",
      mode
    })
    .catch(() => undefined);
}

function pingShell(tabId: number): void {
  void chrome.tabs
    .sendMessage(tabId, {
      source: RUNTIME_SOURCE,
      type: "show-agent-shell"
    })
    .catch(() => undefined);
}

function workspaceUrl(mode: SearchMode, query = ""): string {
  if (mode === "marketplace" && !query) {
    return "https://www.facebook.com/marketplace/";
  }
  return harvestUrl("https://www.facebook.com", mode, query);
}

function isUsableFacebookTab(url: string | undefined): boolean {
  return Boolean(url && isFacebookHost(url) && !/^chrome/i.test(url));
}

async function resolveHarvestTabId(preferredTabId?: number): Promise<number> {
  const tried = new Set<number>();
  const consider = async (id?: number): Promise<number> => {
    if (!id || tried.has(id)) {
      return 0;
    }
    tried.add(id);
    const tab = await chrome.tabs.get(id).catch(() => undefined);
    if (tab?.id && isUsableFacebookTab(tab.url)) {
      return tab.id;
    }
    return 0;
  };

  const preferred = await consider(preferredTabId);
  if (preferred) {
    return preferred;
  }
  const remembered = await consider(harvestTabId);
  if (remembered) {
    return remembered;
  }

  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeId = await consider(active[0]?.id);
  if (activeId) {
    return activeId;
  }

  const facebookTabs = await chrome.tabs.query({
    url: ["https://www.facebook.com/*", "https://web.facebook.com/*", "https://facebook.com/*"]
  });
  const marketplace = facebookTabs.find((tab) => /\/marketplace\//i.test(tab.url || ""));
  if (marketplace?.id) {
    return marketplace.id;
  }
  const searchTab = facebookTabs.find((tab) => /\/search\//i.test(tab.url || ""));
  if (searchTab?.id) {
    return searchTab.id;
  }
  return facebookTabs[0]?.id || 0;
}

async function refreshHarvestTab(tabId: number, url: string): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab?.id) {
    return;
  }
  const current = tab.url || "";
  /*
   * Same destination: reload in place. New query/path: navigate this tab only.
   * Never open a second Facebook tab for Enter / search submit.
   */
  if (current.split("#")[0] === url.split("#")[0]) {
    await chrome.tabs.reload(tab.id).catch(() => undefined);
    return;
  }
  await chrome.tabs.update(tab.id, { url }).catch(() => undefined);
}

function cacheProgress(): CacheProgressMessage {
  return {
    source: RUNTIME_SOURCE,
    type: "cache-progress",
    buying: { count: chatStores.buying.size(), status: chatStatus.buying },
    selling: { count: chatStores.selling.size(), status: chatStatus.selling }
  };
}

function broadcastCacheProgress(): void {
  void chrome.runtime.sendMessage(cacheProgress(), () => undefined);
}

function broadcastHuntProgress(status: "running" | "done"): void {
  const next: HuntProgressMessage = {
    source: RUNTIME_SOURCE,
    type: "hunt-progress",
    mode: harvestMode,
    query: harvestQuery,
    status,
    count: store.size()
  };
  void chrome.runtime.sendMessage(next, () => undefined);
}

function publishChatSnapshot(mode: ChatMode): void {
  const next: SnapshotMessage = {
    source: RUNTIME_SOURCE,
    type: "snapshot",
    query: harvestMode === mode ? harvestQuery : "",
    href: chatHref[mode],
    mode,
    listings: chatStores[mode].all()
  };
  if (harvestMode === mode) {
    store.merge(next.listings);
    harvestHref = next.href;
    void writeHarvest(next);
  }
  void chrome.runtime.sendMessage(next, () => undefined);
}

async function openAgentWorkspace(mode: SearchMode = "marketplace"): Promise<void> {
  harvestMode = mode;
  const url = workspaceUrl(mode);
  harvestTabId = await resolveHarvestTabId(harvestTabId);
  if (harvestTabId) {
    await refreshHarvestTab(harvestTabId, url);
  } else {
    const created = await chrome.tabs.create({ url, active: true }).catch(() => undefined);
    harvestTabId = created?.id || 0;
  }
  if (!harvestTabId) {
    return;
  }
  await waitTabComplete(harvestTabId);
  inject(harvestTabId);
  await sleep(400);
  pingShell(harvestTabId);
}

async function focusHarvest(): Promise<void> {
  const chatMode = harvestMode === "buying" || harvestMode === "selling" ? harvestMode : "";
  const tabId = chatMode ? chatTabs[chatMode] : harvestTabId;
  if (!tabId) {
    return;
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  pingShell(tabId);
}

async function stayOnWorkspace(preferredTabId?: number, focus = true): Promise<void> {
  const chatMode = harvestMode === "buying" || harvestMode === "selling" ? harvestMode : "";
  const tabId = preferredTabId || (chatMode ? chatTabs[chatMode] : harvestTabId);
  if (!tabId) {
    return;
  }
  /*
   * Never yank the user back during/after a hunt. Only focus when opening a
   * workspace on purpose (extension click / first search).
   */
  if (focus) {
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
  }
  pingShell(tabId);
}

async function watchHuntGrowth(tabId: number, mode: SearchMode): Promise<void> {
  const keepAlive = setInterval(() => {
    void chrome.storage.session.set({ huntPulse: Date.now() }).catch(() => undefined);
  }, 5000);
  const deadline = Date.now() + 90000;
  let lastCount = store.size();
  let stableTicks = 0;
  const needStable = 6;
  try {
    while (huntActive && Date.now() < deadline) {
      /*
       * Keep harvesting in the background. Do not chrome.tabs.update(active)
       * here - that stole focus every few seconds and blocked other tabs.
       */
      inject(tabId);
      pingHarvest(tabId, mode);
      broadcastHuntProgress("running");
      await sleep(2500);
      const count = store.size();
      if (count > 0 && count === lastCount) {
        stableTicks += 1;
        if (stableTicks >= needStable) {
          break;
        }
      } else {
        stableTicks = 0;
        lastCount = count;
      }
    }
  } finally {
    clearInterval(keepAlive);
  }
}

function finishHuntWatch(): void {
  huntActive = false;
  huntWatch = null;
  huntDoneCount = store.size();
  broadcastHuntProgress("done");
}

function resumeHuntIfNeeded(): void {
  if (huntActive) {
    return;
  }
  if (harvestMode !== "marketplace" && harvestMode !== "facebook") {
    return;
  }
  if (!harvestQuery || !harvestTabId) {
    return;
  }
  if (store.size() <= huntDoneCount) {
    return;
  }
  huntActive = true;
  broadcastHuntProgress("running");
  const tabId = harvestTabId;
  const mode = harvestMode;
  huntWatch = watchHuntGrowth(tabId, mode)
    .catch(() => undefined)
    .then(() => {
      finishHuntWatch();
      return stayOnWorkspace(undefined, false);
    });
}

async function openHarvest(query: string, mode: SearchMode, stayOnTabId?: number): Promise<void> {
  huntActive = false;
  if (huntWatch) {
    await huntWatch.catch(() => undefined);
  }
  harvestQuery = query;
  harvestMode = mode;
  harvestHref = "https://www.facebook.com";
  huntActive = true;
  huntDoneCount = -1;
  store.clear();
  await writeHarvest({ ...emptySnapshot(query), mode });
  broadcastHuntProgress("running");
  const url = workspaceUrl(mode, query);
  /*
   * Enter / search: reuse the current Facebook tab and refresh/navigate it.
   * Only create a tab when no Facebook tab exists yet.
   */
  harvestTabId = await resolveHarvestTabId(stayOnTabId || harvestTabId);
  if (harvestTabId) {
    await refreshHarvestTab(harvestTabId, url);
  } else {
    const created = await chrome.tabs.create({ url, active: true }).catch(() => undefined);
    harvestTabId = created?.id || 0;
  }
  if (!harvestTabId) {
    finishHuntWatch();
    await stayOnWorkspace(stayOnTabId, false);
    return;
  }
  await waitTabComplete(harvestTabId);
  inject(harvestTabId);
  await sleep(350);
  pingHarvest(harvestTabId, mode);
  pingShell(harvestTabId);
  /*
   * Stay on Loading more until the harvest tab stops growing under active scroll.
   * Short quiet windows looked Final while Marketplace was still streaming cards.
   */
  huntWatch = watchHuntGrowth(harvestTabId, mode)
    .catch(() => undefined)
    .then(async () => {
      finishHuntWatch();
      await stayOnWorkspace(stayOnTabId || harvestTabId, false);
    });
  await huntWatch;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (updatedId: number, info: { status?: string }): void => {
      if (updatedId === tabId && info.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") {
          finish();
        }
      })
      .catch(() => finish());
    void sleep(timeoutMs).then(finish);
  });
}

function searchHuntActive(): boolean {
  return huntActive && (harvestMode === "marketplace" || harvestMode === "facebook");
}

async function openChatTab(mode: ChatMode, stayOnTabId?: number): Promise<void> {
  if (searchHuntActive()) {
    return;
  }
  if (openingChat[mode]) {
    await openingChat[mode];
    if (chatStores[mode].size() > 0) {
      return;
    }
  }
  openingChat[mode] = (async () => {
    if (searchHuntActive()) {
      return;
    }
    const url = harvestUrl("https://www.facebook.com", mode, "");
    const current = chatTabs[mode] ? await chrome.tabs.get(chatTabs[mode]).catch(() => undefined) : undefined;
    if (current?.id) {
      chatTabs[mode] = current.id;
    } else {
      const created = await chrome.tabs.create({ url, active: false });
      chatTabs[mode] = created.id || 0;
    }
    chatStatus[mode] = "caching";
    broadcastCacheProgress();
    /*
     * Focus only when the user opened Buying/Selling themselves. Background warm
     * must not yank them off whatever tab they are working in.
     */
    const focusChat = !stayOnTabId;
    await chrome.tabs.update(chatTabs[mode], { url, active: focusChat }).catch(() => undefined);
    await waitTabComplete(chatTabs[mode]);
    if (searchHuntActive()) {
      await stayOnWorkspace(stayOnTabId, false);
      return;
    }
    inject(chatTabs[mode]);
    await sleep(400);
    pingHarvest(chatTabs[mode], mode);
    if (focusChat) {
      pingShell(chatTabs[mode]);
    }
    await sleep(4500);
    if (searchHuntActive()) {
      await stayOnWorkspace(stayOnTabId, false);
      return;
    }
    if (chatStores[mode].size() === 0) {
      inject(chatTabs[mode]);
      await sleep(200);
      await chrome.tabs.reload(chatTabs[mode]).catch(() => undefined);
      await waitTabComplete(chatTabs[mode]);
      if (searchHuntActive()) {
        await stayOnWorkspace(stayOnTabId, false);
        return;
      }
      await sleep(4500);
      pingHarvest(chatTabs[mode], mode);
      await sleep(2000);
    }
    await stayOnWorkspace(stayOnTabId, focusChat);
  })();
  try {
    await openingChat[mode];
  } finally {
    openingChat[mode] = null;
  }
}

async function nudgeChatTab(mode: ChatMode, stayOnTabId?: number): Promise<void> {
  const tabId = chatTabs[mode];
  if (!tabId || searchHuntActive()) {
    return;
  }
  /*
   * Reload in place without stealing the active tab. Harvest scroll/publish still
   * runs from the content script after reload.
   */
  inject(tabId);
  await sleep(200);
  await chrome.tabs.reload(tabId).catch(() => undefined);
  await sleep(5500);
  pingHarvest(tabId, mode);
  await sleep(2000);
  await stayOnWorkspace(stayOnTabId, false);
}

async function warmChatCaches(stayOnTabId?: number): Promise<void> {
  if (warmingChats || searchHuntActive()) {
    return;
  }
  warmingChats = true;
  try {
    await Promise.all(
      (["buying", "selling"] as const).map(async (mode) => {
        const cached = await readChatCache(mode);
        if (cached.listings.length) {
          chatStores[mode].clear();
          chatStores[mode].merge(cached.listings);
          chatHref[mode] = cached.href || chatHref[mode];
        }
        chatStatus[mode] = "caching";
      })
    );
    broadcastCacheProgress();
    await openChatTab("buying", stayOnTabId);
    await openChatTab("selling", stayOnTabId);

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if ((harvestMode === "marketplace" || harvestMode === "facebook") && harvestQuery) {
        break;
      }
      if (chatStores.buying.size() > 0 && chatStores.selling.size() > 0) {
        break;
      }
      for (const mode of ["buying", "selling"] as const) {
        if (chatStores[mode].size() > 0) {
          continue;
        }
        chatStatus[mode] = "caching";
        broadcastCacheProgress();
        await nudgeChatTab(mode, stayOnTabId);
      }
    }

    for (const mode of ["buying", "selling"] as const) {
      if (chatStores[mode].size() > 0) {
        await writeChatCache(mode, chatStores[mode].all(), chatHref[mode]);
      }
      chatStatus[mode] = "done";
    }
    broadcastCacheProgress();
  } finally {
    warmingChats = false;
  }
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
  void openAgentWorkspace("marketplace");
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "fbx-hunt") {
    return;
  }
  /*
   * Search page holds this port open for the whole hunt so the MV3 worker is not
   * killed before hunt-progress done can be sent.
   */
  port.onDisconnect.addListener(() => undefined);
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
    const mode = message.mode || "marketplace";
    harvestQuery = message.query;
    harvestMode = mode;
    if (mode === "buying" || mode === "selling") {
      chatStatus[mode] = "caching";
      broadcastCacheProgress();
      void openChatTab(mode, sender.tab?.id).then(() => {
        harvestTabId = chatTabs[mode];
        publishChatSnapshot(mode);
      });
      return;
    }
    /*
     * Messages from the agent iframe still carry the host Facebook tab on sender.tab.
     * Pass that through so Enter refreshes this tab instead of opening another.
     */
    void openHarvest(message.query, mode, sender.tab?.id).then(() => broadcast());
    return;
  }
  if (message.type === "warm-chat-caches") {
    void warmChatCaches(sender.tab?.id);
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
    const tabId = sender.tab?.id || 0;
    const hrefLane = inboxTabFromHref(message.href || "");
    const modeLane =
      message.mode === "buying" || message.mode === "selling" ? message.mode : "";
    const tabLane: ChatMode | "" =
      tabId && tabId === chatTabs.buying
        ? "buying"
        : tabId && tabId === chatTabs.selling
          ? "selling"
          : "";
    const lane = (tabLane || modeLane || hrefLane) as ChatMode | "";
    if (lane === "buying" || lane === "selling") {
      const inboxPage = /\/marketplace\/inbox/i.test(message.href || "");
      const fromChat = tabLane === lane;
      const fromHarvest = Boolean(harvestTabId && tabId === harvestTabId);
      const fromInbox = hrefLane === lane || inboxPage;
      if (!fromChat && !fromHarvest && !fromInbox && modeLane !== lane) {
        return;
      }
      if (tabId) {
        chatTabs[lane] = tabId;
      }
      const rows = usableListings(message.listings, lane);
      if (!rows.length) {
        return;
      }
      chatStores[lane].merge(rows);
      chatHref[lane] = message.href || chatHref[lane];
      if (chatStatus[lane] === "idle") {
        chatStatus[lane] = "caching";
      }
      void writeChatCache(lane, chatStores[lane].all(), chatHref[lane]);
      broadcastCacheProgress();
      publishChatSnapshot(lane);
      return;
    }
    const fromHarvest = Boolean(harvestTabId && tabId === harvestTabId);
    const fromQuery =
      (harvestMode === "marketplace" || harvestMode === "facebook") &&
      message.mode === harvestMode &&
      Boolean(harvestQuery && queryFromHref(message.href) === harvestQuery);
    if (!fromHarvest && !fromQuery) {
      return;
    }
    const laneMode =
      message.mode === "facebook" || message.mode === "marketplace" ? message.mode : harvestMode;
    const rows =
      laneMode === "facebook" || laneMode === "marketplace"
        ? usableListings(message.listings, laneMode)
        : message.listings;
    if (!rows.length) {
      return;
    }
    const before = store.size();
    store.merge(rows);
    const grew = store.size() > before;
    harvestHref = message.href || harvestHref;
    broadcast();
    if (grew && (harvestMode === "marketplace" || harvestMode === "facebook")) {
      resumeHuntIfNeeded();
    }
    return;
  }
  if (message.type === "request-snapshot") {
    sendResponse(snapshot());
  }
  if (message.type === "request-cache-progress") {
    sendResponse(cacheProgress());
  }
  if (message.type === "request-chat-snapshot") {
    const mode = message.mode;
    sendResponse({
      source: RUNTIME_SOURCE,
      type: "snapshot",
      query: harvestMode === mode ? harvestQuery : "",
      href: chatHref[mode],
      mode,
      listings: chatStores[mode].all()
    } satisfies SnapshotMessage);
  }
});

function onHarvestNav(tabId: number, url: string): void {
  if (!MATCH.test(url)) {
    return;
  }
  inject(tabId);
  if (tabId === chatTabs.buying) {
    pingHarvest(tabId, "buying");
    return;
  }
  if (tabId === chatTabs.selling) {
    pingHarvest(tabId, "selling");
    return;
  }
  if (tabId === harvestTabId) {
    pingHarvest(tabId, harvestMode);
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) {
    onHarvestNav(details.tabId, details.url);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    onHarvestNav(details.tabId, details.url);
  }
});
