import { marketplaceSearchUrl } from "@src/shared/query";
import type { ExactSearchState } from "@src/shared/types";

const ROOT_ID = "fbx-exact-root";

export function ensureOverlay(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.innerHTML = `
    <div class="fbx-exact-bar">
      <div class="fbx-exact-copy">
        <strong>Smart Search</strong>
        <span data-fbx="status">Waiting for a Marketplace search.</span>
      </div>
      <form class="fbx-exact-form" data-fbx="form">
        <input type="search" name="q" placeholder="Every word must be in the title or description" data-fbx="input" />
        <button type="submit">Search</button>
      </form>
      <label class="fbx-exact-toggle">
        <input type="checkbox" data-fbx="enabled" checked />
        On
      </label>
    </div>
  `;
  document.documentElement.appendChild(root);
  return root;
}

export function bindOverlay(
  root: HTMLElement,
  handlers: {
    onSearch: (query: string) => void;
    onToggle: (enabled: boolean) => void;
  }
): void {
  const form = root.querySelector<HTMLFormElement>("[data-fbx=form]");
  const input = root.querySelector<HTMLInputElement>("[data-fbx=input]");
  const enabled = root.querySelector<HTMLInputElement>("[data-fbx=enabled]");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = (input?.value || "").trim();
    if (query) {
      handlers.onSearch(query);
    }
  });

  enabled?.addEventListener("change", () => {
    handlers.onToggle(Boolean(enabled.checked));
  });
}

export function renderOverlay(root: HTMLElement, state: ExactSearchState): void {
  const status = root.querySelector("[data-fbx=status]");
  const input = root.querySelector<HTMLInputElement>("[data-fbx=input]");
  const enabled = root.querySelector<HTMLInputElement>("[data-fbx=enabled]");

  if (input && input.value !== state.query) {
    input.value = state.query;
  }
  if (enabled) {
    enabled.checked = state.enabled;
  }
  if (!status) {
    return;
  }

  if (!state.query) {
    status.textContent = "Use Marketplace search. Items stay only if every word is in the title or description.";
    return;
  }
  if (!state.enabled) {
    status.textContent = `Filter off. Facebook results for "${state.query}" are unchanged.`;
    return;
  }

  status.textContent = `${state.shown} exact matches kept, ${state.hidden} hidden, ${state.adsHidden} ads hidden.`;
}

export function goToMarketplaceSearch(query: string): void {
  window.location.assign(marketplaceSearchUrl(window.location.origin, query));
}
