// Fill appliers. Pure DOM, no chrome.* calls. Runs in the page's MAIN world so that DataTransfer,
// input.files and React's value tracker all live in the page's own realm.
(() => {
  const NS = (globalThis.RAF ??= {});

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const view = (el) => el.ownerDocument.defaultView;

  function fire(el, type) {
    el.dispatchEvent(new (view(el)).Event(type, { bubbles: true, cancelable: true }));
  }

  // React redefines `value` on the instance and keeps its tracker in sync, so `el.value = v` leaves
  // React convinced nothing changed and onChange never fires. Writing through the prototype
  // descriptor bypasses that override; the input event we dispatch then lands as a real change.
  function nativeSet(el, value) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;   // non-HTML realm fallback
  }

  function nativeSetChecked(el, checked) {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'checked');
    if (desc && desc.set) desc.set.call(el, checked);
    else el.checked = checked;
  }

  function nativeToggle(el) {
    nativeSetChecked(el, !el.checked);
    el.dispatchEvent(new (view(el)).MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function applyText(el, value) {
    const v = String(value);
    nativeSet(el, v);
    fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
    return clean(el.value) === clean(v) ? 'filled' : 'needs-manual';
  }

  function applySelect(el, value) {
    const want = norm(value);
    const opts = Array.from(el.options);
    const pick = opts.find((o) => norm(o.value) === want)
      || opts.find((o) => norm(o.textContent) === want)
      || opts.find((o) => norm(o.textContent).startsWith(want) && want.length > 2)
      || opts.find((o) => want.includes(norm(o.textContent)) && norm(o.textContent).length > 2);
    if (!pick) return 'needs-manual';   // the site's list has no matching option
    nativeSet(el, pick.value);
    fire(el, 'input'); fire(el, 'change'); fire(el, 'blur');
    return el.value === pick.value ? 'filled' : 'needs-manual';
  }

  function applyRadio(field, value) {
    const want = norm(value);
    const radios = field.radios && field.radios.length ? field.radios : [field.el];
    for (const r of radios) {
      const label = clean((r.labels[0] && r.labels[0].textContent) || '');
      if (norm(r.value) === want || norm(label) === want) {
        for (const other of radios) if (other.checked && other !== r) nativeToggle(other);
        if (!r.checked) nativeToggle(r);
        fire(r, 'change');
        return r.checked ? 'filled' : 'needs-manual';
      }
    }
    return 'needs-manual';
  }

  function applyCheckbox(el, value) {
    const want = ['yes', 'true', '1', 'checked', 'on', 'y'].includes(norm(value));
    if (el.checked !== want) {
      // A dispatched click runs activation behavior, which toggles. Pre-set the opposite so the
      // toggle lands on the target, and React's tracker sees the flip as a real change.
      nativeSetChecked(el, !want);
      el.dispatchEvent(new (view(el)).MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    fire(el, 'change'); fire(el, 'blur');
    return el.checked === want ? 'filled' : 'needs-manual';
  }

  function bytesOf(file, w) {
    if (file.bytes) return file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const b64 = (file.dataUrl || '').split(',')[1] || '';   // options.js stores base64; a JSON trip loses typed arrays
    const s = w.atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  function makeFile(w, file) {
    return new w.File([bytesOf(file, w)], file.name, { type: file.mime || 'application/octet-stream' });
  }

  function applyFile(el, file) {
    const w = view(el);
    if (typeof w.DataTransfer !== 'function' || typeof w.File !== 'function') return 'needs-manual';
    const dt = new w.DataTransfer();
    dt.items.add(makeFile(w, file));
    try { el.files = dt.files; } catch (e) { return 'needs-manual'; }   // cross-realm throws; MAIN world avoids it
    fire(el, 'change');
    return el.files.length > 0 ? 'filled' : 'needs-manual';
  }

  function applyDropzone(el, file) {
    const w = view(el);
    if (typeof w.DataTransfer !== 'function' || typeof w.File !== 'function') return 'needs-manual';
    const dt = new w.DataTransfer();
    dt.items.add(makeFile(w, file));
    for (const t of ['dragenter', 'dragover', 'drop']) {
      const ev = new w.Event(t, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      el.dispatchEvent(ev);
    }
    return 'needs-verify';   // drop-zone uploaders give nothing to read back; the reviewer confirms in the page
  }

  function optionTarget(el, value) {
    const d = el.ownerDocument;
    const want = norm(value);
    const boxes = [];
    const ctl = el.getAttribute('aria-controls');
    if (ctl) { const b = d.getElementById(ctl); if (b) boxes.push(b); }
    const wrap = el.closest('[role=combobox]') || el.parentElement;
    if (wrap) { const b = wrap.querySelector('[role=listbox], [role=menu], [role=list]'); if (b) boxes.push(b); }
    boxes.push(d.body);
    for (const b of boxes) {
      for (const o of b.querySelectorAll('[role=option], [role=menuitem]')) {
        const t = norm(o.textContent);
        if (!t) continue;
        if (t === want || (want.length > 2 && want.includes(t)) || (t.length > 2 && t.includes(want))) return o;
      }
    }
    return null;
  }
  const t2 = (o) => o.textContent;

  const landed = (el, value) => clean('value' in el ? el.value : el.textContent) === clean(String(value));

  // focus -> type -> click the option the widget renders, if it renders one. When no matching option
  // appears, the typed text itself is the evidence: 'filled' only if it landed in the widget.
  function applyCombobox(el, value, timeoutMs = 1200) {
    if (el.focus) el.focus();
    if ('value' in el) nativeSet(el, String(value));
    else el.textContent = String(value);
    fire(el, 'input');
    const w = view(el);
    const hit = optionTarget(el, value);
    if (hit) return Promise.resolve(clickOption(el, hit));
    return new Promise((resolve) => {
      const mo = new w.MutationObserver(() => {
        const o = optionTarget(el, value);
        if (o) { clearTimeout(timer); mo.disconnect(); resolve(clickOption(el, o)); }
      });
      const timer = setTimeout(() => {
        mo.disconnect();
        resolve(landed(el, value) ? 'filled' : 'needs-manual');
      }, timeoutMs);
      mo.observe(w.document.body, { childList: true, subtree: true, attributes: true });
    });
  }

  function clickOption(el, opt) {
    opt.dispatchEvent(new (view(el)).MouseEvent('click', { bubbles: true, cancelable: true }));
    fire(el, 'change');
    return 'filled';
  }

  function applyContentEditable(el, value) {
    const d = el.ownerDocument;
    const v = String(value);
    if (el.focus) el.focus();
    if (typeof d.execCommand === 'function' && (d.queryCommandSupported ? d.queryCommandSupported('insertText') : true)) {
      d.execCommand('insertText', false, v);   // keeps the rich-text editor's own bookkeeping
    }
    if (clean(el.textContent) !== clean(v)) el.textContent = v;   // no execCommand (jsdom, some editors)
    fire(el, 'input'); fire(el, 'blur');
    return clean(el.textContent) === clean(v) ? 'filled' : 'needs-manual';
  }

  // blocked lives in the schema, not in the field descriptor: ask the matcher what this field maps to.
  function isBlocked(field) {
    const p = (NS.match && NS.schema) ? NS.match.build([field], {}, {}, '')[0] : null;
    return !!(field.blocked || (p && p.blocked));
  }

  // Returns a status string, or a Promise of one for comboboxes.
  function fillField(field, value, ctx = {}) {
    if (isBlocked(field) && !ctx.eeoOptIn) return 'blocked';
    if (field.kind === 'file' || field.kind === 'dropzone') {
      if (!ctx.file) return 'needs-manual';   // no resume loaded, nothing to attach
      return field.kind === 'file' ? applyFile(field.el, ctx.file) : applyDropzone(field.el, ctx.file);
    }
    if (value === '' || value == null) return 'skip';
    switch (field.kind) {
      case 'text': case 'textarea': return applyText(field.el, value);
      case 'select': return applySelect(field.el, value);
      case 'radio': return applyRadio(field, value);
      case 'checkbox': return applyCheckbox(field.el, value);
      case 'combobox': return applyCombobox(field.el, value);
      case 'contenteditable': return applyContentEditable(field.el, value);
      default: return 'needs-manual';
    }
  }

  NS.fill = { fillField, applyText, applySelect, applyRadio, applyCheckbox, applyFile, applyDropzone,
    applyCombobox, applyContentEditable, nativeSet, nativeToggle, bytesOf, fire };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();

