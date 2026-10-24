import { extractListings, parseFacebookBody } from "@src/shared/listing";
import { extractFacebookPosts } from "@src/shared/facebook-extract";
import { extractInboxThreads } from "@src/shared/inbox-extract";
import { modeFromHref } from "@src/shared/query";
import { MESSAGE_SOURCE, type ListingRecord, type SearchMode } from "@src/shared/types";

const mainFlag = window as Window & { __fbxExactMain?: boolean; __fbxHarvestMode?: SearchMode };
if (!mainFlag.__fbxExactMain) {
  mainFlag.__fbxExactMain = true;
  installMainHooks();
}

function installMainHooks(): void {
  function currentMode(): SearchMode {
    return (
      modeFromHref(window.location.href) ||
      mainFlag.__fbxHarvestMode ||
      "marketplace"
    );
  }

  function publishListings(listings: ListingRecord[]): void {
    if (!listings.length) {
      return;
    }
    console.log(`[fbx] main-listings mode=${currentMode()} count=${listings.length}`);
    window.postMessage({ source: MESSAGE_SOURCE, type: "listings", listings }, "*");
  }

  function publishHref(): void {
    window.postMessage(
      { source: MESSAGE_SOURCE, type: "navigate", href: window.location.href },
      "*"
    );
  }

  function ingestText(text: string): void {
    const payload = parseFacebookBody(text);
    if (!payload) {
      return;
    }
    const mode = currentMode();
    if (mode === "buying" || mode === "selling") {
      publishListings(extractInboxThreads(payload, mode));
      return;
    }
    if (mode === "facebook") {
      publishListings(extractFacebookPosts(payload));
      return;
    }
    if (
      /marketplaceInboxBuyerMessageThreads|marketplaceInboxSellerMessageThreads|marketplace_thread_data/i.test(
        text
      )
    ) {
      const inboxMode = /marketplaceInboxSellerMessageThreads/i.test(text) ? "selling" : "buying";
      publishListings(extractInboxThreads(payload, inboxMode));
      return;
    }
    if (/serpResponse|SearchPostViewModel|TOP_PUBLIC_POSTS/i.test(text)) {
      publishListings(extractFacebookPosts(payload));
      return;
    }
    publishListings(extractListings(payload));
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    try {
      const request = args[0];
      const requestUrl =
        typeof request === "string" ? request : request instanceof Request ? request.url : "";
      const clone = response.clone();
      const contentType = clone.headers.get("content-type") || "";
      if (
        contentType.includes("application/json") ||
        contentType.includes("text/javascript") ||
        contentType.includes("application/x-javascript") ||
        /graphql/i.test(requestUrl)
      ) {
        void clone.text().then(ingestText).catch(() => undefined);
      }
    } catch {
      /* some opaque responses cannot be cloned */
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof originalOpen>
  ) {
    this.addEventListener("load", () => {
      if (typeof this.responseText === "string") {
        ingestText(this.responseText);
      }
    });
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof originalSend>
  ) {
    return originalSend.apply(this, args);
  };

  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = ((...args: Parameters<History["pushState"]>) => {
    const result = originalPush(...args);
    publishHref();
    return result;
  }) as History["pushState"];

  history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    const result = originalReplace(...args);
    publishHref();
    return result;
  }) as History["replaceState"];

  window.addEventListener("popstate", publishHref);
  window.addEventListener("message", (event: MessageEvent<{ source?: string; type?: string; mode?: SearchMode }>) => {
    if (event.source !== window || event.data?.source !== MESSAGE_SOURCE) {
      return;
    }
    if (event.data.type === "set-mode" && event.data.mode) {
      mainFlag.__fbxHarvestMode = event.data.mode;
    }
  });
}
