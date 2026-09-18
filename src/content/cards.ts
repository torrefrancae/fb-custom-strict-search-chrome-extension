import { listingIdFromHref } from "@src/shared/listing";

const HIDDEN_CLASS = "fbx-exact-hidden";
const ITEM_SELECTOR = 'a[href*="/marketplace/item/"]';
const PRICE_RE = /(?:^|[^\d])(?:php|usd|eur|gbp|cad|aud|[$₱€£¥])\s?[\d,.]+/i;
const DISTANCE_RE = /\b\d+(\.\d+)?\s?(km|mi|miles)\b/i;
const SKIP_LINE = /^(sponsored|ad|ads|just listed|pending|sold|available)$/i;

export type CardInfo = {
  id: string;
  root: HTMLElement;
  title: string;
};

function listingCount(node: Element): number {
  const inner = node.querySelectorAll(ITEM_SELECTOR).length;
  return node.matches(ITEM_SELECTOR) ? inner + 1 : inner;
}

export function closestCard(anchor: HTMLElement): HTMLElement {
  let current: HTMLElement | null = anchor;
  let candidate = anchor;

  while (current && current.parentElement && current !== document.body) {
    const parent = current.parentElement;
    const siblingTiles = [...parent.children].filter(
      (kid) => kid instanceof HTMLElement && listingCount(kid) >= 1
    );
    if (siblingTiles.length >= 2 && siblingTiles.includes(current)) {
      return current;
    }
    if (listingCount(parent) >= 2 && listingCount(current) <= 1) {
      candidate = current;
    }
    current = parent;
  }

  return candidate;
}

function textLines(root: HTMLElement): string[] {
  return (root.innerText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function titleFromCard(root: HTMLElement): string {
  const labeled = root.getAttribute("aria-label") || "";
  if (labeled && !PRICE_RE.test(labeled)) {
    return labeled;
  }

  const alt = root.querySelector("img")?.getAttribute("alt") || "";
  if (alt.trim()) {
    return alt.trim();
  }

  const lines = textLines(root).filter((line) => {
    if (PRICE_RE.test(line) && line.length < 24) {
      return false;
    }
    if (DISTANCE_RE.test(line)) {
      return false;
    }
    if (SKIP_LINE.test(line)) {
      return false;
    }
    return true;
  });

  return lines[0] || "";
}

export function cardSearchText(root: HTMLElement): string {
  return textLines(root)
    .filter((line) => {
      if (PRICE_RE.test(line) && line.length < 28) {
        return false;
      }
      if (DISTANCE_RE.test(line)) {
        return false;
      }
      if (SKIP_LINE.test(line)) {
        return false;
      }
      return true;
    })
    .join(" ");
}

export function collectCards(root: ParentNode = document): CardInfo[] {
  const seen = new Set<string>();
  const cards: CardInfo[] = [];

  for (const node of root.querySelectorAll<HTMLAnchorElement>(ITEM_SELECTOR)) {
    const id = listingIdFromHref(node.href);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    const cardRoot = closestCard(node);
    cards.push({
      id,
      root: cardRoot,
      title: titleFromCard(cardRoot)
    });
  }

  return cards;
}

export function setCardHidden(root: HTMLElement, hidden: boolean): void {
  root.classList.toggle(HIDDEN_CLASS, hidden);
  if (hidden) {
    root.setAttribute("data-fbx-exact", "hidden");
  } else {
    root.removeAttribute("data-fbx-exact");
  }
}

export function collapseEmptyTiles(): void {
  for (const hidden of document.querySelectorAll(`[data-fbx-exact="hidden"]`)) {
    const parent = hidden.parentElement;
    if (!parent || parent === document.body) {
      continue;
    }
    if (parent.querySelector("[data-fbx-hl]")) {
      continue;
    }
    if (listingCount(parent) === 1 && listingCount(hidden) <= 1) {
      parent.classList.add(HIDDEN_CLASS);
      parent.setAttribute("data-fbx-gap", "hidden");
    }
  }
}

export function revealAllCards(): void {
  for (const node of document.querySelectorAll(`.${HIDDEN_CLASS}`)) {
    node.classList.remove(HIDDEN_CLASS);
    node.removeAttribute("data-fbx-exact");
    node.removeAttribute("data-fbx-gap");
    node.removeAttribute("data-fbx-noise");
  }
}
