// Re-scan on SPA step changes: a debounced MutationObserver. Pure DOM, no chrome.* calls.
(() => {
  const NS = (globalThis.RAF ??= {});

  function watch(doc, onChange, debounceMs = 400) {
    const w = doc.defaultView;
    let timer = null;
    const mo = new w.MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(doc), debounceMs);
    });
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true });
    return () => { clearTimeout(timer); mo.disconnect(); };
  }

  NS.scan = { watch };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();
