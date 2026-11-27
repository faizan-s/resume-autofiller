// Isolated world: the only content file with chrome.* access. The MAIN-world modules have none, so
// state comes in and remaps go out through postMessage. Payloads cross as JSON text — an object
// created in one realm cannot be read in the other, so the string is the only thing that survives.
(() => {
  if (globalThis.__rafBridge) return;   // re-injection must not stack listeners
  globalThis.__rafBridge = true;
  const CH = 'raf-bridge';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'RA:STATE') {
      window.postMessage({ [CH]: 'state', from: 'raf-bridge', state: JSON.stringify(msg.state) }, location.origin);
      sendResponse({ ok: true });
    } else if (msg.type === 'RA:OPEN' || msg.type === 'RA:CLOSE') {
      window.postMessage({ [CH]: msg.type === 'RA:OPEN' ? 'open' : 'close', from: 'raf-bridge' }, location.origin);
      sendResponse({ ok: true });
    }
    return true;
  });

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.from !== 'raf-main' || d[CH] !== 'learn') return;
    chrome.runtime.sendMessage({ type: 'RA:LEARN', host: d.host, fp: d.fp, key: d.key });
  });
})();