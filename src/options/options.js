// Options: import + parse, editable profile, learned-mapping table, wipe.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const EXT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', rtf: 'application/rtf',
};

let pendingFile = null;

function renderEditor(profile) {
  const html = [];
  for (const g of RAF.schema.groups) {
    html.push(`<h3>${g}</h3>`);
    for (const f of RAF.schema.fields) {
      if (f.group !== g || f.derived || f.kind === 'file') continue;
      const v = profile[f.key] == null ? '' : String(profile[f.key]);
      html.push(`<label class="fld"><span>${esc(f.label)}${f.blocked ? ' (EEO, opt-in only)' : ''}</span>`
        + `<input data-key="${f.key}" value="${esc(v)}" /></label>`);
    }
  }
  $('#editor').innerHTML = html.join('');
}

function readEditor() {
  const out = {};
  for (const i of document.querySelectorAll('#editor input[data-key]')) {
    const v = i.value.trim();
    if (v) out[i.dataset.key] = v;
  }
  return out;
}

function toDataUrl(bytes, mime) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}

async function textOf(file, bytes) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return RAF.parse.pdfToText(bytes);
  if (ext === 'docx') return RAF.parse.docxToText(bytes);
  return new TextDecoder().decode(bytes);
}

async function renderLearned(learned) {
  const rows = [];
  for (const host of Object.keys(learned)) {
    for (const fp of Object.keys(learned[host])) {
      rows.push(`<tr><td>${esc(host)}</td><td><code>${fp}</code></td><td>${esc(learned[host][fp])}</td>`
        + `<td><button data-host="${esc(host)}" data-fp="${fp}">remove</button></td></tr>`);
    }
  }
  $('#learned tbody').innerHTML = rows.join('') || '<tr><td colspan="4" class="note">Nothing learned yet.</td></tr>';
}

$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#msg').textContent = `Reading ${file.name}…`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  let text = '';
  try { text = await textOf(file, bytes); } catch (err) { $('#msg').textContent = `Could not read ${file.name}: ${err.message}`; return; }
  const profile = RAF.parse.resume(text);
  renderEditor(profile);
  pendingFile = { name: file.name, mime: EXT_MIME[ext] || file.type || 'application/octet-stream', dataUrl: toDataUrl(bytes, EXT_MIME[ext] || file.type) };
  $('#msg').textContent = `Parsed ${Object.keys(profile).length} fields. Check every field, then Save.`;
});

$('#save').addEventListener('click', async () => {
  const set = { profile: readEditor() };
  if (pendingFile) set.resumeFile = pendingFile;
  await chrome.storage.local.set(set);
  $('#msg').textContent = `Saved ${Object.keys(set.profile).length} fields${pendingFile ? ' + resume file' : ''}.`;
  pendingFile = null;
});

$('#learned').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const s = await chrome.storage.local.get(['learned']);
  const learned = s.learned || {};
  delete learned[e.target.dataset.host][e.target.dataset.fp];
  if (!Object.keys(learned[e.target.dataset.host]).length) delete learned[e.target.dataset.host];
  await chrome.storage.local.set({ learned });
  renderLearned(learned);
});

$('#wipe').addEventListener('click', async () => {
  if (!confirm('Delete your profile, stored resume file, and all learned mappings?')) return;
  await chrome.storage.local.clear();
  renderEditor({});
  renderLearned({});
  $('#msg').textContent = 'All local data deleted.';
});

chrome.storage.local.get(['profile', 'resumeFile', 'learned']).then((s) => {
  renderEditor(s.profile || {});
  renderLearned(s.learned || {});
  if (s.resumeFile) $('#msg').textContent = `Stored resume: ${s.resumeFile.name}`;
});
