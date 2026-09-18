import { setNoiseHidden } from "@src/content/ads";
import {
  cardSearchText,
  collapseEmptyTiles,
  collectCards,
  revealAllCards,
  setCardHidden
} from "@src/content/cards";
import { clearHighlights, highlightQuery } from "@src/content/highlight";
import { bindOverlay, ensureOverlay, renderOverlay, setOverlayVisible } from "@src/content/overlay";
import { ListingStore } from "@src/content/store";
import { extractListingsFromDocument } from "@src/shared/hydrate";
import { listingMatchesQuery } from "@src/shared/match";
import { isMarketplaceSearchPath, isMarketplaceUrl, queryFromDocument } from "@src/shared/query";
import {
  onSettingsChange,
  readSettings,
  writeEnabled,
  writeSubstring
} from "@src/shared/settings";
import { MESSAGE_SOURCE, type ExactSearchState, type PageMessage } from "@src/shared/types";

const bootFlag = window as Window & { __fbxExactIsolated?: boolean };
if (!bootFlag.__fbxExactIsolated) {
  bootFlag.__fbxExactIsolated = true;
  bootIsolated();
}

function bootIsolated(): void {
const store = new ListingStore();
const overlay = ensureOverlay();
let enabled = true;
let substring = true;
let timer = 0;
let scriptCount = -1;

function hydrateFromPage(): void {
  const count = document.querySelectorAll("script").length;
  if (count === scriptCount) {
    return;
  }
  scriptCount = count;
  store.merge(extractListingsFromDocument(document));
}

function currentQuery(): string {
  return queryFromDocument(document, window.location.href);
}

function onMarketplacePage(): boolean {
  return (
    document.documentElement.hasAttribute("data-fbx-fixture") ||
    isMarketplaceUrl(window.location.href)
  );
}

function canFilter(): boolean {
  if (!enabled || !currentQuery() || !onMarketplacePage()) {
    return false;
  }

  if (document.documentElement.hasAttribute("data-fbx-fixture")) {
    return true;
  }

  return isMarketplaceSearchPath(window.location.pathname);
}

function applyFilter(): ExactSearchState {
  const query = currentQuery();
  if (!canFilter()) {
    revealAllCards();
    setNoiseHidden(false);
    for (const card of collectCards()) {
      clearHighlights(card.root);
    }
    return {
      enabled,
      substring,
      query,
      shown: 0,
      hidden: 0,
      pending: 0,
      adsHidden: 0
    };
  }

  let shown = 0;
  let hidden = 0;
  let pending = 0;

  for (const card of collectCards()) {
    const listing = store.get(card.id);
    const title = listing?.title || card.title;
    const description = [listing?.description, cardSearchText(card.root)]
      .filter(Boolean)
      .join(" ");
    if (!listing?.description) {
      pending += 1;
    }

    const keep = listingMatchesQuery(title, description, query, substring);
    setCardHidden(card.root, !keep);
    if (keep) {
      highlightQuery(card.root, query, substring);
      shown += 1;
    } else {
      clearHighlights(card.root);
      hidden += 1;
    }
  }

  const adsHidden = setNoiseHidden(true);
  collapseEmptyTiles();
  return { enabled, substring, query, shown, hidden, pending, adsHidden };
}

function refresh(): void {
  const visible = onMarketplacePage();
  setOverlayVisible(overlay, visible);
  if (!visible) {
    revealAllCards();
    setNoiseHidden(false);
    return;
  }
  hydrateFromPage();
  renderOverlay(overlay, applyFilter());
}

function scheduleRefresh(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(refresh, 250);
}

bindOverlay(overlay, {
  onToggle: (next) => {
    enabled = next;
    void writeEnabled(next);
    refresh();
  },
  onSubstring: (next) => {
    substring = next;
    void writeSubstring(next);
    refresh();
  }
});

window.addEventListener("popstate", scheduleRefresh);

window.addEventListener("message", (event: MessageEvent<PageMessage>) => {
  if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) {
    return;
  }
  if (event.data.type === "listings") {
    store.merge(event.data.listings);
    scheduleRefresh();
  }
  if (event.data.type === "navigate") {
    scheduleRefresh();
  }
});

onSettingsChange((next) => {
  enabled = next.enabled;
  substring = next.substring;
  refresh();
});

const observer = new MutationObserver(scheduleRefresh);
observer.observe(document.documentElement, { childList: true, subtree: true });

void readSettings().then((value) => {
  enabled = value.enabled;
  substring = value.substring;
  refresh();
});

setInterval(() => {
  refresh();
}, 1500);
}
