import { ListingStore } from "@src/content/store";
import { createResultModal } from "@src/search/result-modal";
import { renderResults } from "@src/search/render";
import { readChatCache, writeChatCache } from "@src/shared/chat-cache";
import { onHarvestChange, readHarvest } from "@src/shared/harvest-state";
import { usableListings } from "@src/shared/listing";
import { compileMatchRegex } from "@src/shared/match";
import { compilePriceRanges } from "@src/shared/price-range";
import { searchStatus, visibleListings, filterListings } from "@src/shared/results";
import {
  readSettings,
  writeExclude,
  writeLastMode,
  writeLastQuery,
  writeMatchRegex,
  writePriceRanges,
  writeSubstring
} from "@src/shared/settings";
import {
  RUNTIME_SOURCE,
  type CacheLaneProgress,
  type CacheProgressMessage,
  type HuntProgressMessage,
  type RuntimeMessage,
  type SearchMode,
  type SnapshotMessage
} from "@src/shared/types";

const store = new ListingStore();
if (new URLSearchParams(window.location.search).get("embed") === "1") {
  document.body.classList.add("embed");
}
const form = document.getElementById("form") as HTMLFormElement;
const queryBox = document.getElementById("query") as HTMLInputElement;
const excludeBox = document.getElementById("exclude") as HTMLInputElement;
const substringBox = document.getElementById("substring") as HTMLInputElement;
const matchRegexBox = document.getElementById("match-regex") as HTMLInputElement;
const priceRangesBox = document.getElementById("price-ranges") as HTMLInputElement;
const advancedBar = document.getElementById("advanced-bar") as HTMLElement;
const advancedState = document.getElementById("advanced-state") as HTMLElement;
const statusBar = document.getElementById("status-bar") as HTMLElement;
const phaseLabel = document.getElementById("phase-label") as HTMLElement;
const statusNode = document.getElementById("status") as HTMLElement;
const statShown = document.getElementById("stat-shown") as HTMLElement;
const statTotal = document.getElementById("stat-total") as HTMLElement;
const statMatch = document.getElementById("stat-match") as HTMLElement;
const resultsNode = document.getElementById("results") as HTMLElement;
const clearParams = document.getElementById("clear-params");
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
const modal = createResultModal(document.body);

let query = "";
let exclude = "";
let matchRegex = "";
let priceRanges = "";
let substring = true;
let mode: SearchMode = "marketplace";
let href = "https://www.facebook.com";
let loading = false;
let huntClosed = false;
let loadTimer = 0;
let quietTimer = 0;
let huntPoll = 0;
let huntPort: chrome.runtime.Port | null = null;
let userPickedMode = false;
let cacheStats: Record<"buying" | "selling", CacheLaneProgress> = {
  buying: { count: 0, status: "idle" },
  selling: { count: 0, status: "idle" }
};

function runtime(): typeof chrome.runtime | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
}

function loadingDetail(): string {
  if (mode === "buying") {
    return store.size()
      ? "Refreshing Buying chats. More rows can still arrive."
      : "Opening Buying chats and scrolling the inbox.";
  }
  if (mode === "selling") {
    return store.size()
      ? "Refreshing Selling chats. More rows can still arrive."
      : "Opening Selling chats and scrolling the inbox.";
  }
  if (mode === "facebook") {
    return store.size()
      ? "Facebook is still sending posts."
      : "Opening Facebook search and collecting matching posts.";
  }
  return store.size()
    ? "Market list is still loading more listings."
    : "Opening Market list and collecting matching listings.";
}

async function seedChatCache(): Promise<void> {
  if (mode !== "buying" && mode !== "selling") {
    return;
  }
  const cached = await readChatCache(mode);
  if (cached.listings.length) {
    href = cached.href || href;
    store.merge(cached.listings);
    cacheStats[mode] = {
      count: Math.max(cacheStats[mode].count, cached.listings.length),
      status: cacheStats[mode].status === "caching" ? "caching" : "done"
    };
    paint();
  }
  await new Promise<void>((resolve) => {
    runtime()?.sendMessage(
      { source: RUNTIME_SOURCE, type: "request-chat-snapshot", mode },
      (reply: SnapshotMessage | undefined) => {
        if (reply?.type === "snapshot" && reply.mode === mode && reply.listings?.length) {
          href = reply.href || href;
          store.merge(reply.listings);
          cacheStats[mode] = {
            count: Math.max(cacheStats[mode].count, reply.listings.length),
            status: cacheStats[mode].status === "caching" ? "caching" : "done"
          };
          paint();
        }
        resolve();
      }
    );
    window.setTimeout(() => resolve(), 800);
  });
}

function readForm(): void {
  query = queryBox.value.trim();
  exclude = excludeBox.value;
  matchRegex = matchRegexBox.value;
  priceRanges = priceRangesBox.value;
  substring = Boolean(substringBox.checked);
}

function paintTabMeta(): void {
  for (const lane of ["buying", "selling"] as const) {
    const meta = document.getElementById(`tab-${lane}-meta`);
    if (!meta) {
      continue;
    }
    const { count, status } = cacheStats[lane];
    meta.dataset.state = status;
    if (status === "idle" && count <= 0) {
      meta.textContent = "";
      continue;
    }
    if (status === "caching") {
      meta.textContent = `${count} caching`;
      continue;
    }
    meta.textContent = String(count);
  }
}

function paintTabs(): void {
  for (const button of tabButtons) {
    const active = button.dataset.mode === mode;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }
  queryBox.placeholder =
    mode === "facebook" || mode === "marketplace"
      ? "honda civic 2015"
      : mode === "buying"
        ? "seller or item"
        : "buyer or item";
  queryBox.required = mode === "facebook" || mode === "marketplace";
  paintTabMeta();
}

function applyCacheProgress(message: CacheProgressMessage): void {
  cacheStats = {
    buying: {
      count: Math.max(cacheStats.buying.count, message.buying.count),
      status: message.buying.status
    },
    selling: {
      count: Math.max(cacheStats.selling.count, message.selling.count),
      status: message.selling.status
    }
  };
  paintTabMeta();
  if (
    (mode === "buying" || mode === "selling") &&
    cacheStats[mode].count > store.size()
  ) {
    void seedChatCache();
  }
}

async function loadCachedTabCounts(): Promise<void> {
  const [buying, selling] = await Promise.all([readChatCache("buying"), readChatCache("selling")]);
  cacheStats = {
    buying: {
      count: buying.listings.length,
      status: buying.listings.length ? "done" : cacheStats.buying.status
    },
    selling: {
      count: selling.listings.length,
      status: selling.listings.length ? "done" : cacheStats.selling.status
    }
  };
  paintTabMeta();
}

function send(message: RuntimeMessage): void {
  void runtime()?.sendMessage(message);
}

function holdHuntPort(): void {
  const api = runtime();
  if (!api?.connect) {
    return;
  }
  if (huntPort) {
    return;
  }
  try {
    huntPort = api.connect({ name: "fbx-hunt" });
    huntPort.onDisconnect.addListener(() => {
      huntPort = null;
      if (loading && !huntClosed && (mode === "marketplace" || mode === "facebook")) {
        holdHuntPort();
      }
    });
  } catch {
    huntPort = null;
  }
}

function dropHuntPort(): void {
  try {
    huntPort?.disconnect();
  } catch {
    /* already gone */
  }
  huntPort = null;
}

function finishHunt(): void {
  huntClosed = true;
  loading = false;
  window.clearTimeout(loadTimer);
  window.clearTimeout(quietTimer);
  window.clearInterval(huntPoll);
  huntPoll = 0;
  dropHuntPort();
  paint();
}

function pullSnapshot(): void {
  runtime()?.sendMessage(
    { source: RUNTIME_SOURCE, type: "request-snapshot" },
    (reply: SnapshotMessage | undefined) => {
      if (reply?.type === "snapshot" && (!reply.mode || reply.mode === mode)) {
        ingest(reply);
      }
    }
  );
}

function armHuntPoll(): void {
  window.clearInterval(huntPoll);
  huntPoll = window.setInterval(() => {
    if (!loading) {
      window.clearInterval(huntPoll);
      huntPoll = 0;
      return;
    }
    pullSnapshot();
  }, 1200);
}

function armQuietFinish(): void {
  window.clearTimeout(quietTimer);
  /*
   * Long quiet for Market/Facebook so Final is not claimed while Facebook is still
   * streaming. Growth always reopens Loading more.
   */
  const waitMs = mode === "marketplace" || mode === "facebook" ? 28000 : 10000;
  quietTimer = window.setTimeout(() => {
    if (loading && !huntClosed) {
      finishHunt();
    }
  }, waitMs);
}

function reopenHuntFromGrowth(): void {
  if (mode !== "marketplace" && mode !== "facebook") {
    return;
  }
  huntClosed = false;
  loading = true;
  window.clearTimeout(loadTimer);
  holdHuntPort();
  armHuntPoll();
  armQuietFinish();
  paint();
}

function startHunt(): void {
  readForm();
  const selected = document.querySelector<HTMLButtonElement>(".tab[aria-selected='true']");
  const tabMode = selected?.dataset.mode;
  if (
    tabMode === "facebook" ||
    tabMode === "marketplace" ||
    tabMode === "buying" ||
    tabMode === "selling"
  ) {
    mode = tabMode;
  }
  if ((mode === "marketplace" || mode === "facebook") && !query) {
    return;
  }
  store.clear();
  modal.close();
  huntClosed = false;
  loading = true;
  window.clearTimeout(loadTimer);
  window.clearTimeout(quietTimer);
  /*
   * Hard timeout is only a safety net for chat lanes. Search modes wait on
   * hunt-progress done so Final matches the live Facebook tab.
   */
  if (mode === "buying" || mode === "selling") {
    loadTimer = window.setTimeout(() => {
      finishHunt();
    }, 60000);
  }
  void writeLastQuery(query);
  void writeExclude(exclude);
  void writeMatchRegex(matchRegex);
  void writePriceRanges(priceRanges);
  void writeSubstring(substring);
  void writeLastMode(mode);
  if (mode === "buying" || mode === "selling") {
    void seedChatCache().then(() => {
      send({ source: RUNTIME_SOURCE, type: "start-search", query, mode });
      paint();
    });
    paint();
    return;
  }
  send({ source: RUNTIME_SOURCE, type: "start-search", query, mode });
  holdHuntPort();
  armHuntPoll();
  armQuietFinish();
  paint();
}

function paintAdvanced(): void {
  const regex = compileMatchRegex(matchRegex);
  const prices = compilePriceRanges(priceRanges);
  if (regex.error || prices.error) {
    advancedBar.dataset.state = "error";
    advancedState.textContent = regex.error
      ? `Invalid regex - ${regex.error}`
      : prices.error;
    return;
  }
  const notes: string[] = [];
  if (regex.pattern) {
    notes.push(`regex /${regex.pattern}/i`);
  }
  if (prices.ranges.length) {
    notes.push(
      `prices ${prices.ranges.map((range) => `${range.min}-${range.max}`).join(" or ")}`
    );
  }
  if (notes.length) {
    advancedBar.dataset.state = "active";
    advancedState.textContent = `Filtering by ${notes.join(" + ")}`;
    return;
  }
  advancedBar.dataset.state = "idle";
  advancedState.textContent =
    "Optional. Regex example: m(1|2). Price example: 5000-10000 and 5-10.";
}

function paintStatusBar(shown: number, total: number, matchCount: number, showingAll: boolean): void {
  const regex = compileMatchRegex(matchRegex);
  const prices = compilePriceRanges(priceRanges);
  const phase = loading ? "running" : total > 0 || Boolean(query) ? "done" : "idle";
  statusBar.dataset.phase = phase;
  phaseLabel.textContent =
    phase === "running" ? (total > 0 ? "Loading more" : "Loading") : phase === "done" ? "Final" : "Ready";
  statShown.textContent = String(shown);
  statTotal.textContent = String(total);
  statMatch.textContent = String(matchCount);
  if (regex.error || prices.error) {
    statusNode.textContent = "Advanced filters invalid - fix regex or price ranges.";
    return;
  }
  let message = searchStatus(query, loading, shown, total, mode, showingAll && Boolean(query));
  if (regex.pattern || prices.ranges.length) {
    message = `${message} Advanced filters active.`;
  }
  statusNode.textContent = message;
}

function paint(): void {
  const usable = usableListings(store.all(), mode);
  const { cards, showingAll } = visibleListings(
    usable,
    query,
    substring,
    exclude,
    href,
    mode,
    matchRegex,
    priceRanges
  );
  const total = usable.length;
  const matchCount = query
    ? filterListings(usable, query, substring, exclude, href, mode, matchRegex, priceRanges).length
    : mode === "marketplace" || mode === "facebook"
      ? 0
      : filterListings(usable, "", substring, exclude, href, mode, matchRegex, priceRanges).length;
  paintAdvanced();
  paintStatusBar(cards.length, total, matchCount, showingAll);
  renderResults(
    resultsNode,
    cards,
    query,
    substring,
    loading,
    (card) => {
      modal.open(card, query, substring);
    },
    loadingDetail()
  );
  (window as Window & { __fbxListings?: ReturnType<ListingStore["all"]> }).__fbxListings = usable;
}

function ingest(message: Pick<SnapshotMessage, "listings" | "href" | "query" | "mode">): void {
  if (message.mode && message.mode !== mode) {
    return;
  }
  if (message.query && !query) {
    query = message.query;
    queryBox.value = message.query;
  }
  href = message.href || href;
  const before = store.size();
  store.merge(message.listings);
  if (store.size() > before) {
    if (huntClosed || !loading) {
      reopenHuntFromGrowth();
    }
    if (loading) {
      armQuietFinish();
    }
  }
  if ((mode === "buying" || mode === "selling") && store.size() > 0) {
    void writeChatCache(mode, store.all(), href);
  }
  paint();
}

function setMode(next: SearchMode): void {
  if (next === mode) {
    return;
  }
  userPickedMode = true;
  mode = next;
  paintTabs();
  void writeLastMode(next);
  modal.close();
  store.clear();
  huntClosed = true;
  loading = false;
  window.clearTimeout(loadTimer);
  window.clearTimeout(quietTimer);
  if (next === "buying" || next === "selling") {
    query = "";
    queryBox.value = "";
    startHunt();
    return;
  }
  readForm();
  if (query) {
    startHunt();
    return;
  }
  paint();
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const next = button.dataset.mode;
    if (
      next !== "facebook" &&
      next !== "marketplace" &&
      next !== "buying" &&
      next !== "selling"
    ) {
      return;
    }
    if (next === mode && (next === "buying" || next === "selling")) {
      startHunt();
      return;
    }
    setMode(next);
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  startHunt();
});

queryBox.addEventListener("input", () => {
  query = queryBox.value.trim();
  paint();
});

excludeBox.addEventListener("input", () => {
  exclude = excludeBox.value;
  void writeExclude(exclude);
  paint();
});

matchRegexBox.addEventListener("input", () => {
  matchRegex = matchRegexBox.value;
  void writeMatchRegex(matchRegex);
  paint();
});

priceRangesBox.addEventListener("input", () => {
  priceRanges = priceRangesBox.value;
  void writePriceRanges(priceRanges);
  paint();
});

substringBox.addEventListener("change", () => {
  substring = Boolean(substringBox.checked);
  void writeSubstring(substring);
  paint();
});

clearParams?.addEventListener("click", () => {
  exclude = "";
  matchRegex = "";
  priceRanges = "";
  substring = true;
  excludeBox.value = "";
  matchRegexBox.value = "";
  priceRangesBox.value = "";
  substringBox.checked = true;
  void writeExclude(exclude);
  void writeMatchRegex(matchRegex);
  void writePriceRanges(priceRanges);
  void writeSubstring(substring);
  paint();
});

runtime()?.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.source !== RUNTIME_SOURCE) {
    return;
  }
  if (message.type === "snapshot") {
    ingest(message);
    return;
  }
  if (message.type === "cache-progress") {
    applyCacheProgress(message);
    return;
  }
  if (message.type === "hunt-progress") {
    const progress = message as HuntProgressMessage;
    if (progress.mode !== mode) {
      return;
    }
    if (progress.query && query && progress.query !== query) {
      return;
    }
    if (progress.status === "running") {
      /*
       * After Final, ignore heartbeats that do not bring new rows. Stale running
       * after done was flipping Final back to Loading more with the same cards.
       */
      if (huntClosed && progress.count <= store.size()) {
        return;
      }
      huntClosed = false;
      loading = true;
      holdHuntPort();
      armHuntPoll();
      pullSnapshot();
      paint();
      return;
    }
    if (progress.status === "done") {
      pullSnapshot();
      finishHunt();
    }
  }
});

onHarvestChange((message) => {
  ingest(message);
});

window.addEventListener("message", (event: MessageEvent<RuntimeMessage | { source: string; type: string }>) => {
  const data = event.data;
  if (!data || data.source !== RUNTIME_SOURCE || data.type !== "snapshot") {
    return;
  }
  ingest(data as SnapshotMessage);
});

void readSettings().then((settings) => {
  substring = settings.substring;
  exclude = settings.exclude;
  matchRegex = settings.matchRegex;
  priceRanges = settings.priceRanges;
  substringBox.checked = settings.substring;
  excludeBox.value = settings.exclude;
  matchRegexBox.value = settings.matchRegex;
  priceRangesBox.value = settings.priceRanges;
  /*
   * Marketplace queries should not filter Buying/Selling on restore. Chat tabs
   * start with an empty query so the full cached inbox can render.
   */
  if (!userPickedMode) {
    mode = settings.lastMode;
  }
  if (mode === "buying" || mode === "selling") {
    query = "";
    queryBox.value = "";
  } else if (!userPickedMode) {
    query = settings.lastQuery;
    queryBox.value = settings.lastQuery;
  }
  paintTabs();
  send({ source: RUNTIME_SOURCE, type: "request-snapshot" });
  void readHarvest().then((harvest) => {
    if (harvest.mode === mode && harvest.listings.length) {
      ingest(harvest);
    }
  });
  paint();
  /*
   * Seed Buying/Selling from on-disk OPFS files, show live tab counts, then
   * refresh both inboxes in parallel through background harvest tabs.
   */
  void loadCachedTabCounts();
  const embedded = document.body.classList.contains("embed");
  /*
   * Embedded agent shell: do not warm Buying/Selling in the background. That used
   * to open inbox tabs and steal focus from the Marketplace/Facebook hunt tab.
   */
  if (!embedded) {
    cacheStats = {
      buying: { count: cacheStats.buying.count, status: "caching" },
      selling: { count: cacheStats.selling.count, status: "caching" }
    };
    paintTabMeta();
    const pullCacheProgress = (): void => {
      runtime()?.sendMessage(
        { source: RUNTIME_SOURCE, type: "request-cache-progress" },
        (reply: CacheProgressMessage | undefined) => {
          if (reply?.type === "cache-progress") {
            applyCacheProgress(reply);
          }
        }
      );
    };
    pullCacheProgress();
    const cachePoll = window.setInterval(() => {
      pullCacheProgress();
      if (cacheStats.buying.status === "done" && cacheStats.selling.status === "done") {
        window.clearInterval(cachePoll);
      }
    }, 1500);
    send({ source: RUNTIME_SOURCE, type: "warm-chat-caches" });
  } else {
    paintTabMeta();
  }
  if (mode === "buying" || mode === "selling") {
    startHunt();
  } else {
    void seedChatCache();
  }
});

runtime()?.sendMessage({ source: RUNTIME_SOURCE, type: "request-snapshot" }, (reply: SnapshotMessage) => {
  if (reply?.type === "snapshot" && (!reply.mode || reply.mode === mode)) {
    ingest(reply);
  }
});
