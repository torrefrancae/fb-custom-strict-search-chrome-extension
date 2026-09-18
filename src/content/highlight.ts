import { findTokenRanges, tokenize } from "@src/shared/match";

const MARK_CLASS = "fbx-exact-mark";

function clearMarks(root: ParentNode): void {
  for (const mark of [...root.querySelectorAll(`mark.${MARK_CLASS}`)]) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize();
  }
}

function wrapNode(node: Text, tokens: string[]): void {
  const text = node.nodeValue || "";
  const ranges = findTokenRanges(text, tokens);
  if (!ranges.length || !node.parentNode) {
    return;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      fragment.append(text.slice(cursor, range.start));
    }
    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    mark.textContent = text.slice(range.start, range.end);
    fragment.append(mark);
    cursor = range.end;
  }
  if (cursor < text.length) {
    fragment.append(text.slice(cursor));
  }
  node.parentNode.replaceChild(fragment, node);
}

export function clearHighlights(root: ParentNode): void {
  if (root instanceof Element) {
    root.removeAttribute("data-fbx-hl");
  }
  clearMarks(root);
}

export function highlightQuery(root: HTMLElement, query: string): void {
  const tokens = tokenize(query);
  const key = tokens.join("|");
  if (root.getAttribute("data-fbx-hl") === key) {
    return;
  }

  clearMarks(root);
  if (!tokens.length) {
    root.removeAttribute("data-fbx-hl");
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || parent.closest(`mark.${MARK_CLASS}, script, style, #fbx-exact-root`)) {
      continue;
    }
    if (!(node.nodeValue || "").trim()) {
      continue;
    }
    nodes.push(node);
  }

  for (const node of nodes) {
    wrapNode(node, tokens);
  }
  root.setAttribute("data-fbx-hl", key);
}
