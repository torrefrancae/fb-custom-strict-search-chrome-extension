import type { ListingRecord } from "@src/shared/types";

export class ListingStore {
  private readonly byId = new Map<string, ListingRecord>();

  merge(listings: ListingRecord[]): void {
    for (const listing of listings) {
      const keys = [listing.id, listing.numericId].filter(Boolean);
      const previous = keys.map((key) => this.byId.get(key)).find(Boolean);
      const next: ListingRecord = {
        id: listing.id,
        numericId: listing.numericId || previous?.numericId || "",
        title: listing.title || previous?.title || "",
        description: listing.description || previous?.description || ""
      };

      if (previous && previous.description.length > next.description.length) {
        next.description = previous.description;
      }
      if (previous && previous.title.length > next.title.length) {
        next.title = previous.title;
      }

      for (const key of keys) {
        this.byId.set(key, next);
      }
    }
  }

  get(id: string): ListingRecord | undefined {
    return this.byId.get(id);
  }
}
