# Resume Autofiller

A Chrome/Edge extension (Manifest V3) that fills job application forms from your resume — with a review step before anything lands on the page. Import your resume once, open the panel on any application page, and it scans the form, proposes a value for every field it recognizes, and only fills what you approve.

**Everything stays local.** The extension makes zero network calls (the test suite asserts this on every run); your profile, resume bytes, and learned mappings live in `chrome.storage.local`.

## How it works

1. **Import** — the options page parses a PDF, DOCX, or text/Markdown resume into a structured profile (name, contact info, education, experience, links, address). You can hand-edit any field before saving.
2. **Scan** — on an application page the extension detects form fields: labels, `label[for]`, wrapped labels, `aria-label`/`aria-labelledby`, fieldset legends, autocomplete attributes, and hidden inputs (which are skipped).
3. **Match** — each detected field is mapped to a key in the field ontology (`src/shared/schema.js`: `firstName`, `email`, `resumeFile`, `workAuthorization`, …) using fuzzy label matching, with per-host learned overrides that win over the ontology once you correct a mistake.
4. **Review, then Fill** — a Shadow-DOM panel lists every proposal with its value and status. Press **Fill** and it writes each value using native input setters (so React's change tracking fires), then verifies what landed. Unfilled/unmatched fields report `needs-manual` instead of faking success.

## Installation

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this project's root folder (the one containing `manifest.json`).
4. Pin **Resume Autofill** to the toolbar for quick access.

## Usage

1. **Import your resume** — click the extension icon → *Import resume, edit profile*, choose a PDF/DOCX/txt/md file, check the parsed profile, and save.
2. **Go to an application page** — any job posting or application form (Greenhouse, Lever, Ashby, Workday, iCIMS, Taleo, Jobvite, SmartRecruiters, Zoho, BambooHR, Recruitee, or any other ATS — detection is label/structure-based, not host-based).
3. **Open the panel** — click the extension icon, then **Open panel on this page** (or just click the toolbar icon). If the form lives in a cross-origin iframe the extension can't reach yet, it will offer a *Grant access* button; that permission is requested only then, and only for the ATS domains it needs.
4. **Review and Fill** — check the proposed values in the panel (edit them or mark a field *skip*), then press **Fill**. The badge shows `✓` on success, `!` if any frame was unreachable.

Notes:

- **EEO / demographic fields (gender, race, …) are detected but blocked by default** — they show as *blocked* in the panel and are never filled. Enable *Fill EEO / demographic fields* in the popup only if you want them filled from your profile.
- **File uploads and drop zones** get your stored resume attached via `DataTransfer` in the page realm — the only part of the extension that can't run in jsdom, so it's proven separately in `test/spike-browser.html` (see Development).
- **Learned mappings** — if the extension mis-guesses a field, pick the correct key from the panel's dropdown; that correction is stored per-host and wins on the next visit. Manage or clear them from the options page.

## Supported field types

Text inputs, textareas, selects, radio groups (collapsed to one proposal via their legend), checkboxes, file inputs, drag-and-drop upload zones (no `input[type=file]` required), and comboboxes (filled by typing, no fake option clicks). Detection pierces open shadow roots and handles the table-cell layouts some ATS render.

## Project structure

```
manifest.json            MV3 manifest: action popup, options page, service worker
src/
  background.js          Service worker: message router, storage, per-frame injection
  lib/                   Vendored parsers: pdfjs + mammoth (DOCX)
  options/               Resume import, profile editing, learned-mapping management
  popup/                 Panel launch, EEO opt-in, optional-permission grant
  shared/
    schema.js            Field ontology (the canonical keys everything maps to)
    parse.js             Resume text -> profile (names, contact, education, experience)
  content/
    bridge.js            ISOLATED-world shim: the only content file that touches chrome.*
    detect.js            DOM -> field descriptors (labels, kinds, shadow roots)
    match.js             Field descriptors x profile -> proposals
    fill.js              Value writers per field kind, with post-fill verification
    scan.js              MutationObserver re-scan for SPA step changes
    panel.js             Shadow-DOM review panel
    main.js              MAIN-world entry: wires bridge messages to the panel
test/
  run.js                 jsdom suite (no framework, run with: npm test)
  fixtures/              Mock ATS pages + sample resumes
  spike-browser.html     Real-Chrome check for the DataTransfer file-attach path
```

## Development

```powershell
npm install     # only dev dependency: jsdom
npm test        # node test/run.js
```

The suite covers the parser, detector, matcher, fillers, panel, realm-split wiring, and asserts there are no network calls anywhere in `src/`. To check the file-attach path in a real browser, load the unpacked extension and open `test/spike-browser.html`.

## Privacy

No telemetry, no tracking, no outbound requests — the codebase contains no `fetch`, `XMLHttpRequest`, `sendBeacon`, or WebSocket, and a test enforces that. Your resume bytes and profile never leave your machine except through the form you are filling.
