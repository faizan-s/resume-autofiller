// Content wiring: scan -> match -> review panel -> fill. Pure DOM: this realm has no chrome.*
// access, so the isolated-world bridge relays state in and remaps out via postMessage.
(() => {
  const NS = (globalThis.RAF ??= {});
  const CH = 'raf-bridge';
  const toBridge = (type, payload) => window.postMessage({ [CH]: type, from: 'raf-main', ...payload }, location.origin);

  function refresh(doc, persist) {
    const st = NS.state;
    if (!st) return;
    const fields = NS.detect.scan(doc);
    const proposals = NS.match.build(fields, st.profile, st.learned, st.host, {
      file: st.file, eeoOptIn: st.eeoOptIn,
    });
    NS.panel.render(doc, proposals, {
      keys: NS.schema.fields,
      // A remap is remembered for this hostname, keyed by the field fingerprint.
      onKey: (proposal, key) => {
        proposal.key = key;
        proposal.status = key ? 'ready' : 'skip';
        if (key) toBridge('learn', { host: st.host, fp: proposal.field.fp, key });
      },
      onValue: (proposal, value) => { proposal.value = value; },
      // fillField returns a status, or a Promise of one for comboboxes.
      onFill: (proposal) => Promise.resolve(NS.fill.fillField(proposal.field, proposal.value, {
        file: st.file, eeoOptIn: st.eeoOptIn,
      })),
    });
    if (persist) NS.scan.watch(doc, (d) => refresh(d, false));
  }

  function open(doc) {
    try { refresh(doc, true); }
    catch (e) {   // a page-realm crash must show on screen, not silently kill the panel
      const p = NS.panel.render(doc, [], { keys: [], onKey: () => {}, onValue: () => {}, onFill: () => {} });
      p.querySelector('.note').textContent = 'Panel failed: ' + (e && e.message);
    }
  }
  function close(doc) { NS.panel.unmount(doc); }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.from !== 'raf-bridge' || !d[CH]) return;
    if (d[CH] === 'state') NS.state = JSON.parse(d.state);
    else if (d[CH] === 'open') open(document);
    else if (d[CH] === 'close') close(document);
  });


  NS.content = { open, close, refresh };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();
