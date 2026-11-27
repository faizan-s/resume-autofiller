// No test framework. detect/match/fill/parse are pure functions, so jsdom drives them.
// DataTransfer-based file attach is impossible in jsdom (no DataTransfer) — that path is proven by
// test/spike-browser.html in real Chrome with the extension loaded.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = (p) => path.join(__dirname, '..', 'src', p);
const FIX = (n) => path.join(__dirname, 'fixtures', n);

let pass = 0, fail = 0;
const eq = (a, b, msg) => a === b
  ? (pass++, console.log(`  PASS ${msg}`))
  : (fail++, console.log(`  FAIL ${msg}\n    got:  ${JSON.stringify(a)}\n    want: ${JSON.stringify(b)}`));
const ok = (c, msg) => c ? (pass++, console.log(`  PASS ${msg}`)) : (fail++, console.log(`  FAIL ${msg}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fixture(name, host) {
  const html = fs.readFileSync(FIX(name), 'utf8');
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: host || 'https://greenhouse.example.com/job/42' });
}

require(SRC('shared/schema.js'));
require(SRC('shared/parse.js'));
require(SRC('content/detect.js'));
require(SRC('content/match.js'));
require(SRC('content/fill.js'));
require(SRC('content/scan.js'));
require(SRC('content/panel.js'));
const RAF = globalThis.RAF;

async function main() {
  console.log('\n=== Resume Autofiller test suite ===\n');

  console.log('--- manifest ---');
  const mf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  eq(mf.manifest_version, 3, 'manifest is MV3');
  for (const r of [mf.background.service_worker, mf.action.default_popup, mf.options_ui.page])
    ok(fs.existsSync(path.join(__dirname, '..', r)), `manifest path exists: ${r}`);
  const bg = fs.readFileSync(SRC('background.js'), 'utf8');
  const files = bg.match(/src\/content\/[^']+/g) || [];
  ok(files.length > 0, 'background declares injectable content files');
  ok(/src\/shared\/schema\.js/.test(bg), 'MAIN-world injection includes shared/schema.js (the page realm needs the field ontology)');
  for (const f of files)
    ok(fs.existsSync(path.join(__dirname, '..', f)), `injected file exists: ${f}`);

  console.log('--- realm split (isolated bridge + pure MAIN-world modules) ---');
  ok(fs.existsSync(path.join(__dirname, 'spike-browser.html')),
    'browser spike page exists (the DataTransfer path is proven there, not in jsdom)');
  ok(/world:\s*'ISOLATED'/.test(bg) && /world:\s*'MAIN'/.test(bg), 'background injects both worlds per frame');
  const stripComments = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const contentDir = path.join(__dirname, '..', 'src', 'content');
  const talkers = fs.readdirSync(contentDir).filter((f) => f.endsWith('.js'))
    .filter((f) => /\bchrome\./.test(stripComments(fs.readFileSync(path.join(contentDir, f), 'utf8'))));
  eq(JSON.stringify(talkers), '["bridge.js"]', 'only bridge.js touches chrome.* in content code');

  console.log('--- bridge relay (state crosses realms as JSON text) ---');
  const w3 = new JSDOM('<p>x', { url: 'https://a.example.com/' }).window;
  const relayed = [], posted = [];
  globalThis.window = w3;
  globalThis.location = w3.location;
  globalThis.chrome = { runtime: { onMessage: { addListener: (l) => relayed.push(l) }, sendMessage: (m) => posted.push(m) } };
  w3.postMessage = (m, o) => posted.push([m, o]);   // spy: jsdom postMessage never delivers, so record what is sent
  const bridgeSrc = fs.readFileSync(SRC('content/bridge.js'), 'utf8');
  eval(bridgeSrc); eval(bridgeSrc);   // simulate re-injection
  eq(relayed.length, 1, 're-injection does not stack the bridge listener');
  relayed[0]({ type: 'RA:STATE', state: { profile: { firstName: 'Faizan' } } }, {}, () => {});
  eq(posted[0][0]['raf-bridge'], 'state', 'state is relayed into the page realm');
  eq(JSON.parse(posted[0][0].state).profile.firstName, 'Faizan', 'state crosses as JSON text, not a live object');
  w3.dispatchEvent(new w3.MessageEvent('message', {
    data: { 'raf-bridge': 'learn', from: 'raf-main', host: 'greenhouse.example.com', fp: 'abc', key: 'city' },
  }));
  eq(JSON.stringify(posted[posted.length - 1]),
    JSON.stringify({ type: 'RA:LEARN', host: 'greenhouse.example.com', fp: 'abc', key: 'city' }),
    'a learned remap travels out through the bridge');
  delete globalThis.chrome; delete globalThis.window; delete globalThis.location;

  console.log('--- parser (single-column txt) ---');
  const p1 = RAF.parse.resume(fs.readFileSync(FIX('resume.txt'), 'utf8'));
  eq(p1.firstName, 'Faizan', 'first name');
  eq(p1.middleName, 'A.', 'middle name');
  eq(p1.lastName, 'Khan', 'last name');
  eq(p1.fullName, 'Faizan A. Khan', 'full name');
  eq(p1.email, 'faizan.khan@example.com', 'email');
  ok(/\(?415\)?/.test(p1.phone || ''), 'phone');
  eq(p1.city, 'San Francisco', 'city');
  eq(p1.state, 'CA', 'state');
  eq(p1.postalCode, '94105', 'postal code');
  eq(p1.linkedin, 'https://linkedin.com/in/faizankhan', 'linkedin url');
  eq(p1.github, 'https://github.com/faizankhan', 'github url');
  eq(p1.currentTitle, 'Senior Software Engineer', 'current title');
  eq(p1.currentCompany, 'Acme Technologies, Inc.', 'current company');
  eq(p1.highestEducation, "Bachelor's", 'highest education level');
  eq(p1.school, 'University of California, Berkeley', 'school');
  eq(p1.major, 'Computer Science', 'major');
  eq(p1.graduationYear, '2016', 'graduation year');
  eq(p1.totalYearsExperience, '10', 'years of experience (Present clamps to today)');

  console.log('--- parser (markdown) ---');
  const p2 = RAF.parse.resume(fs.readFileSync(FIX('resume_2col.md'), 'utf8'));
  eq(p2.firstName, 'Nadia', 'md first name');
  eq(p2.lastName, 'Patel', 'md last name');
  eq(p2.currentCompany, 'Contoso Analytics', 'md current company');
  eq(p2.highestEducation, "Master's", 'md education level');
  eq(p2.school, 'Texas State University', 'md school');
  eq(p2.city, 'Austin', 'md city');

  console.log('--- parser (years from experience-section ranges) ---');
  const p3 = RAF.parse.resume(fs.readFileSync(FIX('resume_years.txt'), 'utf8'));
  eq(p3.totalYearsExperience, '7', 'years are the union of job ranges, not the earliest year in the resume');

  console.log('--- spike: React-controlled inputs ---');
  const gh = fixture('greenhouse_mock.html');
  const d = gh.window.document;
  const first = d.getElementById('first_name');
  first.value = 'PlaceholderText';   // React-sim instance setter keeps the tracker fresh -> onChange skipped
  first.dispatchEvent(new gh.window.Event('input', { bubbles: true }));
  eq(gh.window.__reactState.first_name || '', '', 'plain el.value = silently fails on React input');
  eq(RAF.fill.applyText(first, 'Faizan'), 'filled', 'native-setter applier reports filled');
  eq(gh.window.__reactState.first_name, 'Faizan', 'native setter + input event fires React onChange');

  console.log('--- detect (Greenhouse shape) ---');
  const fields = RAF.detect.scan(d);
  const byLabel = (t) => fields.find((f) => (f.label || '').toLowerCase().includes(t));
  eq(byLabel('first name').name, 'first_name', 'label[for] resolved');
  eq(byLabel('phone number').kind, 'text', 'wrapped label + tel input');
  eq(byLabel('phone number').name, 'phone', 'wrapped label resolves name');
  eq(byLabel('work authorization').kind, 'radio', 'radio group captioned by fieldset legend');
  eq(byLabel('work authorization').radios.length, 2, 'radio group collapses to one descriptor');
  eq(byLabel('sponsorship').kind, 'select', 'select detected');
  eq(byLabel('resume').kind, 'file', 'file input detected');
  eq(byLabel('relocate').kind, 'combobox', 'aria combobox detected');
  eq(byLabel('comments').kind, 'textarea', 'textarea detected');
  ok(!fields.some((f) => f.name === 'csrf' || f.name === 'req_id'), 'hidden inputs skipped');
  eq(byLabel('gender').kind, 'select', 'EEO fields are detected (then blocked)');
  eq(fields.filter((f) => f.kind === 'radio').length, 1, 'one row per radio group');

  console.log('--- detect (shadow DOM, drop zone, Workday table, iCIMS, Lever) ---');
  const af = RAF.detect.scan(fixture('ashby_mock.html', 'https://ashbyhq.example.com/j/1').window.document);
  ok(af.some((f) => f.id === 'sh-email'), 'open shadow root pierced (email)');
  ok(af.some((f) => f.id === 'sh-resume' && f.kind === 'file'), 'file input inside shadow root');

  const sf = RAF.detect.scan(fixture('smartrecruiters_mock.html', 'https://smartrecruiters.example.com/x').window.document);
  ok(sf.some((f) => f.kind === 'dropzone'), 'drop-zone uploader found with no input[type=file]');
  ok(sf.some((f) => f.kind === 'contenteditable'), 'contenteditable detected');
  ok(sf.some((f) => f.label.toLowerCase().includes('full name')), 'aria-label resolves');

  const wf = RAF.detect.scan(fixture('workday_mock.html', 'https://workday.example.com/app').window.document);
  ok(wf.some((f) => f.kind === 'combobox' && f.label.toLowerCase().includes('country')), 'table-cell combobox detected');

  const lf = RAF.detect.scan(fixture('lever_mock.html', 'https://lever.example.com/jobs/9').window.document);
  ok(lf.some((f) => f.label.toLowerCase().includes('full name') && f.id === 'f'), 'aria-labelledby resolves');
  ok(lf.some((f) => f.kind === 'radio' && f.legend.toLowerCase().includes('authorized')), 'legend captions the radio group');

  const ic = RAF.detect.scan(fixture('icims_mock.html', 'https://icims.example.com/a/3').window.document);
  ok(ic.some((f) => f.label.toLowerCase().includes('first name')), 'iCIMS colon labels resolve');

  console.log('--- scan.js (SPA step change) ---');
  const sp = fixture('greenhouse_mock.html');
  let fired = false;
  const stop = RAF.scan.watch(sp.window.document, () => { fired = true; }, 10);
  const added = sp.window.document.createElement('input');
  added.name = 'desired_salary';
  sp.window.document.body.appendChild(added);
  await sleep(150);
  ok(fired, 'MutationObserver re-scan fires on DOM change');
  stop();


  console.log('--- matcher (Greenhouse, real profile) ---');
  const proposals = RAF.match.build(fields, p1, {}, 'greenhouse.example.com');
  const keyOf = (t) => { const p = proposals.find((x) => (x.field.label || '').toLowerCase().includes(t)); return p && p.key; };
  eq(keyOf('first name'), 'firstName', 'first name -> firstName');
  eq(keyOf('last name'), 'lastName', 'last name -> lastName');
  eq(keyOf('email address'), 'email', 'email -> email');
  eq(keyOf('phone number'), 'phone', 'phone -> phone');
  eq(keyOf('resume'), 'resumeFile', 'resume upload -> resumeFile');
  eq(keyOf('linkedin'), 'linkedin', 'LinkedIn URL');
  eq(keyOf('work authorization'), 'workAuthorization', 'work authorization (radio group legend)');
  eq(keyOf('sponsorship'), 'requiresSponsorship', 'sponsorship question');
  eq(keyOf('city'), 'city', 'city (autocomplete)');
  eq(keyOf('comments'), 'coverLetter', 'comments -> coverLetter');
  eq(keyOf('current title'), 'currentTitle', 'current title');
  eq(keyOf('current employer'), 'currentCompany', 'current employer');
  eq(keyOf('gender'), 'gender', 'EEO gender matched for display');
  eq(proposals.find((p) => p.key === 'gender').status, 'blocked', 'EEO field is blocked by default');
  eq(proposals.find((p) => p.key === 'gender').value, '', 'profile has no gender to leak');
  eq(proposals.find((p) => p.field.label === 'First Name').value, 'Faizan', 'first name value from profile');
  ok(proposals.filter((p) => p.status === 'ready').length >= 12, 'most fields ready to fill');
  eq(proposals.filter((p) => p.field.name === 'csrf' || p.field.name === 'req_id').length, 0, 'hidden fields never proposed');

  console.log('--- matcher (other ATS shapes) ---');
  const mp = RAF.match.build(lf, p2, {}, 'lever.example.com');
  eq(mp.find((p) => p.field.id === 'f').key, 'fullName', 'Full Name -> fullName');
  eq(mp.find((p) => p.field.id === 'e').key, 'email', 'aria-labelledby email');
  eq(mp.find((p) => p.field.kind === 'radio').key, 'workAuthorization', 'legend-captioned radio group');

  const wp = RAF.match.build(wf, p1, {}, 'workday.example.com');
  eq(wp.find((p) => p.field.id === 'da-first-name').key, 'firstName', 'table-cell first name');
  eq(wp.find((p) => p.field.id === 'da-resume-file').key, 'resumeFile', 'Workday resume drop zone');

  const ip = RAF.match.build(ic, p1, {}, 'icims.example.com');
  eq(ip.find((p) => p.field.id === 'first_name').key, 'firstName', 'iCIMS colon label');
  eq(ip.find((p) => p.field.id === 'first_name').value, 'Faizan', 'iCIMS first name value');

  const ap = RAF.match.build(af, p2, {}, 'ashbyhq.example.com');
  eq(ap.find((p) => p.field.id === 'sh-resume').key, 'resumeFile', 'file input in shadow root -> resumeFile');

  const sfp = RAF.match.build(sf, p1, {}, 'smartrecruiters.example.com');
  eq(sfp.find((p) => p.field.kind === 'dropzone').key, 'resumeFile', 'drop zone -> resumeFile');

  console.log('--- matcher: guards and learned overrides ---');
  const genderRow = RAF.match.build([{ fp: 'x', kind: 'select', label: 'Gender', name: '', id: '',
    options: [{ text: 'Male' }, { text: 'Female' }], context: '', near: '', placeholder: '', ac: '',
    value: '', required: false, el: null }], p1, {}, 'x.example.com');
  eq(genderRow[0].key, 'gender', 'Gender select is not firstName');

  const learned = { 'greenhouse.example.com': {} };
  learned['greenhouse.example.com'][proposals.find((p) => p.key === 'firstName').field.fp] = 'middleName';
  const second = RAF.match.build(fields, p1, learned, 'greenhouse.example.com');
  eq(second.find((p) => p.source === 'learned').key, 'middleName', 'learned override wins over ontology');
  eq(second.find((p) => p.source === 'learned').confidence, 'learned', 'confidence reported as learned');


  console.log('--- fillers (Greenhouse, verified status) ---');
  const ctx = { eeoOptIn: false };
  const fill = (label, value) => RAF.fill.fillField(byLabel(label), value, ctx);

  eq(fill('first name', 'Faizan'), 'filled', 'first name fills and is verified');
  eq(first.value, 'Faizan', 'first name value landed');
  eq(fill('last name', 'Khan'), 'filled', 'last name fills');
  eq(d.getElementById('email').value, '', 'email untouched until we fill it');
  eq(fill('email address', 'faizan.khan@example.com'), 'filled', 'email fills');
  eq(d.getElementById('email').value, 'faizan.khan@example.com', 'email value landed');
  eq(fill('phone number', '(415) 555-0123'), 'filled', 'phone fills');

  eq(fill('sponsorship', 'Yes'), 'filled', 'select: option text match');
  eq(d.getElementById('sponsorship').value, 'yes', 'select value set to the option value');
  eq(fill('sponsorship', 'No'), 'filled', 'select: re-fill to No');
  eq(fill('sponsorship', 'Maybe'), 'needs-manual', 'select: unmatched option reports needs-manual');

  eq(fill('work authorization', 'Yes'), 'filled', 'radio group: legend label + Yes/No label match');
  const auth = byLabel('work authorization').radios;
  eq(auth.filter((r) => r.checked).length, 1, 'radio: exactly one checked');
  eq(d.querySelector('input[name=work_auth][value=yes]').checked, true, 'radio: the Yes option is checked');
  eq(fill('work authorization', 'No'), 'filled', 'radio group switches to No');
  eq(d.querySelector('input[name=work_auth][value=no]').checked, true, 'radio: No checked, Yes unchecked');
  eq(auth.filter((r) => r.checked).length, 1, 'radio: still exactly one checked');

  eq(fill('gender', 'Male'), 'blocked', 'EEO field stays blocked without opt-in');
  eq(d.getElementById('gender').selectedIndex, 0, 'EEO select untouched while blocked');
  eq(RAF.fill.fillField(byLabel('gender'), 'Male', { eeoOptIn: true }), 'filled', 'EEO fills once opted in');
  d.getElementById('gender').selectedIndex = 0;   // reset, so the panel test below proves Fill leaves EEO alone

  eq(fill('comments', 'My cover letter text'), 'filled', 'textarea fills');
  eq(d.getElementById('comments').value, 'My cover letter text', 'textarea value landed');
  eq(fill('first name', ''), 'skip', 'empty value reports skip');

  const comboStatus = await RAF.fill.fillField(byLabel('relocate'), 'Austin', ctx);
  const comboInput = d.querySelector('[name=work_location]');
  eq(comboStatus, 'filled', 'combobox typed value lands');
  eq(comboInput.value || comboInput.textContent, 'Austin', 'combobox shows the typed value (no fake option click)');

  console.log('--- fillers (Workday combobox, shadow DOM, contenteditable, checkbox) ---');
  const wEl = wf.find((f) => f.id === 'da-country');
  eq(await RAF.fill.fillField(wEl, 'San Francisco', ctx), 'filled', 'Workday combobox typed value lands');
  eq(wEl.el.value, 'San Francisco', 'Workday combobox shows typed value');

  eq(RAF.fill.fillField(ic.find((f) => f.id === 'first_name'), 'Faizan', ctx), 'filled', 'iCIMS first name fills');
  eq(RAF.fill.fillField(lf.find((f) => f.id === 'f'), 'Nadia Patel', ctx), 'filled', 'Lever full name fills');
  const shEmail = af.find((f) => f.id === 'sh-email');
  eq(RAF.fill.applyText(shEmail.el, 'nadia@example.com'), 'filled', 'shadow-root input fills');
  eq(shEmail.el.value, 'nadia@example.com', 'shadow-root value landed');
  const ce = sf.find((f) => f.kind === 'contenteditable');
  eq(RAF.fill.fillField(ce, 'Dear hiring manager', ctx), 'filled', 'contenteditable fills');
  eq(ce.el.textContent, 'Dear hiring manager', 'contenteditable text landed');
  const consent = sf.find((f) => f.kind === 'checkbox');
  eq(RAF.fill.fillField(consent, 'yes', ctx), 'filled', 'checkbox opt-in fills');
  eq(consent.el.checked, true, 'checkbox becomes checked');
  eq(RAF.fill.fillField(consent, 'no', ctx), 'filled', 'checkbox un-checks');
  eq(consent.el.checked, false, 'checkbox unchecked again');

  console.log('--- fillers (file attach degrades honestly) ---');
  const fileField = fields.find((f) => f.kind === 'file');
  const stored = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n').toString('base64');
  eq(Buffer.from(RAF.fill.bytesOf({ dataUrl: stored }, gh.window)).toString('utf8'), '%PDF-1.4\n',
    'bytesOf decodes the base64 resume the options page stores');
  eq(RAF.fill.fillField(fileField, '', { file: null }), 'needs-manual', 'no resume loaded -> needs-manual');
  eq(RAF.fill.fillField(fileField, '', { file: { name: 'resume.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) } }),
    'needs-manual', 'jsdom has no DataTransfer -> needs-manual, never a fake filled');


  console.log('--- panel (review-before-fill, Shadow DOM) ---');
  const panel = RAF.panel.render(d, proposals, {
    keys: RAF.schema.fields,
    onKey: () => {}, onValue: () => {},
    onFill: (p) => RAF.fill.fillField(p.field, p.value, ctx),
  });
  const shadow = d.getElementById('raf-panel-host').shadowRoot;
  ok(shadow, 'panel lives in a Shadow DOM (page CSS cannot touch it)');
  ok(panel.querySelector('.note').textContent.includes('Nothing fills until you press Fill'), 'review-first note present');
  const blockedRow = panel.querySelector('.row[data-status=blocked]');
  ok(blockedRow && blockedRow.textContent.includes('Gender'), 'blocked EEO row shown in the panel');
  ok(panel.querySelector(`.row[data-fp="${proposals.find((p) => p.key === 'firstName').field.fp}"] .val`).value === 'Faizan',
    'panel shows the proposed value for first name');
  ok(panel.querySelector('.go'), 'Fill button exists');

  panel.querySelector('.go').dispatchEvent(new (shadow.ownerDocument.defaultView).MouseEvent('click', { bubbles: true }));
  await sleep(120);
  eq(d.getElementById('last_name').value, 'Khan', 'Fill pressed: last name filled');
  eq(d.getElementById('email').value, 'faizan.khan@example.com', 'Fill pressed: email filled');
  const eeoSel = d.getElementById('gender');
  ok(eeoSel.selectedIndex === 0 || eeoSel.value === '', 'Fill never touches the blocked EEO select');

  const mapSelect = panel.querySelector('.row[data-status=blocked] .map');
  mapSelect.value = 'skip';
  mapSelect.dispatchEvent(new (shadow.ownerDocument.defaultView).Event('change', { bubbles: true }));
  eq(panel.querySelector('.row[data-status=skip]').dataset.status, 'skip', 'dropdown can skip a field');

  RAF.panel.unmount(d);
  eq(d.getElementById('raf-panel-host'), null, 'panel unmounts cleanly');

  console.log('--- content wiring (bridge relays state, panel opens in the page realm) ---');
  const gh2 = fixture('greenhouse_mock.html');
  const w2 = gh2.window;
  const MAIN_WORLD = ['shared/schema.js', 'content/detect.js', 'content/match.js', 'content/fill.js',
    'content/panel.js', 'content/scan.js', 'content/main.js'];
  for (const f of MAIN_WORLD)
    w2.eval(fs.readFileSync(SRC(f), 'utf8'));   // the MAIN-world files, in the page realm
  const post = (data) => w2.dispatchEvent(new w2.MessageEvent('message', { data }));
  post({ 'raf-bridge': 'open', from: 'raf-bridge' });
  eq(w2.document.getElementById('raf-panel-host'), null, 'open before state is a no-op (no chrome access in this realm)');
  post({ 'raf-bridge': 'state', from: 'raf-bridge',
    state: JSON.stringify({ profile: p1, file: null, learned: {}, eeoOptIn: false, host: 'greenhouse.example.com' }) });
  post({ 'raf-bridge': 'open', from: 'raf-bridge' });
  const host2 = w2.document.getElementById('raf-panel-host');
  ok(host2, 'panel opens from bridge messages');
  ok(host2.shadowRoot.querySelectorAll('.row').length >= 10, 'bridge-opened panel lists the fields');
  post({ 'raf-bridge': 'close', from: 'raf-bridge' });
  eq(w2.document.getElementById('raf-panel-host'), null, 'panel closes from a bridge message');

  console.log('--- content wiring (page-realm failure is visible, never silent) ---');
  const w4 = fixture('greenhouse_mock.html').window;
  for (const f of MAIN_WORLD.filter((f) => f !== 'shared/schema.js'))   // the realm background.js used to inject
    w4.eval(fs.readFileSync(SRC(f), 'utf8'));
  const post4 = (data) => w4.dispatchEvent(new w4.MessageEvent('message', { data }));
  post4({ 'raf-bridge': 'state', from: 'raf-bridge',
    state: JSON.stringify({ profile: p1, file: null, learned: {}, eeoOptIn: false, host: 'greenhouse.example.com' }) });
  post4({ 'raf-bridge': 'open', from: 'raf-bridge' });
  const host3 = w4.document.getElementById('raf-panel-host');
  ok(host3 && host3.shadowRoot.querySelector('.note').textContent.includes('Panel failed'),
    'a page-realm crash reports itself in the panel instead of leaving nothing on screen');

  console.log('--- no network calls anywhere ---');
  const allFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }))
      allFiles.push(e.isDirectory() ? path.join(dir, e.name) : path.join(dir, e.name));
  })(path.join(__dirname, '..', 'src'));
  const text = allFiles.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(f, 'utf8')).join(' ');
  const net = text.match(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket\(|\bhttp:\/\//g) || [];
  eq(net.length, 0, 'zero network calls in the source');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.log('CRASH', (e && e.stack) || e); process.exit(1); });

