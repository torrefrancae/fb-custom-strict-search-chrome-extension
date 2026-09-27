import { extractListings, parseFacebookBody } from "@src/shared/listing";
import { extractInboxThreads } from "@src/shared/inbox-extract";
import { MESSAGE_SOURCE, type ListingRecord, type SearchMode } from "@src/shared/types";

const mainFlag = window as Window & { __fbxExactMain?: boolean; __fbxHarvestMode?: SearchMode };
if (!mainFlag.__fbxExactMain) {
  mainFlag.__fbxExactMain = true;
  installMainHooks();
}

function installMainHooks(): void {
  function currentMode(): SearchMode {
    try {
      const tab = new URL(window.location.href).searchParams.get("targetTab") || "";
      if (/buyer/i.test(tab)) {
        return "buying";
      }
      if (/seller/i.test(tab)) {
        return "selling";
      }
    } catch {
      /* ignore */
    }
    return mainFlag.__fbxHarvestMode || "marketplace";
  }

  function publishListings(listings: ListingRecord[]): void {
    if (!listings.length) {
      return;
    }
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
    publishListings(extractListings(payload));
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await originalFetch(...args);
    try {
      const clone = response.clone();
      const contentType = clone.headers.get("content-type") || "";
      if (contentType.includes("application/json") || contentType.includes("text/javascript")) {
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
