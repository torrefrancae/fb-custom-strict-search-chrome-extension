export type SearchRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DockBox = {
  left: number;
  top: number;
  width: number;
};

const GAP = 8;
const MARGIN = 12;
const MIN_WIDTH = 236;

function searchLabel(node: Element): string {
  return `${node.getAttribute("aria-label") || ""} ${node.getAttribute("placeholder") || ""}`.toLowerCase();
}

export function findMarketplaceSearchInput(doc: ParentNode): HTMLElement | null {
  const nodes = [
    ...doc.querySelectorAll<HTMLElement>("input[type=search], input[role=combobox], [role=combobox]")
  ];
  const ranked = nodes.find((node) => {
    const label = searchLabel(node);
    return label.includes("search marketplace") || (label.includes("search") && label.includes("marketplace"));
  });
  if (ranked) {
    return ranked;
  }
  return nodes.find((node) => searchLabel(node).includes("search")) || null;
}

export function marketplaceSearchRect(doc: Document): SearchRect | null {
  const input = findMarketplaceSearchInput(doc);
  if (!input) {
    return null;
  }
  const chrome = input.closest("label") || input;
  const box = chrome.getBoundingClientRect();
  if (box.width < 80 || box.height < 20) {
    return null;
  }
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height
  };
}

export function dockBelowRect(
  search: SearchRect,
  panelHeight: number,
  viewportW: number,
  viewportH: number
): DockBox {
  const width = Math.max(MIN_WIDTH, Math.min(Math.round(search.width), viewportW - MARGIN * 2));
  const left = Math.min(
    Math.max(MARGIN, search.left),
    Math.max(MARGIN, viewportW - width - MARGIN)
  );
  const rawTop = search.top + search.height + GAP;
  const top = Math.min(Math.max(MARGIN, rawTop), Math.max(MARGIN, viewportH - panelHeight - MARGIN));
  return { left, top, width };
}
