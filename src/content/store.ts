import { mergeListing, normalizeListing } from "@src/shared/listing-quality";
import type { ListingRecord } from "@src/shared/types";

export class ListingStore {
  private readonly byId = new Map<string, ListingRecord>();

  merge(listings: ListingRecord[]): void {
    for (const raw of listings) {
      const listing = normalizeListing(raw);
      const keys = [listing.id, listing.numericId].filter(Boolean);
      const previous = keys.map((key) => this.byId.get(key)).find(Boolean);
      const next = mergeListing(previous, listing);
      for (const key of keys) {
        this.byId.set(key, next);
      }
    }
  }

  get(id: string): ListingRecord | undefined {
    return this.byId.get(id);
  }

  all(): ListingRecord[] {
    const seen = new Set<ListingRecord>();
    const rows: ListingRecord[] = [];
    for (const row of this.byId.values()) {
      if (seen.has(row)) {
        continue;
      }
      seen.add(row);
      rows.push(row);
    }
    return rows;
  }

  clear(): void {
    this.byId.clear();
  }

  size(): number {
    return this.all().length;
  }
}
