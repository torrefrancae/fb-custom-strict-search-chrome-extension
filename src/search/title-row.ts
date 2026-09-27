import { highlightQuery } from "@src/content/highlight";
import type { ResultCard } from "@src/shared/results";

function textEl(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

export function buildTitleRow(
  card: ResultCard,
  query: string,
  substring: boolean,
  heading = false
): HTMLElement {
  const row = document.createElement("div");
  row.className = "title-row";
  const title = textEl(heading ? "h2" : "div", "title", card.title || "Untitled");
  highlightQuery(title, query, substring);
  row.append(title);
  if (card.href) {
    const link = document.createElement("a");
    link.className = "open-external";
    link.href = card.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Open on Facebook");
    link.title = "Open on Facebook";
    link.textContent = "Open";
    link.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    row.append(link);
  }
  return row;
}
