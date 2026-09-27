import { highlightQuery } from "@src/content/highlight";
import { buildPhotoCarousel } from "@src/search/photo-carousel";
import { buildTitleRow } from "@src/search/title-row";
import type { ResultCard } from "@src/shared/results";
import {
  RUNTIME_SOURCE,
  type FetchListingDetailResponse
} from "@src/shared/types";

function textEl(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function runtime(): typeof chrome.runtime | undefined {
  return typeof chrome !== "undefined" ? chrome.runtime : undefined;
}

function kindLabel(kind: ResultCard["kind"]): string {
  if (kind === "buying") {
    return "Buying chat";
  }
  if (kind === "selling") {
    return "Selling chat";
  }
  return "Marketplace listing";
}

export type ResultModalApi = {
  open: (card: ResultCard, query: string, substring: boolean) => void;
  close: () => void;
};

export function createResultModal(host: HTMLElement): ResultModalApi {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.hidden = true;

  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Listing details");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "x";

  const body = document.createElement("div");
  body.className = "modal-body";

  dialog.append(closeBtn, body);
  backdrop.append(dialog);
  host.append(backdrop);

  let activeId = "";

  const close = (): void => {
    activeId = "";
    backdrop.hidden = true;
    body.replaceChildren();
    document.body.classList.remove("modal-open");
  };

  const paintCard = (card: ResultCard, query: string, substring: boolean, loadingDetail: boolean): void => {
    body.replaceChildren();
    const photos = card.photos.length ? card.photos : card.photo ? [card.photo] : [];
    const media = buildPhotoCarousel(photos, card.kind === "listing" ? "No photo" : "Chat");
    media.classList.add("modal-media");
    body.append(media);

    const info = document.createElement("div");
    info.className = "modal-info";
    info.append(textEl("div", "badge", kindLabel(card.kind)));
    if (card.price) {
      info.append(textEl("div", "price", card.price));
    }
    info.append(buildTitleRow(card, query, substring, true));
    if (card.party && card.party !== card.title) {
      info.append(textEl("div", "party", card.party));
    }
    if (card.description) {
      const note = textEl("div", "note", card.description);
      highlightQuery(note, query, substring);
      info.append(note);
    } else if (loadingDetail) {
      info.append(textEl("div", "note muted", "Loading description..."));
    } else if (card.kind === "listing") {
      info.append(textEl("div", "note muted", "No description found for this listing."));
    } else {
      info.append(textEl("div", "note muted", "Chat preview from your inbox harvest."));
    }
    body.append(info);
  };

  const enrich = (card: ResultCard, query: string, substring: boolean): void => {
    if (card.kind !== "listing" || !card.href) {
      return;
    }
    const api = runtime();
    if (!api?.sendMessage) {
      return;
    }
    paintCard(card, query, substring, !card.description);
    api.sendMessage(
      { source: RUNTIME_SOURCE, type: "fetch-listing-detail", href: card.href, id: card.id },
      (reply: FetchListingDetailResponse | undefined) => {
        if (activeId !== card.id) {
          return;
        }
        const listing = reply?.listing;
        if (!listing) {
          paintCard(card, query, substring, false);
          return;
        }
        const next: ResultCard = {
          ...card,
          title: listing.title && listing.title !== listing.numericId ? listing.title : card.title,
          description: listing.description || card.description,
          price: listing.price || card.price,
          photo: listing.photo || card.photo,
          photos: listing.photos.length ? listing.photos : card.photos
        };
        paintCard(next, query, substring, false);
      }
    );
  };

  const open = (card: ResultCard, query: string, substring: boolean): void => {
    activeId = card.id;
    paintCard(card, query, substring, false);
    backdrop.hidden = false;
    document.body.classList.add("modal-open");
    closeBtn.focus();
    enrich(card, query, substring);
  };

  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    close();
  });
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      close();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) {
      close();
    }
  });

  return { open, close };
}
