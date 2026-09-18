import { dashboardView } from "@src/content/dashboard";
import { bindFloat } from "@src/content/float";
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
    <div class="fbx-exact-shell">
      <div class="fbx-exact-bar">
        <div class="fbx-exact-head" data-fbx="handle">
          <span class="fbx-exact-grip" aria-hidden="true"></span>
          <strong>Smart Search</strong>
          <span class="fbx-exact-live" data-fbx="live">Ready</span>
          <label class="fbx-exact-toggle" title="Turn filter on or off">
            <input type="checkbox" data-fbx="enabled" checked />
          </label>
        </div>
        <div class="fbx-exact-query">
          <span>Search</span>
          <b data-fbx="query">No Marketplace search yet</b>
        </div>
        <div class="fbx-exact-meter-row">
          <span data-fbx="match">No results yet</span>
          <div class="fbx-exact-meter" aria-hidden="true">
            <div class="fbx-exact-meter-fill" data-fbx="meter"></div>
          </div>
        </div>
        <div class="fbx-exact-stats">
          <div class="fbx-exact-stat" data-kind="shown">
            <b data-fbx="shown">0</b>
            <span>Visible</span>
          </div>
          <div class="fbx-exact-stat" data-kind="hidden">
            <b data-fbx="hidden">0</b>
            <span>Hidden</span>
          </div>
          <div class="fbx-exact-stat" data-kind="ads">
            <b data-fbx="ads">0</b>
            <span>Ads</span>
          </div>
        </div>
        <p class="fbx-exact-note" data-fbx="status" role="status">Search on Marketplace first.</p>
        <div class="fbx-exact-modes" role="group" aria-label="Match style">
          <label class="fbx-exact-mode">
            <input type="checkbox" data-fbx="substring" checked />
            <span>Contains</span>
          </label>
          <label class="fbx-exact-mode">
            <input type="checkbox" data-fbx="exact" />
            <span>Whole word</span>
          </label>
        </div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);
  return root;
}

export function setOverlayVisible(root: HTMLElement, visible: boolean): void {
  root.hidden = !visible;
  root.dataset.fbxPage = visible ? "on" : "off";
}

export function bindOverlay(
  root: HTMLElement,
  handlers: {
    onToggle: (enabled: boolean) => void;
    onSubstring: (substring: boolean) => void;
  }
): void {
  const enabled = root.querySelector<HTMLInputElement>("[data-fbx=enabled]");
  const substring = root.querySelector<HTMLInputElement>("[data-fbx=substring]");
  const exact = root.querySelector<HTMLInputElement>("[data-fbx=exact]");

  enabled?.addEventListener("change", () => {
    handlers.onToggle(Boolean(enabled.checked));
  });

  substring?.addEventListener("change", () => {
    const next = Boolean(substring.checked);
    if (exact) {
      exact.checked = !next;
    }
    handlers.onSubstring(next);
  });

  exact?.addEventListener("change", () => {
    const next = !exact.checked;
    if (substring) {
      substring.checked = next;
    }
    exact.checked = !next;
    handlers.onSubstring(next);
  });

  bindFloat(root);
}

function setText(root: HTMLElement, key: string, value: string): void {
  const node = root.querySelector(`[data-fbx=${key}]`);
  if (node) {
    node.textContent = value;
  }
}

export function renderOverlay(root: HTMLElement, state: ExactSearchState): void {
  const view = dashboardView(state);
  const enabled = root.querySelector<HTMLInputElement>("[data-fbx=enabled]");
  const substring = root.querySelector<HTMLInputElement>("[data-fbx=substring]");
  const exact = root.querySelector<HTMLInputElement>("[data-fbx=exact]");
  const live = root.querySelector("[data-fbx=live]");
  const meter = root.querySelector<HTMLElement>("[data-fbx=meter]");

  if (enabled) {
    enabled.checked = state.enabled;
  }
  if (substring) {
    substring.checked = state.substring;
  }
  if (exact) {
    exact.checked = !state.substring;
  }
  if (live) {
    live.setAttribute("data-live", view.live);
  }
  if (meter) {
    meter.style.width = `${view.matchPct}%`;
  }

  root.dataset.fbxActive = view.active ? "1" : "0";
  setText(root, "live", view.liveText);
  setText(root, "query", view.queryText);
  setText(root, "match", view.matchText);
  setText(root, "shown", view.shown);
  setText(root, "hidden", view.hidden);
  setText(root, "ads", view.ads);
  setText(root, "status", view.note);
}
