export type AppSettings = {
  enabled: boolean;
  substring: boolean;
  exclude: string;
  matchRegex: string;
  priceRanges: string;
  lastQuery: string;
  lastMode: "facebook" | "marketplace" | "buying" | "selling";
};

const DEFAULTS: AppSettings = {
  enabled: true,
  substring: true,
  exclude: "",
  matchRegex: "",
  priceRanges: "",
  lastQuery: "",
  lastMode: "marketplace"
};

type ChromeStorage = {
  storage?: {
    local: {
      get: (keys: AppSettings) => Promise<Partial<AppSettings>>;
      set: (value: Partial<AppSettings>) => Promise<void>;
    };
    onChanged?: {
      addListener: (
        cb: (
          changes: Record<string, { newValue?: boolean | string }>,
          area: string
        ) => void
      ) => void;
    };
  };
};

function chromeApi(): ChromeStorage | undefined {
  return (globalThis as { chrome?: ChromeStorage }).chrome;
}

export async function readSettings(): Promise<AppSettings> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return { ...DEFAULTS };
  }

  const stored = await local.get(DEFAULTS);
  return {
    enabled: stored.enabled !== false,
    substring: stored.substring !== false,
    exclude: typeof stored.exclude === "string" ? stored.exclude : "",
    matchRegex: typeof stored.matchRegex === "string" ? stored.matchRegex : "",
    priceRanges: typeof stored.priceRanges === "string" ? stored.priceRanges : "",
    lastQuery: typeof stored.lastQuery === "string" ? stored.lastQuery : "",
    lastMode:
      stored.lastMode === "buying" ||
      stored.lastMode === "selling" ||
      stored.lastMode === "marketplace" ||
      stored.lastMode === "facebook"
        ? stored.lastMode
        : "marketplace"
  };
}

export async function readEnabled(): Promise<boolean> {
  return (await readSettings()).enabled;
}

export async function writeEnabled(enabled: boolean): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ enabled });
}

export async function writeSubstring(substring: boolean): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ substring });
}

export async function writeExclude(exclude: string): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ exclude });
}

export async function writeMatchRegex(matchRegex: string): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ matchRegex });
}

export async function writePriceRanges(priceRanges: string): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ priceRanges });
}

export async function writeLastQuery(lastQuery: string): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ lastQuery });
}

export async function writeLastMode(lastMode: AppSettings["lastMode"]): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }
  await local.set({ lastMode });
}

export function onSettingsChange(listener: (settings: AppSettings) => void): void {
  chromeApi()?.storage?.onChanged?.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.enabled ||
        changes.substring ||
        changes.exclude ||
        changes.matchRegex ||
        changes.priceRanges)
    ) {
      void readSettings().then(listener);
    }
  });
}
