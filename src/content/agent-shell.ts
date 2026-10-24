const ROOT_ID = "fbx-agent-shell";
const STYLE_ID = "fbx-agent-shell-style";

function runtime(): typeof chrome.runtime | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const api = runtime();
  if (!api?.getURL) {
    return;
  }
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = api.getURL("content/agent-shell.css");
  document.documentElement.appendChild(link);
}

export function ensureAgentShell(): HTMLElement {
  ensureStyles();
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Facebook AI Agent");
  root.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "fbx-agent-backdrop";

  const panel = document.createElement("div");
  panel.className = "fbx-agent-panel";

  const chromeBar = document.createElement("div");
  chromeBar.className = "fbx-agent-chrome";

  const copy = document.createElement("div");
  const title = document.createElement("p");
  title.className = "fbx-agent-title";
  title.textContent = "Facebook AI Agent";
  const hint = document.createElement("p");
  hint.className = "fbx-agent-hint";
  hint.textContent = "Results update here while this Facebook page keeps scrolling underneath.";
  copy.append(title, hint);

  const actions = document.createElement("div");
  actions.className = "fbx-agent-actions";

  const minimize = document.createElement("button");
  minimize.type = "button";
  minimize.className = "fbx-agent-btn";
  minimize.dataset.action = "minimize";
  minimize.textContent = "Peek page";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "fbx-agent-btn";
  close.dataset.action = "close";
  close.textContent = "Close";

  actions.append(minimize, close);
  chromeBar.append(copy, actions);

  const frame = document.createElement("iframe");
  frame.className = "fbx-agent-frame";
  frame.title = "Facebook AI Agent";
  frame.allow = "clipboard-read; clipboard-write";
  const api = runtime();
  frame.src = api ? `${api.getURL("search/search.html")}?embed=1` : "about:blank";

  panel.append(chromeBar, frame);
  root.append(backdrop, panel);
  document.documentElement.appendChild(root);

  minimize.addEventListener("click", () => {
    const minimized = root.dataset.minimized === "true";
    root.dataset.minimized = minimized ? "false" : "true";
    minimize.textContent = minimized ? "Peek page" : "Show agent";
  });
  close.addEventListener("click", () => {
    hideAgentShell();
  });
  backdrop.addEventListener("click", () => {
    root.dataset.minimized = "true";
    minimize.textContent = "Show agent";
  });

  return root;
}

export function showAgentShell(): void {
  const root = ensureAgentShell();
  root.hidden = false;
  root.dataset.minimized = "false";
  const minimize = root.querySelector<HTMLButtonElement>('[data-action="minimize"]');
  if (minimize) {
    minimize.textContent = "Peek page";
  }
}

export function hideAgentShell(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) {
    return;
  }
  root.hidden = true;
}

export function agentShellVisible(): boolean {
  const root = document.getElementById(ROOT_ID);
  return Boolean(root && !root.hidden);
}
