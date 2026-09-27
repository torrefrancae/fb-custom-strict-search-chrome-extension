import { RUNTIME_SOURCE, type SearchMode, type SnapshotMessage } from "@src/shared/types";

const KEY = "harvest";

type StorageArea = {
  get: (keys: Record<string, unknown>) => Promise<Record<string, unknown>>;
  set: (value: Record<string, unknown>) => Promise<void>;
};

function local(): StorageArea | undefined {
  return (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome?.storage?.local;
}

export function emptySnapshot(query = "", mode: SearchMode = "marketplace"): SnapshotMessage {
  return {
    source: RUNTIME_SOURCE,
    type: "snapshot",
    query,
    href: "https://www.facebook.com",
    mode,
    listings: []
  };
}

export async function writeHarvest(snapshot: SnapshotMessage): Promise<void> {
  await local()?.set({ [KEY]: snapshot });
}

export async function readHarvest(): Promise<SnapshotMessage> {
  const stored = await local()?.get({ [KEY]: emptySnapshot() });
  const value = stored?.[KEY];
  if (value && typeof value === "object" && (value as SnapshotMessage).type === "snapshot") {
    const snap = value as SnapshotMessage;
    return {
      ...emptySnapshot(snap.query, snap.mode || "marketplace"),
      ...snap,
      mode: snap.mode || "marketplace",
      listings: snap.listings || []
    };
  }
  return emptySnapshot();
}

export function onHarvestChange(listener: (snapshot: SnapshotMessage) => void): void {
  const changed = (
    globalThis as {
      chrome?: {
        storage?: {
          onChanged?: {
            addListener: (
              cb: (changes: Record<string, { newValue?: SnapshotMessage }>, area: string) => void
            ) => void;
          };
        };
      };
    }
  ).chrome?.storage?.onChanged;
  changed?.addListener((changes, area) => {
    const next = changes[KEY]?.newValue;
    if (area === "local" && next?.type === "snapshot") {
      listener({
        ...emptySnapshot(next.query, next.mode || "marketplace"),
        ...next,
        mode: next.mode || "marketplace"
      });
    }
  });
}
