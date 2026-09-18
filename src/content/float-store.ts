const KEY = "fbxFloat2";

export type SavedFloat = {
  left: number;
  top: number;
  edge: "left" | "right";
  width?: number;
};

type LocalStore = {
  get: (key: string) => Promise<Record<string, SavedFloat | undefined>>;
  set: (value: Record<string, SavedFloat>) => Promise<void>;
};

function localStore(): LocalStore | undefined {
  return (globalThis as { chrome?: { storage?: { local?: LocalStore } } }).chrome?.storage?.local;
}

export async function readSavedFloat(): Promise<SavedFloat | null> {
  const local = localStore();
  if (!local) {
    return null;
  }
  const stored = await local.get(KEY);
  const value = stored[KEY];
  if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.top)) {
    return null;
  }
  return {
    left: value.left,
    top: value.top,
    width: Number.isFinite(value.width) ? value.width : undefined,
    edge: value.edge === "left" ? "left" : "right"
  };
}

export function persistFloat(box: SavedFloat): void {
  const local = localStore();
  if (!local) {
    return;
  }
  void local.set({ [KEY]: box });
}
