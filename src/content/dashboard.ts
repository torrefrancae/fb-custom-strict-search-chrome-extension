import type { ExactSearchState } from "@src/shared/types";

export type DashboardView = {
  active: boolean;
  live: "on" | "ready" | "off";
  liveText: string;
  queryText: string;
  shown: string;
  hidden: string;
  ads: string;
  matchPct: number;
  matchText: string;
  note: string;
};

export function dashboardView(state: ExactSearchState): DashboardView {
  const total = state.shown + state.hidden;
  const matchPct = total ? Math.round((state.shown / total) * 100) : 0;
  const active = Boolean(state.enabled && state.query);

  let live: DashboardView["live"] = "off";
  let liveText = "Paused";
  if (active) {
    live = "on";
    liveText = "Watching";
  } else if (state.enabled) {
    live = "ready";
    liveText = "Ready";
  }

  let queryText = "No Marketplace search yet";
  if (state.query) {
    queryText = state.query;
  }

  let matchText = "No results yet";
  if (state.query && !state.enabled) {
    matchText = "Filter is off";
  } else if (active && total > 0) {
    matchText = `${state.shown} of ${total} listings match`;
  } else if (active) {
    matchText = "Waiting for listings";
  }

  let note = "Search on Marketplace. This panel only filters those results.";
  if (state.query && !state.enabled) {
    note = "Filter is off. Facebook is showing every result.";
  } else if (active && total === 0) {
    note = "Waiting for search results to load.";
  } else if (active && state.shown === 0 && state.pending > 0) {
    note = "None match yet. Still checking listing details.";
  } else if (active && state.shown === 0) {
    note = "None of these listings include every search word.";
  } else if (active) {
    note = "Only items with every search word stay visible.";
  }

  return {
    active,
    live,
    liveText,
    queryText,
    shown: String(state.shown),
    hidden: String(state.hidden),
    ads: String(state.adsHidden),
    matchPct,
    matchText,
    note
  };
}
