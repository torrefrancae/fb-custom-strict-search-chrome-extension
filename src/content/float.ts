import { persistFloat, readSavedFloat } from "@src/content/float-store";
import { dockBelowRect, marketplaceSearchRect } from "@src/content/searchbox";

export type FloatEdge = "left" | "right";

export type FloatBox = {
  left: number;
  top: number;
  edge: FloatEdge;
  width?: number;
};

const MARGIN = 12;
const THRESHOLD = 6;
const FLING = 0.35;
const FALLBACK_WIDTH = 236;

export function snapFloatRect(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportW: number,
  viewportH: number,
  edge?: FloatEdge
): FloatBox {
  const nextEdge = edge ?? (left + width / 2 < viewportW / 2 ? "left" : "right");
  const maxTop = Math.max(MARGIN, viewportH - height - MARGIN);
  return {
    edge: nextEdge,
    width,
    left: nextEdge === "left" ? MARGIN : Math.max(MARGIN, viewportW - width - MARGIN),
    top: Math.min(Math.max(MARGIN, top), maxTop)
  };
}

export function pickSnapEdge(left: number, width: number, viewportW: number, vx: number): FloatEdge {
  if (Math.abs(vx) >= FLING) {
    return vx < 0 ? "left" : "right";
  }
  return left + width / 2 < viewportW / 2 ? "left" : "right";
}

function searchWidth(): number | null {
  const search = marketplaceSearchRect(document);
  return search ? Math.round(search.width) : null;
}

function applyWidth(root: HTMLElement, width?: number): number {
  const next = Math.max(FALLBACK_WIDTH, Math.round(width || searchWidth() || root.offsetWidth || FALLBACK_WIDTH));
  root.style.width = `${next}px`;
  return next;
}

function place(root: HTMLElement, box: FloatBox, animate: boolean): void {
  const width = applyWidth(root, box.width);
  root.classList.toggle("fbx-snap", animate);
  root.classList.add("fbx-placed");
  root.dataset.fbxEdge = box.edge;
  root.style.left = `${Math.round(box.left)}px`;
  root.style.top = `${Math.round(box.top)}px`;
  box.width = width;
}

function snapRoot(root: HTMLElement, edge?: FloatEdge, animate = true): FloatBox {
  const box = root.getBoundingClientRect();
  const width = applyWidth(root);
  const next = snapFloatRect(
    box.left,
    box.top,
    width,
    box.height,
    window.innerWidth,
    window.innerHeight,
    edge
  );
  place(root, next, animate);
  return next;
}

function dockRoot(root: HTMLElement): boolean {
  const search = marketplaceSearchRect(document);
  if (!search) {
    return false;
  }
  applyWidth(root, search.width);
  const next = dockBelowRect(search, root.offsetHeight, window.innerWidth, window.innerHeight);
  root.dataset.fbxDock = "1";
  place(root, { ...next, edge: "left" }, false);
  return true;
}

function isLockedTarget(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof Element &&
      target.closest("input, textarea, .fbx-exact-toggle, .fbx-exact-mode")
  );
}

export function bindFloat(root: HTMLElement): void {
  if (root.dataset.fbxFloat === "1") {
    return;
  }
  root.dataset.fbxFloat = "1";

  const shell = root.querySelector<HTMLElement>(".fbx-exact-shell") || root;
  let docked = true;
  let drag: {
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
    lastX: number;
    lastT: number;
    vx: number;
  } | null = null;

  const layout = (): void => {
    if (docked && dockRoot(root)) {
      return;
    }
    root.dataset.fbxDock = "0";
    snapRoot(root, root.dataset.fbxEdge === "left" ? "left" : "right", false);
  };

  void readSavedFloat().then((saved) => {
    if (saved) {
      docked = false;
      root.dataset.fbxDock = "0";
      place(root, saved, false);
    }
    requestAnimationFrame(layout);
  });

  shell.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isLockedTarget(event.target)) {
      return;
    }
    const box = root.getBoundingClientRect();
    drag = {
      x: event.clientX,
      y: event.clientY,
      left: box.left,
      top: box.top,
      moved: false,
      lastX: event.clientX,
      lastT: performance.now(),
      vx: 0
    };
    root.classList.remove("fbx-snap");
    root.classList.add("fbx-placed");
    shell.setPointerCapture(event.pointerId);
  });

  shell.addEventListener("pointermove", (event) => {
    if (!drag) {
      return;
    }
    const now = performance.now();
    const dt = now - drag.lastT;
    if (dt > 0) {
      drag.vx = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastT = now;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < THRESHOLD) {
      return;
    }
    drag.moved = true;
    docked = false;
    root.dataset.fbxDock = "0";
    root.classList.add("fbx-dragging");
    place(
      root,
      {
        left: drag.left + dx,
        top: drag.top + dy,
        width: root.offsetWidth,
        edge: pickSnapEdge(drag.left + dx, root.offsetWidth, window.innerWidth, drag.vx)
      },
      false
    );
  });

  const endDrag = (): void => {
    if (!drag) {
      return;
    }
    const moved = drag.moved;
    const vx = drag.vx;
    drag = null;
    root.classList.remove("fbx-dragging");
    if (!moved && docked) {
      dockRoot(root);
      return;
    }
    docked = false;
    root.dataset.fbxDock = "0";
    persistFloat(
      snapRoot(
        root,
        pickSnapEdge(root.getBoundingClientRect().left, root.offsetWidth, window.innerWidth, vx),
        true
      )
    );
  };

  shell.addEventListener("pointerup", endDrag);
  shell.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", layout);
  window.addEventListener("scroll", () => {
    if (docked) {
      dockRoot(root);
    }
  }, true);
  window.setInterval(() => {
    if (docked) {
      dockRoot(root);
    }
  }, 800);
}
