const HIDDEN_CLASS = "fbx-exact-hidden";
const AD_LABEL = /^(ad|ads|sponsored|advertisement)$/i;
const OUTSIDE_HEADING = /results from outside your search/i;

function isSafeToHide(node: HTMLElement): boolean {
  if (node === document.body || node === document.documentElement) {
    return false;
  }
  if (node.id === "fbx-exact-root") {
    return false;
  }
  const rect = node.getBoundingClientRect();
  if (rect.height > window.innerHeight * 0.85 && rect.width > window.innerWidth * 0.7) {
    return false;
  }
  return true;
}

function cardAround(start: HTMLElement): HTMLElement {
  let current: HTMLElement | null = start;
  let best = start;
  while (current && current.parentElement && current !== document.body) {
    const parent = current.parentElement;
    const siblings = parent.querySelectorAll('a[href*="/marketplace/item/"], a[href*="/ads/"]').length;
    if (siblings >= 2) {
      return current;
    }
    if (parent.childElementCount >= 2) {
      best = current;
    }
    current = parent;
  }
  return best;
}

function sectionAround(heading: HTMLElement): HTMLElement {
  let current: HTMLElement | null = heading;
  for (let depth = 0; depth < 8 && current?.parentElement; depth += 1) {
    const parent = current.parentElement;
    const extra = (parent.innerText || "").length - (heading.innerText || "").length;
    if (extra > 40 && isSafeToHide(parent)) {
      return parent;
    }
    current = parent;
  }
  return heading;
}

function uniqueRoots(nodes: HTMLElement[]): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const roots: HTMLElement[] = [];
  for (const node of nodes) {
    if (!isSafeToHide(node) || seen.has(node) || node.querySelector("[data-fbx-hl]")) {
      continue;
    }
    seen.add(node);
    roots.push(node);
  }
  return roots;
}

export function collectNoiseRoots(doc: Document = document): HTMLElement[] {
  const found: HTMLElement[] = [];

  for (const node of doc.querySelectorAll<HTMLElement>("h1, h2, h3, h4, span, div")) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (OUTSIDE_HEADING.test(text) && text.length < 80) {
      found.push(sectionAround(node));
    }
  }

  for (const node of doc.querySelectorAll<HTMLElement>("span, div, a")) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (AD_LABEL.test(text)) {
      found.push(cardAround(node));
    }
  }

  for (const node of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/ads/"], a[href*="ads/about"]')) {
    found.push(cardAround(node));
  }

  return uniqueRoots(found);
}

export function setNoiseHidden(hidden: boolean): number {
  let count = 0;
  for (const root of collectNoiseRoots()) {
    if (hidden && root.querySelector("[data-fbx-hl]")) {
      continue;
    }
    root.classList.toggle(HIDDEN_CLASS, hidden);
    if (hidden) {
      root.setAttribute("data-fbx-noise", "hidden");
      count += 1;
    } else {
      root.removeAttribute("data-fbx-noise");
    }
  }

  if (!hidden) {
    for (const node of document.querySelectorAll("[data-fbx-noise]")) {
      node.classList.remove(HIDDEN_CLASS);
      node.removeAttribute("data-fbx-noise");
    }
  }

  return count;
}
