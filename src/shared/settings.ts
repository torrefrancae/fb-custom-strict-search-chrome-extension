export type AppSettings = {
  enabled: boolean;
  substring: boolean;
};

const DEFAULTS: AppSettings = { enabled: true, substring: true };

type ChromeStorage = {
  storage?: {
    local: {
      get: (keys: AppSettings) => Promise<Partial<AppSettings>>;
      set: (value: Partial<AppSettings>) => Promise<void>;
    };
    onChanged?: {
      addListener: (
        cb: (changes: Record<string, { newValue?: boolean }>, area: string) => void
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
    substring: stored.substring !== false
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

export function onSettingsChange(listener: (settings: AppSettings) => void): void {
  chromeApi()?.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && (changes.enabled || changes.substring)) {
      void readSettings().then(listener);
    }
  });
}
