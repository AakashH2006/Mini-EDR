// Decoupled refresh signal: whichever page is mounted owns its own
// fetch logic, so rather than threading a shared "refresh" callback
// through context, hooks just listen for this event and re-run their
// own load(). Ctrl+R (global, in Layout) and each page's "Refresh"
// quick action both dispatch it — same effect, one mechanism.
const REFRESH_EVENT = "mini-edr:refresh";

export function triggerRefresh() {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function onRefresh(cb: () => void): () => void {
  window.addEventListener(REFRESH_EVENT, cb);
  return () => window.removeEventListener(REFRESH_EVENT, cb);
}
