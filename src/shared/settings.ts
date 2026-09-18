const DEFAULTS = { enabled: true };

type ChromeStorage = {
  storage?: {
    local: {
      get: (keys: typeof DEFAULTS) => Promise<typeof DEFAULTS>;
      set: (value: typeof DEFAULTS) => Promise<void>;
    };
  };
};

function chromeApi(): ChromeStorage | undefined {
  return (globalThis as { chrome?: ChromeStorage }).chrome;
}

export async function readEnabled(): Promise<boolean> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return true;
  }

  const stored = await local.get(DEFAULTS);
  return stored.enabled !== false;
}

export async function writeEnabled(enabled: boolean): Promise<void> {
  const local = chromeApi()?.storage?.local;
  if (!local) {
    return;
  }

  await local.set({ enabled });
}

export function onEnabledChange(listener: (enabled: boolean) => void): void {
  const chromeRuntime = (
    globalThis as {
      chrome?: {
        storage?: {
          onChanged: {
            addListener: (
              cb: (changes: Record<string, { newValue?: boolean }>, area: string) => void
            ) => void;
          };
        };
      };
    }
  ).chrome;

  chromeRuntime?.storage?.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) {
      listener(changes.enabled.newValue !== false);
    }
  });
}
