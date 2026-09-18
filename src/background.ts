chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ enabled: true });
});

const MATCH = /https:\/\/(www\.|web\.)?facebook\.com\/marketplace\//i;

function inject(tabId: number): void {
  void chrome.scripting.insertCSS({
    target: { tabId },
    files: ["content/overlay.css"]
  }).catch(() => undefined);
  void chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/main.js"],
    world: "MAIN"
  }).catch(() => undefined);
  void chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/isolated.js"]
  }).catch(() => undefined);
}

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0 && MATCH.test(details.url)) {
    inject(details.tabId);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0 && MATCH.test(details.url)) {
    inject(details.tabId);
  }
});
