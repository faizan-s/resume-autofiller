// Review panel: a Shadow-DOM overlay. Nothing fills until Fill is pressed, the form is never
// submitted, and EEO/demographic rows report "blocked" unless the user opted in.
(() => {
  const NS = (globalThis.RAF ??= {});

  const CSS = `
    :host { all: initial; }
    .panel { position: fixed; top: 16px; right: 16px; width: 400px; max-height: 88vh; overflow: auto;
      background: #fff; color: #222; font: 13px/1.45 system-ui, sans-serif; border: 1px solid #bbb;
      border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); z-index: 2147483647; }
    .hd { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid #ddd; background: #f7f7f7; }
    .hd b { flex: 1; }
    .note { padding: 8px 12px; color: #555; font-size: 12px; }
    .grp { padding: 8px 12px 2px; font-weight: 700; background: #fafafa; border-bottom: 1px solid #eee; }
    .row { display: grid; grid-template-columns: 1fr 120px 150px 80px; gap: 6px; padding: 6px 12px;
      border-bottom: 1px solid #eee; align-items: center; }
    .row .lab { color: #444; }
    .badge { font-size: 11px; color: #777; }
    .val, .map { border: 1px solid #ccc; border-radius: 4px; padding: 3px; width: 100%; font: 12px system-ui; }
    .row[data-status=filled] { background: #eaffea; }
    .row[data-status=needs-verify] { background: #eaf6ff; }
    .row[data-status=needs-manual] { background: #fff6d6; }
    .row[data-status=blocked] { background: #ffe9d6; }
    .row[data-status=skip], .row[data-status=unmatched] { opacity: .55; }
    .ft { display: flex; gap: 10px; align-items: center; padding: 10px 12px; background: #f7f7f7; }
    .ft button { padding: 6px 10px; border: 1px solid #999; background: #eee; border-radius: 6px; cursor: pointer; }
    .ft .go { background: #2e7d32; color: #fff; border-color: #2e7d32; }
    .ft .left { flex: 1; }
  `;

  const HOST = 'raf-panel-host';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function mount(doc) {
    let host = doc.getElementById(HOST);
    if (!host) {
      host = doc.createElement('div');
      host.id = HOST;
      (doc.body || doc.documentElement).appendChild(host);
    }
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (!root.querySelector('style')) {
      const st = root.ownerDocument.createElement('style');
      st.textContent = CSS;
      root.appendChild(st);
    }
    let panel = root.querySelector('.panel');
    if (!panel) {
      panel = root.ownerDocument.createElement('div');
      panel.className = 'panel';
      root.appendChild(panel);
    }
    return panel;
  }

  function unmount(doc) {
    const host = doc.getElementById(HOST);
    if (host) host.remove();
  }

  function summary(rows) {
    const c = {};
    for (const p of rows) c[p.status] = (c[p.status] || 0) + 1;
    return Object.keys(c).map((k) => `${c[k]} ${k}`).join(', ');
  }

  function render(doc, proposals, handlers) {
    const panel = mount(doc);
    const keyList = (handlers.keys || NS.schema.fields).filter((k) => k.kind !== 'file');

    const byGroup = new Map();
    for (const p of proposals) {
      if (!byGroup.has(p.group)) byGroup.set(p.group, []);
      byGroup.get(p.group).push(p);
    }

    const html = [
      '<div class="hd"><b>Review before filling</b><span class="badge">' + proposals.length
        + ' fields</span><button class="x">Close</button></div>',
      '<div class="note">Nothing fills until you press Fill. Your application is never submitted. '
        + 'EEO / demographic fields are skipped unless you opted in.</div>',
    ];
    for (const [group, rows] of byGroup) {
      html.push('<div class="grp">' + esc(group) + '</div>');
      for (const p of rows) {
        const opts = ['<option value="">— skip —</option>'].concat(keyList.map(
          (k) => `<option value="${k.key}"${k.key === p.key ? ' selected' : ''}>${esc(k.label)}</option>`));
        html.push(
          `<div class="row" data-fp="${p.field.fp}" data-status="${p.status}">`
          + '<div class="lab">' + esc(p.field.label) + (p.field.required ? ' *' : '')
          + '<div class="badge">' + p.confidence + ' · ' + p.field.kind + '</div></div>'
          + '<input class="val" data-k="value" value="' + esc(p.value) + '" placeholder="(empty)" />'
          + '<select class="map" data-k="key">' + opts.join('') + '</select>'
          + '<span class="badge st">' + p.status + '</span></div>');
      }
    }
    html.push('<div class="ft"><button class="go">Fill</button><span class="badge left">' + summary(proposals) + '</span></div>');
    panel.innerHTML = html.join('');

    const find = (fp) => proposals.find((p) => p.field.fp === fp);
    const setStatus = (p) => {
      const row = panel.querySelector(`.row[data-fp="${p.field.fp}"]`);
      if (row) { row.dataset.status = p.status; row.querySelector('.st').textContent = p.status; }
    };

    panel.addEventListener('change', (e) => {
      const row = e.target.closest('.row');
      const p = row && find(row.dataset.fp);
      if (!p) return;
      if (e.target.dataset.k === 'key') {
        p.key = e.target.value;
        p.status = e.target.value ? 'ready' : 'skip';
        if (handlers.value) p.value = handlers.value(p);
        panel.querySelector(`.row[data-fp="${p.field.fp}"] .val`).value = p.value;
        row.dataset.status = p.status;
        row.querySelector('.st').textContent = p.status;
        handlers.onKey(p, e.target.value);
      } else if (e.target.dataset.k === 'value') {
        p.value = e.target.value;
        handlers.onValue(p, e.target.value);
      }
    });

    panel.addEventListener('click', async (e) => {
      const btn = e.target;   // jsdom nulls e.target once dispatch ends; an await below would see null
      if (btn.classList.contains('x')) { unmount(doc); return; }
      if (!btn.classList.contains('go')) return;
      btn.disabled = true;
      for (const p of proposals.filter((x) => x.status === 'ready')) {
        p.status = await handlers.onFill(p);   // fillField returns a Promise for comboboxes
        setStatus(p);
      }
      panel.querySelector('.left').textContent = summary(proposals);
      btn.disabled = false;
    });

    return panel;
  }

  NS.panel = { render, unmount, mount, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();

