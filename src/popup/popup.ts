const openSearch = document.getElementById("open-search");

openSearch?.addEventListener("click", () => {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  const tabs = (globalThis as { chrome?: typeof chrome }).chrome?.tabs;
  if (!runtime || !tabs) {
    return;
  }
  const url = runtime.getURL("search/search.html");
  void tabs.create({ url, active: true });
});
