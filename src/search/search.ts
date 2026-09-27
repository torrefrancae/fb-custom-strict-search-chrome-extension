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
  type RuntimeMessage,
  type SearchMode,
  type SnapshotMessage
} from "@src/shared/types";

const store = new ListingStore();
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
const focusMarket = document.getElementById("focus-market");
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
let loadTimer = 0;
let quietTimer = 0;

function runtime(): typeof chrome.runtime | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
}

function loadingDetail(): string {
  if (mode === "buying") {
    return store.size()
      ? "Showing saved Buying chats while refreshing the inbox."
      : "Opening Buying chats and scrolling the inbox. This can take a few seconds.";
  }
  if (mode === "selling") {
    return store.size()
      ? "Showing saved Selling chats while refreshing the inbox."
      : "Opening Selling chats and scrolling the inbox. This can take a few seconds.";
  }
  return "Opening Market list and collecting matching listings. This can take a few seconds.";
}

async function seedChatCache(): Promise<void> {
  if (mode !== "buying" && mode !== "selling") {
    return;
  }
  const cached = await readChatCache(mode);
  if (!cached.listings.length) {
    return;
  }
  href = cached.href || href;
  store.merge(cached.listings);
  paint();
}

function readForm(): void {
  query = queryBox.value.trim();
  exclude = excludeBox.value;
  matchRegex = matchRegexBox.value;
  priceRanges = priceRangesBox.value;
  substring = Boolean(substringBox.checked);
}

function paintTabs(): void {
  for (const button of tabButtons) {
    const active = button.dataset.mode === mode;
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  }
  queryBox.placeholder =
    mode === "marketplace" ? "honda civic 2015" : mode === "buying" ? "seller or item" : "buyer or item";
  queryBox.required = mode === "marketplace";
}

function send(message: RuntimeMessage): void {
  runtime()?.sendMessage(message, () => undefined);
}

function finishHunt(): void {
  loading = false;
  window.clearTimeout(loadTimer);
  window.clearTimeout(quietTimer);
  paint();
}

function armQuietFinish(): void {
  window.clearTimeout(quietTimer);
  quietTimer = window.setTimeout(() => {
    if (loading) {
      finishHunt();
    }
  }, 4500);
}

function startHunt(): void {
  readForm();
  if (mode === "marketplace" && !query) {
    return;
  }
  store.clear();
  modal.close();
  loading = true;
  window.clearTimeout(loadTimer);
  window.clearTimeout(quietTimer);
  loadTimer = window.setTimeout(() => {
    finishHunt();
  }, 45000);
  void writeLastQuery(query);
  void writeExclude(exclude);
  void writeMatchRegex(matchRegex);
  void writePriceRanges(priceRanges);
  void writeSubstring(substring);
  void writeLastMode(mode);
  if (mode === "buying" || mode === "selling") {
    void seedChatCache();
  }
  send({ source: RUNTIME_SOURCE, type: "start-search", query, mode });
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
  phaseLabel.textContent = phase === "running" ? "Searching" : phase === "done" ? "Finished" : "Ready";
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
    : mode === "marketplace"
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
  if (loading && store.size() > before) {
    armQuietFinish();
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
  mode = next;
  paintTabs();
  void writeLastMode(next);
  modal.close();
  store.clear();
  loading = false;
  window.clearTimeout(loadTimer);
  window.clearTimeout(quietTimer);
  if (next === "buying" || next === "selling") {
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
    if (next === "marketplace" || next === "buying" || next === "selling") {
      setMode(next);
    }
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

focusMarket?.addEventListener("click", () => {
  send({ source: RUNTIME_SOURCE, type: "focus-harvest" });
});

runtime()?.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.source === RUNTIME_SOURCE && message.type === "snapshot") {
    ingest(message);
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
  query = settings.lastQuery;
  mode = settings.lastMode;
  substringBox.checked = settings.substring;
  excludeBox.value = settings.exclude;
  matchRegexBox.value = settings.matchRegex;
  priceRangesBox.value = settings.priceRanges;
  queryBox.value = settings.lastQuery;
  paintTabs();
  send({ source: RUNTIME_SOURCE, type: "request-snapshot" });
  void readHarvest().then((harvest) => {
    if (harvest.mode === mode && harvest.listings.length) {
      ingest(harvest);
    }
  });
  paint();
  if (mode === "buying" || mode === "selling") {
    startHunt();
  }
});

runtime()?.sendMessage({ source: RUNTIME_SOURCE, type: "request-snapshot" }, (reply: SnapshotMessage) => {
  if (reply?.type === "snapshot" && (!reply.mode || reply.mode === mode)) {
    ingest(reply);
  }
});
