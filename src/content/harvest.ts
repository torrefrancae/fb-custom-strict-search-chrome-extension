import { isFacebookSearchPath, isMarketplaceSearchPath, isMarketplaceInboxPath } from "@src/shared/query";

const MAX_TICKS = 160;
const GAP_MS = 900;

function scrollTargets(): HTMLElement[] {
  const nodes = [...document.querySelectorAll<HTMLElement>("div, section, main, ul")];
  const scrollable = nodes.filter((node) => {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") {
      return false;
    }
    return node.scrollHeight > node.clientHeight + 80;
  });
  scrollable.sort((left, right) => right.scrollHeight - left.scrollHeight);
  return scrollable.slice(0, 4);
}

export function startHarvestScroll(): () => void {
  let ticks = 0;
  const id = window.setInterval(() => {
    const path = window.location.pathname;
    if (
      !isMarketplaceSearchPath(path) &&
      !isMarketplaceInboxPath(path) &&
      !isFacebookSearchPath(path)
    ) {
      return;
    }
    ticks += 1;
    if (ticks > MAX_TICKS) {
      return;
    }

    const step = Math.max(420, Math.round(window.innerHeight * 0.85));
    /*
     * Marketplace search also uses nested scroll panes. Window scroll alone often
     * does nothing until the tab is focused, which made Final look done too early.
     */
    const targets = scrollTargets();
    if (targets.length) {
      for (const node of targets) {
        node.scrollTop = Math.min(node.scrollHeight, node.scrollTop + step);
      }
    }
    window.scrollBy(0, step);
  }, GAP_MS);
  return () => window.clearInterval(id);
}
