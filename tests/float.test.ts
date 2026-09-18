import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickSnapEdge, snapFloatRect } from "@src/content/float";
import { dockBelowRect } from "@src/content/searchbox";

describe("snapFloatRect", () => {
  it("snaps a right-side panel to the right margin", () => {
    const box = snapFloatRect(900, 120, 236, 96, 1200, 800);
    assert.equal(box.edge, "right");
    assert.equal(box.left, 1200 - 236 - 12);
    assert.equal(box.top, 120);
  });

  it("snaps a left-side panel to the left margin", () => {
    const box = snapFloatRect(40, 200, 236, 96, 1200, 800);
    assert.equal(box.edge, "left");
    assert.equal(box.left, 12);
    assert.equal(box.top, 200);
  });

  it("clamps a tall drop so the panel stays on screen", () => {
    const box = snapFloatRect(20, 900, 236, 96, 1200, 800);
    assert.equal(box.top, 800 - 96 - 12);
  });
});

describe("dockBelowRect", () => {
  it("sits just under the search bar and matches its width", () => {
    const box = dockBelowRect({ left: 16, top: 131, width: 328, height: 36 }, 180, 1440, 900);
    assert.equal(box.left, 16);
    assert.equal(box.top, 175);
    assert.equal(box.width, 328);
  });

  it("keeps a short viewport from clipping the panel", () => {
    const box = dockBelowRect({ left: 16, top: 700, width: 328, height: 180 }, 180, 800, 820);
    assert.equal(box.top, 820 - 180 - 12);
    assert.equal(box.width, 328);
  });
});

describe("pickSnapEdge", () => {
  it("uses a left flick even when the panel is still on the right", () => {
    assert.equal(pickSnapEdge(900, 236, 1200, -0.8), "left");
  });

  it("uses the nearer edge when the flick is slow", () => {
    assert.equal(pickSnapEdge(900, 236, 1200, 0.05), "right");
  });
});
