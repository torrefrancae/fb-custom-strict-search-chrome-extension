import { highlightQuery } from "@src/content/highlight";
import { buildPhotoCarousel } from "@src/search/photo-carousel";
import { buildTitleRow } from "@src/search/title-row";
import { clipText, type ResultCard } from "@src/shared/results";

function textEl(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function clipPreview(value: string): string {
  return clipText(value, 280);
}

function renderLoading(root: HTMLElement, detail: string): void {
  const panel = document.createElement("div");
  panel.className = "loading-panel";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");
  const spinner = document.createElement("div");
  spinner.className = "loading-spinner";
  spinner.setAttribute("aria-hidden", "true");
  panel.append(spinner);
  panel.append(textEl("div", "loading-title", "Search running"));
  panel.append(textEl("p", "loading-detail", detail));
  root.append(panel);
}

export function renderResults(
  root: HTMLElement,
  cards: ResultCard[],
  query: string,
  substring: boolean,
  loading: boolean,
  onOpen: (card: ResultCard) => void,
  loadingDetail = "Collecting matches from Facebook. Stay on this page."
): void {
  root.replaceChildren();
  root.setAttribute("aria-busy", loading && cards.length === 0 ? "true" : "false");
  if (loading && cards.length === 0) {
    renderLoading(root, loadingDetail);
    return;
  }

  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "result-row";
    article.dataset.listingId = card.id;
    article.tabIndex = 0;
    article.setAttribute("role", "button");
    article.setAttribute("aria-label", `View ${card.title}`);

    const photos = card.photos.length ? card.photos : card.photo ? [card.photo] : [];
    const fallback = card.kind === "listing" ? "No photo" : "Chat";
    article.append(buildPhotoCarousel(photos, fallback));

    const info = document.createElement("div");
    info.className = "info";

    if (card.kind === "buying" || card.kind === "selling") {
      info.append(textEl("div", "badge", card.kind === "buying" ? "Buying" : "Selling"));
    }
    if (card.price) {
      info.append(textEl("div", "price", card.price));
    }
    info.append(buildTitleRow(card, query, substring));
    if (card.description) {
      const note = textEl("div", "note", clipPreview(card.description));
      highlightQuery(note, query, substring);
      info.append(note);
    }
    article.append(info);

    const open = (): void => onOpen(card);
    article.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".open-external")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      open();
    });
    article.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        open();
      }
    });
    root.append(article);
  }
}
