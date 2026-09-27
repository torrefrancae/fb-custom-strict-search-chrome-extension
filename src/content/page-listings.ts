import { collectCards, descriptionFromCard } from "@src/content/cards";
import { isHttpsPhoto, normalizeListing, uniquePhotos } from "@src/shared/listing-quality";
import type { ListingRecord } from "@src/shared/types";

const PRICE_RE = /(?:php|usd|eur|gbp|cad|aud|[$₱€£¥])\s?[\d,.]+/i;

function photosFromRoot(root: HTMLElement): string[] {
  const urls: string[] = [];
  for (const img of root.querySelectorAll("img")) {
    const candidates = [
      img.currentSrc,
      img.src,
      ...(img.srcset || "")
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0] || "")
        .filter(Boolean)
    ];
    for (const candidate of candidates) {
      if (candidate && isHttpsPhoto(candidate)) {
        urls.push(candidate);
      }
    }
  }
  return uniquePhotos(urls);
}

function realItemHref(root: HTMLElement, id: string): string {
  const anchors = [
    ...(root.matches("a") ? [root as HTMLAnchorElement] : []),
    ...root.querySelectorAll<HTMLAnchorElement>('a[href*="/marketplace/item/"]')
  ];
  for (const anchor of anchors) {
    const href = (anchor.href || "").split("?")[0] || "";
    if (href.includes(`/marketplace/item/${id}`)) {
      return href.endsWith("/") ? href : `${href}/`;
    }
  }
  return "";
}

export function listingsFromCards(root: ParentNode = document): ListingRecord[] {
  return collectCards(root)
    .map((card) => {
      const href = realItemHref(card.root, card.id);
      const photos = photosFromRoot(card.root);
      if (!href || !photos.length) {
        return null;
      }
      const price =
        (card.root.innerText || "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => PRICE_RE.test(line)) || "";
      return normalizeListing({
        id: card.id,
        numericId: card.id,
        title: card.title,
        description: descriptionFromCard(card.root, card.title),
        price,
        photo: photos[0] || "",
        photos,
        href,
        kind: "listing",
        party: ""
      });
    })
    .filter((listing): listing is ListingRecord => Boolean(listing && /^\d{6,}$/.test(listing.numericId)));
}
