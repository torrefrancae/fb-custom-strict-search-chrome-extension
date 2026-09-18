import { readEnabled, writeEnabled } from "@src/shared/settings";

const checkbox = document.getElementById("enabled") as HTMLInputElement | null;

void readEnabled().then((enabled) => {
  if (checkbox) {
    checkbox.checked = enabled;
  }
});

checkbox?.addEventListener("change", () => {
  void writeEnabled(Boolean(checkbox.checked));
});
