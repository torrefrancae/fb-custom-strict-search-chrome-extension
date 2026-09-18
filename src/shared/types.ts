export type ListingRecord = {
  id: string;
  numericId: string;
  title: string;
  description: string;
};

export type ExactSearchState = {
  enabled: boolean;
  substring: boolean;
  query: string;
  shown: number;
  hidden: number;
  pending: number;
  adsHidden: number;
};

export const MESSAGE_SOURCE = "fbx-exact";

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

export type PageMessage = PageListingsMessage | PageNavigateMessage;
