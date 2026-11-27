// Detect form fields, including open shadow roots. Pure DOM, no chrome.* calls, so test/run.js can
// run it under jsdom. Injected into the page's MAIN world (see background.js) — that is what makes
// DataTransfer-based file attach possible (cross-realm input.files assignment throws).
(() => {
  const NS = (globalThis.RAF ??= {});
  if (NS.detect) return;

  const MAX_LABEL = 90;
  const MAX_NEAR = 160;
  const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'password'];
  const TEXT_TYPES = ['text', 'email', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'search', ''];

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const strip = (s) => s.replace(/\s*[:*]\s*$/, '').trim();
  const humanize = (s) => strip(clean(s.replace(/[_-]+/g, ' ').replace(/\d+/g, ' ')));
  const view = (el) => el.ownerDocument.defaultView;
  const textOf = (el) => clean(el.textContent);

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function visible(el) {
    // shortcut: jsdom has no layout, so getClientRects() is always empty and computed style is the
    // only usable signal. Chrome reaches the same verdict from display/visibility alone.
    const w = view(el);
    if (!w || typeof w.getComputedStyle !== 'function') return true;
    let n = el;
    for (let i = 0; n && i < 8; i++, n = n.parentElement) {
      const s = w.getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    }
    return true;
  }

  function labelOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const parts = by.split(/\s+/)
        .map((id) => { const n = el.ownerDocument.getElementById(id); return n ? textOf(n) : ''; })
        .filter(Boolean);
      if (parts.length) return strip(parts.join(' '));
    }
    const al = el.getAttribute('aria-label');
    if (al) return strip(al);
    const own = Array.from(el.labels || []).map((l) => strip(textOf(l))).filter((t) => t && t.length <= MAX_LABEL);
    if (own.length) return own.sort((a, b) => a.length - b.length)[0];
    const wrap = el.closest('label');
    if (wrap) {
      const t = strip(textOf(wrap));
      if (t && t.length <= MAX_LABEL) return t;   // wrapping label, which .labels misses in some engines
    }
    const title = el.getAttribute('title');
    if (title) return strip(title);
    const prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') {
      const t = strip(textOf(prev));
      if (t && t.length <= MAX_LABEL) return t;   // colon labels: <label>First Name:</label><input>
    }
    return '';
  }

  function legendOf(el) {
    const fs = el.closest('fieldset');
    const lg = fs && fs.querySelector('legend');
    return lg ? strip(textOf(lg)) : '';
  }

  function nearOf(el) {
    const prev = el.previousElementSibling;
    if (prev && /^(P|LABEL|H\d|B|SPAN|DIV)$/.test(prev.tagName)) {
      const t = strip(textOf(prev));
      if (t && t.length <= MAX_NEAR) return t;
    }
    let n = el.parentElement;
    for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
      const t = textOf(n);
      if (!t) continue;
      return t.length <= MAX_NEAR ? t : '';
    }
    return '';
  }

  function contextOf(el) {
    let n = el.parentElement;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      const h = n.querySelector('h1, h2, h3, h4, h5, h6, legend, caption, th');
      if (!h) continue;
      const t = strip(textOf(h));
      if (t && t.length <= 80) return t;
    }
    return '';
  }

  function listboxFor(el) {
    const ctl = el.getAttribute('aria-controls');
    const doc = el.ownerDocument;
    const direct = ctl ? doc.getElementById(ctl) : null;
    if (direct && (direct.getAttribute('role') === 'listbox' || direct.querySelector('[role=option]'))) return direct;
    const wrap = el.closest('[role=combobox]') || el.parentElement;
    return (wrap && wrap.querySelector('[role=listbox], [role=menu], [role=list]')) || null;
  }

  function isCombobox(el) {
    if (el.getAttribute('role') === 'combobox') return true;
    const wrap = el.closest('[role=combobox]');
    return !!wrap && wrap.hasAttribute('aria-expanded');
  }

  function isDropzone(el) {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return false;
    const lb = el.getAttribute('aria-labelledby');
    const hint = norm([el.id, el.className, el.getAttribute('aria-label') || '',
      lb ? textOf(el.ownerDocument.getElementById(lb)) : ''].join(' '));
    return /(drop.?zone|dropzone|upload)/.test(hint) && /(resume|cv|curriculum|file|attach|drag)/.test(hint);
  }

  function kindOf(el) {
    // A widget container that wraps the real control is not a field; the control inside is.
    if (el.querySelector('input,select,textarea,[contenteditable=true]')) return '';
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'file') return 'file';
      if (t === 'radio') return 'radio';
      if (t === 'checkbox') return 'checkbox';
      if (SKIP_TYPES.includes(t)) return '';
      if (isCombobox(el)) return 'combobox';
      return TEXT_TYPES.includes(t) ? 'text' : '';
    }
    if (el.tagName === 'SELECT') return el.multiple ? 'combobox' : 'select';
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return 'contenteditable';
    if (el.getAttribute('role') === 'combobox') return 'combobox';
    if (isDropzone(el)) return 'dropzone';
    return '';
  }

  function optionsOf(el, kind) {
    if (el.tagName === 'SELECT') return Array.from(el.options).map((o) => ({ text: clean(o.textContent), value: o.value }));
    const box = listboxFor(el);
    if (box) {
      return Array.from(box.querySelectorAll('[role=option], [role=menuitem], li'))
        .map((o) => ({ text: clean(o.textContent), value: o.getAttribute('data-value') || clean(o.textContent) }));
    }
    if (kind === 'radio') {
      const sel = `input[type=radio][name="${el.name.replace(/["\\]/g, '\\$&')}"]`;
      return Array.from(el.ownerDocument.querySelectorAll(sel))
        .map((r) => ({ text: clean((r.labels[0] && r.labels[0].textContent) || r.value), value: r.value }));
    }
    return [];
  }

  function current(el, kind) {
    if (kind === 'radio') return el.checked ? el.value : '';
    if (kind === 'checkbox') return el.checked ? 'yes' : '';
    if (kind === 'file') return el.files && el.files.length ? el.files[0].name : '';
    if (kind === 'contenteditable') return clean(el.textContent);
    if (kind === 'select') return el.selectedIndex > 0 ? el.options[el.selectedIndex].value : '';
    return el.value || '';
  }

  function describe(el, kind) {
    const label = (kind === 'radio' ? legendOf(el) : '') || labelOf(el);
    const id = el.id || '';
    const name = el.getAttribute('name') || '';
    return {
      el, kind, type: (el.type || 'text').toLowerCase(), id, name,
      ac: el.getAttribute('autocomplete') || '',
      label: label || humanize(name || id),
      legend: legendOf(el),
      near: nearOf(el),
      context: contextOf(el),
      placeholder: el.getAttribute('placeholder') || '',
      options: optionsOf(el, kind),
      required: !!(el.required || el.getAttribute('aria-required') === 'true'),
      value: current(el, kind),
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
      fp: hash([kind, norm(name), norm(id), norm(label)].join('|')),
    };
  }

  function collect(root, out) {
    for (const el of root.querySelectorAll('input, select, textarea, [contenteditable], [role=combobox], div, section')) out.push(el);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) collect(el.shadowRoot, out);
  }

  function scan(root) {
    const start = root.nodeType ? root : root.ownerDocument.documentElement;
    const nodes = [];
    collect(start, nodes);
    const groups = new Map();
    const out = [];
    for (const el of nodes) {
      const kind = kindOf(el);
      if (!kind) continue;
      if (kind !== 'file' && kind !== 'dropzone' && !visible(el)) continue;
      if (kind === 'radio') {
        // One row per radio group (name within the nearest fieldset/form), not one per option.
        const g = el.closest('fieldset') || el.form || start;
        const gk = `${g} | ${el.name}`;
        if (!groups.has(gk)) { const d = describe(el, 'radio'); d.radios = []; groups.set(gk, d); out.push(d); }
        groups.get(gk).radios.push(el);
        continue;
      }
      out.push(describe(el, kind));
    }
    return out;
  }

  NS.detect = { scan, visible, hash, labelOf, describe, norm, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();

