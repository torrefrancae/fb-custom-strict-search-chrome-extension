import { RUNTIME_SOURCE, type FetchImageResponse } from "@src/shared/types";

function textEl(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function runtime(): typeof chrome.runtime | undefined {
  return typeof chrome !== "undefined" ? chrome.runtime : undefined;
}

function loadThumb(img: HTMLImageElement, url: string, fallbackLabel: string): void {
  let triedProxy = false;
  const showMissing = (): void => {
    img.replaceWith(textEl("div", "thumb missing", fallbackLabel));
  };

  img.addEventListener("error", () => {
    if (triedProxy || !url.startsWith("https://")) {
      showMissing();
      return;
    }
    triedProxy = true;
    const api = runtime();
    if (!api?.sendMessage) {
      showMissing();
      return;
    }
    api.sendMessage(
      { source: RUNTIME_SOURCE, type: "fetch-image", url },
      (reply: FetchImageResponse | undefined) => {
        if (reply?.type === "fetch-image-result" && reply.dataUrl) {
          img.src = reply.dataUrl;
          return;
        }
        showMissing();
      }
    );
  });

  img.src = url;
}

export function buildPhotoCarousel(photos: string[], fallbackLabel: string): HTMLElement {
  const media = document.createElement("div");
  media.className = "media";

  if (!photos.length) {
    media.append(textEl("div", "thumb missing", fallbackLabel));
    return media;
  }

  const strip = document.createElement("div");
  strip.className = "photo-strip";
  strip.setAttribute("role", "list");

  for (const url of photos) {
    const cell = document.createElement("div");
    cell.className = "photo-cell";
    cell.setAttribute("role", "listitem");
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    img.loading = "lazy";
    loadThumb(img, url, fallbackLabel);
    cell.append(img);
    strip.append(cell);
  }

  media.append(strip);
  return media;
}
