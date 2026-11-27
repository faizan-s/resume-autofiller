// Score field descriptors against the schema (alias ontology) plus learned per-host overrides.
// Pure functions, no chrome.* calls.
(() => {
  const NS = (globalThis.RAF ??= {});
  if (NS.match) return;

  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // autocomplete tokens are the strongest signal when a site emits them.
  const AC = {
    'given-name': 'firstName', 'additional-name': 'middleName', 'family-name': 'lastName',
    name: 'fullName', email: 'email', tel: 'phone', 'tel-national': 'phone', 'tel-mobile': 'phone',
    'street-address': 'addressLine1', 'address-line1': 'addressLine1', 'address-line2': 'addressLine2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'postalCode',
    country: 'country', 'country-name': 'country', organization: 'currentCompany',
    'organization-title': 'currentTitle', url: 'website',
  };

  const EDU = /educat|academic|school|degree|qualification/;
  const WORK = /experience|employment|work history|professional|job/;
  const EDU_KEYS = ['highestEducation', 'school', 'degree', 'major', 'graduationYear', 'skills'];
  const WORK_KEYS = ['currentTitle', 'currentCompany', 'totalYearsExperience', 'desiredSalary',
    'noticePeriod', 'workAuthorization', 'requiresSponsorship', 'currentCompensation'];

  function acKey(ac) {
    const token = (ac || '').toLowerCase().split(/\s+/).pop();
    return AC[token] || '';
  }

  function scoreField(f, def) {
    if (def.kind === 'file') { if (f.kind !== 'file' && f.kind !== 'dropzone') return 0; }
    else if (f.kind === 'file' || f.kind === 'dropzone') return 0;
    if ((f.kind === 'radio' || f.kind === 'checkbox') && def.kind !== 'choice') return 0;

    const label = norm(f.label), ident = norm(`${f.name} ${f.id}`), near = norm(f.near);
    const placeholder = norm(f.placeholder), context = norm(f.context);
    const all = [label, ident, near, placeholder, context, norm(f.ac)].join(' ');
    if (def.reject && def.reject.some((re) => re.test(all))) return 0;

    const ac = acKey(f.ac);
    if (ac && def.ac && def.ac.includes(ac)) return 1;

    let best = 0;
    for (const [text, weight] of [[label, 1], [ident, 0.8], [placeholder, 0.7], [near, 0.55], [context, 0.35]]) {
      if (!text) continue;
      for (const re of def.match) if (re.test(text)) { best = Math.max(best, weight); break; }
    }

    // A Yes/No option list corroborates a choice key (the sponsorship question, etc.)
    if (best && f.options.length && def.kind === 'choice' && def.options) {
      const texts = f.options.map((o) => norm(o.text));
      const yesno = ['yes', 'no'].every((t) => texts.includes(t));
      const hits = texts.some((t) => def.options.map(norm).includes(t));
      if (yesno) best = Math.min(1, best + 0.15);
      else if (hits) best = Math.min(1, best + 0.1);
    }
    if (!best) return 0;

    const section = `${f.context} ${f.near} ${f.legend || ''}`;
    if (EDU.test(section)) best += EDU_KEYS.includes(def.key) ? 0.1 : WORK_KEYS.includes(def.key) ? -0.05 : 0;
    if (WORK.test(section)) best += WORK_KEYS.includes(def.key) ? 0.05 : EDU_KEYS.includes(def.key) ? -0.05 : 0;
    return Math.max(0, Math.min(1, best));
  }

  function valueFor(key, profile) {
    if (key === 'fullName') {
      const full = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ');
      return full || profile.fullName || '';
    }
    const v = profile[key];
    return v == null ? '' : String(v);
  }

  // learned[host][fp] is checked before the ontology, so a remap you make once sticks.
  function build(fields, profile, learned, host, opts = {}) {
    const saved = (learned || {})[host] || {};
    const threshold = opts.threshold || 0.45;

    return fields.map((f) => {
      const savedKey = saved[f.fp];
      const cands = [];
      let key = '', score = 0, source = 'guess';

      if (savedKey) { key = savedKey; score = 1; source = 'learned'; }
      else {
        cands.push(...NS.schema.fields
          .map((def) => ({ key: def.key, score: scoreField(f, def) }))
          .filter((c) => c.score >= threshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5));
        if (cands[0]) { key = cands[0].key; score = cands[0].score; }
      }

      const def = NS.schema.byKey[key];
      const value = key ? valueFor(key, profile) : '';
      const blocked = !!(def && def.blocked);
      const isFile = f.kind === 'file' || f.kind === 'dropzone';

      return {
        field: f, key, value, score, source, def, candidates: cands, blocked,
        group: def ? def.group : 'Unmatched',
        status: !key ? 'unmatched'
          : blocked && !opts.eeoOptIn ? 'blocked'
          : isFile ? (opts.file ? 'ready' : 'needs-manual')
          : !value ? 'missing'
          : 'ready',
        confidence: source === 'learned' ? 'learned' : score >= 0.85 ? 'high' : score >= 0.6 ? 'medium' : score ? 'low' : 'none',
        prefilled: !!f.value,
      };
    });
  }

  NS.match = { build, valueFor, scoreField, AC, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS;
})();
