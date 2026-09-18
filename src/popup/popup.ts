import { readSettings, writeEnabled, writeSubstring } from "@src/shared/settings";

const enabledBox = document.getElementById("enabled") as HTMLInputElement | null;
const substringBox = document.getElementById("substring") as HTMLInputElement | null;

void readSettings().then((settings) => {
  if (enabledBox) {
    enabledBox.checked = settings.enabled;
  }
  if (substringBox) {
    substringBox.checked = settings.substring;
  }
});

enabledBox?.addEventListener("change", () => {
  void writeEnabled(Boolean(enabledBox.checked));
});

substringBox?.addEventListener("change", () => {
  void writeSubstring(Boolean(substringBox.checked));
});
