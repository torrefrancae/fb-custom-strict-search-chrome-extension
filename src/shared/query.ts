import type { SearchMode } from "@src/shared/types";

export function queryFromHref(href: string): string {
  try {
    const url = new URL(href);
    return (url.searchParams.get("query") || url.searchParams.get("q") || "").trim();
  } catch {
    return "";
  }
}

export function queryFromDocument(doc: Document, href: string): string {
  return (
    queryFromHref(href) ||
    doc.documentElement.getAttribute("data-fbx-query") ||
    ""
  ).trim();
}

export function isMarketplaceUrl(href: string): boolean {
  return /marketplace/i.test(href);
}

export function isMarketplaceItemPath(pathname: string): boolean {
  return pathname.includes("/marketplace/item/");
}

export function isMarketplaceInboxPath(pathname: string): boolean {
  return pathname.includes("/marketplace/inbox");
}

export function isMarketplaceSearchPath(pathname: string): boolean {
  return pathname.includes("/marketplace/") && !isMarketplaceItemPath(pathname);
}

export function isHarvestablePath(pathname: string): boolean {
  return isMarketplaceSearchPath(pathname) || isMarketplaceInboxPath(pathname);
}

export function marketplaceSearchUrl(origin: string, query: string): string {
  const url = new URL("/marketplace/search/", origin);
  url.searchParams.set("query", query);
  return url.toString();
}

export function marketplaceInboxUrl(origin: string, mode: Exclude<SearchMode, "marketplace">): string {
  const url = new URL("/marketplace/inbox", origin);
  url.searchParams.set("targetTab", mode === "buying" ? "BUYER" : "SELLER");
  return url.toString();
}

export function harvestUrl(origin: string, mode: SearchMode, query: string): string {
  if (mode === "buying" || mode === "selling") {
    return marketplaceInboxUrl(origin, mode);
  }
  return marketplaceSearchUrl(origin, query);
}

export function inboxTabFromHref(href: string): SearchMode | "" {
  try {
    const tab = new URL(href).searchParams.get("targetTab") || "";
    if (/buyer/i.test(tab)) {
      return "buying";
    }
    if (/seller/i.test(tab)) {
      return "selling";
    }
  } catch {
    /* ignore bad urls */
  }
  return "";
}
