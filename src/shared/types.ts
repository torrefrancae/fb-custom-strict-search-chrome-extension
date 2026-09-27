export type SearchMode = "marketplace" | "buying" | "selling";

export type ListingKind = "listing" | "buying" | "selling";

export type ListingRecord = {
  id: string;
  numericId: string;
  title: string;
  description: string;
  price: string;
  photo: string;
  photos: string[];
  href: string;
  kind: ListingKind;
  party: string;
};

export type ExactSearchState = {
  enabled: boolean;
  substring: boolean;
  query: string;
  exclude: string;
  shown: number;
  hidden: number;
  pending: number;
  adsHidden: number;
};

export const MESSAGE_SOURCE = "fbx-exact";
export const RUNTIME_SOURCE = "fbx-search";

export type PageListingsMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "listings";
  listings: ListingRecord[];
};

export type PageNavigateMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "navigate";
  href: string;
};

export type PageSetModeMessage = {
  source: typeof MESSAGE_SOURCE;
  type: "set-mode";
  mode: SearchMode;
};

export type PageMessage = PageListingsMessage | PageNavigateMessage | PageSetModeMessage;

export type StartSearchMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "start-search";
  query: string;
  mode: SearchMode;
};

export type StartHarvestMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "start-harvest";
  mode: SearchMode;
};

export type HarvestListingsMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "harvest-listings";
  listings: ListingRecord[];
  href: string;
  mode: SearchMode;
};

export type SnapshotMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "snapshot";
  query: string;
  href: string;
  mode: SearchMode;
  listings: ListingRecord[];
};

export type RequestSnapshotMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "request-snapshot";
};

export type FocusHarvestMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "focus-harvest";
};

export type FetchImageMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "fetch-image";
  url: string;
};

export type FetchImageResponse = {
  source: typeof RUNTIME_SOURCE;
  type: "fetch-image-result";
  url: string;
  dataUrl: string;
};

export type FetchListingDetailMessage = {
  source: typeof RUNTIME_SOURCE;
  type: "fetch-listing-detail";
  href: string;
  id: string;
};

export type FetchListingDetailResponse = {
  source: typeof RUNTIME_SOURCE;
  type: "fetch-listing-detail-result";
  id: string;
  listing: ListingRecord | null;
};

export type RuntimeMessage =
  | StartSearchMessage
  | StartHarvestMessage
  | HarvestListingsMessage
  | SnapshotMessage
  | RequestSnapshotMessage
  | FocusHarvestMessage
  | FetchImageMessage
  | FetchListingDetailMessage;
