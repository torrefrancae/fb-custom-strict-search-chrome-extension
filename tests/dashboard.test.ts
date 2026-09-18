import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dashboardView } from "@src/content/dashboard";
import type { ExactSearchState } from "@src/shared/types";

function state(partial: Partial<ExactSearchState>): ExactSearchState {
  return {
    enabled: true,
    substring: true,
    query: "ninja 300",
    shown: 8,
    hidden: 14,
    pending: 0,
    adsHidden: 3,
    ...partial
  };
}

describe("dashboardView", () => {
  it("turns filter counts into a plain match line", () => {
    const view = dashboardView(state({}));
    assert.equal(view.live, "on");
    assert.equal(view.liveText, "Watching");
    assert.equal(view.queryText, "ninja 300");
    assert.equal(view.shown, "8");
    assert.equal(view.hidden, "14");
    assert.equal(view.ads, "3");
    assert.equal(view.matchPct, 36);
    assert.equal(view.matchText, "8 of 22 listings match");
    assert.match(view.note, /every search word/);
  });

  it("stays idle until Marketplace has a search", () => {
    const view = dashboardView(state({ query: "", shown: 0, hidden: 0, adsHidden: 0 }));
    assert.equal(view.live, "ready");
    assert.equal(view.liveText, "Ready");
    assert.equal(view.queryText, "No Marketplace search yet");
    assert.equal(view.matchText, "No results yet");
    assert.match(view.note, /Search on Marketplace/);
  });

  it("explains when the filter is paused", () => {
    const view = dashboardView(state({ enabled: false }));
    assert.equal(view.live, "off");
    assert.equal(view.liveText, "Paused");
    assert.equal(view.matchText, "Filter is off");
    assert.match(view.note, /showing every result/);
  });

  it("mentions listing details only when nothing matches yet", () => {
    const view = dashboardView(state({ shown: 0, hidden: 14, pending: 4 }));
    assert.equal(view.note, "None match yet. Still checking listing details.");
  });

  it("keeps the main note after some listings already match", () => {
    const view = dashboardView(state({ pending: 4 }));
    assert.match(view.note, /every search word/);
  });
});
