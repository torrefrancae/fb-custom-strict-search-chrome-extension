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

export function isMarketplaceSearchPath(pathname: string): boolean {
  return pathname.includes("/marketplace/") && !pathname.includes("/marketplace/item/");
}

export function marketplaceSearchUrl(origin: string, query: string): string {
  const url = new URL("/marketplace/search/", origin);
  url.searchParams.set("query", query);
  return url.toString();
}
