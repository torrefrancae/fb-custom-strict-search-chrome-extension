import { hideAgentShell, showAgentShell } from "@src/content/agent-shell";
import { setNoiseHidden } from "@src/content/ads";
import { revealAllCards } from "@src/content/cards";
import { startHarvestScroll } from "@src/content/harvest";
import { listingsFromInbox } from "@src/content/inbox-listings";
import { listingsFromCards } from "@src/content/page-listings";
import { ListingStore } from "@src/content/store";
import { fetchListingDetail } from "@src/shared/fetch-listing-detail";
import { extractFacebookPosts } from "@src/shared/facebook-extract";
import { extractListingsFromDocument } from "@src/shared/hydrate";
import { extractInboxThreads } from "@src/shared/inbox-extract";
import { parseFacebookBody, usableListings } from "@src/shared/listing";
import {
  isFacebookHost,
  isHarvestablePath,
  isMarketplaceItemPath,
  modeFromHref
} from "@src/shared/query";
import {
  MESSAGE_SOURCE,
  RUNTIME_SOURCE,
  type PageMessage,
  type RuntimeMessage,
  type SearchMode
} from "@src/shared/types";

const bootFlag = window as Window & { __fbxExactIsolated?: boolean };
if (!bootFlag.__fbxExactIsolated) {
  bootFlag.__fbxExactIsolated = true;
  bootIsolated();
}

function bootIsolated(): void {
  const store = new ListingStore();
  let stopScroll: (() => void) | null = null;
  let timer = 0;
  let scriptCount = -1;
  let mode: SearchMode = "marketplace";

  function leaveFacebookAlone(): void {
    document.getElementById("fbx-exact-root")?.remove();
    revealAllCards();
    setNoiseHidden(false);
  }

  function currentMode(): SearchMode {
    return modeFromHref(window.location.href) || mode;
  }

  function onHarvestPage(): boolean {
    return (
      document.documentElement.hasAttribute("data-fbx-fixture") ||
      (isFacebookHost(window.location.href) && isHarvestablePath(window.location.pathname))
    );
  }

  function onItemView(): boolean {
    return isMarketplaceItemPath(window.location.pathname);
  }

  function publish(): void {
    if (!onHarvestPage() && !onItemView()) {
      return;
    }
    const activeMode = currentMode();
    const listings = usableListings(store.all(), activeMode);
    if (!listings.length) {
      return;
    }
    console.log(`[fbx] harvest-publish mode=${activeMode} count=${listings.length}`);
    const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
    runtime?.sendMessage(
      {
        source: RUNTIME_SOURCE,
        type: "harvest-listings",
        listings,
        href: window.location.href,
        mode: activeMode
      },
      () => undefined
    );
  }

  function hydrateScripts(activeMode: SearchMode): void {
    const count = document.querySelectorAll("script").length;
    if (count === scriptCount) {
      return;
    }
    scriptCount = count;
    if (activeMode === "marketplace") {
      store.merge(extractListingsFromDocument(document));
      return;
    }
    if (activeMode === "facebook") {
      for (const script of document.querySelectorAll("script")) {
        const text = script.textContent || "";
        if (!/serpResponse|SearchPostViewModel|permalink_url|post_id/i.test(text)) {
          continue;
        }
        const parsed = parseFacebookBody(text);
        if (parsed) {
          store.merge(extractFacebookPosts(parsed));
        }
      }
      return;
    }
    for (const script of document.querySelectorAll("script")) {
      const text = script.textContent || "";
      if (!/marketplace|commerce|MarketplaceThread|marketplace_inbox|marketplace_thread/i.test(text)) {
        continue;
      }
      const parsed = parseFacebookBody(text);
      if (parsed) {
        store.merge(extractInboxThreads(parsed, activeMode));
      }
    }
  }

  function hydrateFromPage(): void {
    const activeMode = currentMode();
    if (activeMode === "buying" || activeMode === "selling") {
      store.merge(listingsFromInbox(document, activeMode));
    } else if (activeMode === "marketplace") {
      store.merge(listingsFromCards());
    }
    hydrateScripts(activeMode);
  }

  function refresh(): void {
    leaveFacebookAlone();
    if (onItemView()) {
      stopScroll?.();
      stopScroll = null;
      store.merge(extractListingsFromDocument(document));
      publish();
      return;
    }
    hydrateFromPage();
    publish();
  }

  function scheduleRefresh(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 250);
  }

  function setHarvest(on: boolean, nextMode: SearchMode = mode): void {
    mode = nextMode;
    window.postMessage({ source: MESSAGE_SOURCE, type: "set-mode", mode: nextMode }, "*");
    stopScroll?.();
    stopScroll = on && onHarvestPage() ? startHarvestScroll() : null;
    refresh();
  }

  window.addEventListener("popstate", scheduleRefresh);
  window.addEventListener("message", (event: MessageEvent<PageMessage>) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) {
      return;
    }
    if (event.data.type === "listings") {
      console.log(`[fbx] isolated-listings count=${event.data.listings.length}`);
      store.merge(event.data.listings);
      scheduleRefresh();
    }
    if (event.data.type === "navigate") {
      if (onItemView()) {
        setHarvest(false);
      }
      scheduleRefresh();
    }
  });

  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  runtime?.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message?.source !== RUNTIME_SOURCE) {
      return;
    }
    if (message.type === "show-agent-shell") {
      showAgentShell();
      return;
    }
    if (message.type === "hide-agent-shell") {
      hideAgentShell();
      return;
    }
    if (message.type === "start-harvest") {
      const nextMode = message.mode || "marketplace";
      /*
       * Inbox GraphQL often lands before the first start-harvest flips mode off
       * marketplace. Keep those rows so ping/reload does not wipe a full cache.
       */
      const keepChat =
        (nextMode === "buying" || nextMode === "selling") && store.size() > 0;
      if (!keepChat && !(stopScroll && mode === nextMode)) {
        store.clear();
        scriptCount = -1;
      }
      setHarvest(true, nextMode);
      /*
       * Search harvest tabs always get the agent modal. Chat warm tabs only show
       * it when focused so background inbox caching stays invisible.
       */
      if (nextMode === "marketplace" || nextMode === "facebook" || !document.hidden) {
        showAgentShell();
      }
      return;
    }
    if (message.type === "fetch-listing-detail") {
      void fetchListingDetail(message.href, message.id)
        .then((listing) => {
          if (listing) {
            store.merge([listing]);
            publish();
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
  });

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  leaveFacebookAlone();
  refresh();
  window.setInterval(() => {
    if (stopScroll) {
      hydrateFromPage();
      publish();
    }
  }, 1200);
}
