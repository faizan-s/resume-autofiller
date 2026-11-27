(() => {
  const NS = (globalThis.RAF ??= {});
  if (NS.parse) return;

  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const cleanLine = (s) => squash(s.replace(/^#+\s*/, '').replace(/^[\s•·*\-–—]+/, ''));

  // Date ranges are noise for title/company splitting, so strip them before splitting on separators.
  const DATE_RANGE = /\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4})\s*[-–—]\s*(?:Present|Now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4})\b/gi;
  const stripDates = (s) => squash(s.replace(DATE_RANGE, '').replace(/\(\s*\)/g, '').replace(/[|,;]\s*$/, ''));

  const MONTH = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  // Month-accurate job ranges: "Mar 2021 - Present", "2018-2021", "Jan 2019 – Jul 2020". A range with
  // no months defaults to a Jan start and a Dec end.
  const EXP_RANGE = /\b(?:(?<sm>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?<sy>(19|20)\d{2})\s*[-–—]\s*(?:(?<em>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(?<ey>(19|20)\d{2}|present|now)/gi;

  // Sum the union of the experience section's date ranges: overlapping jobs count once, gaps count
  // zero, "Present" clamps to today. Education years are outside this section, so they never inflate.
  function yearsWorked(lines) {
    const now = new Date();
    const cur = now.getFullYear() * 12 + now.getMonth();
    const spans = [];
    for (const line of lines) {
      for (const m of line.matchAll(EXP_RANGE)) {
        const g = m.groups;
        const start = +g.sy * 12 + (g.sm ? MONTH[g.sm.slice(0, 3).toLowerCase()] : 0);
        const end = /present|now/i.test(g.ey) ? cur : +g.ey * 12 + (g.em ? MONTH[g.em.slice(0, 3).toLowerCase()] : 11);
        if (start >= 1970 * 12 && end > start) spans.push([start, Math.min(end, cur)]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    let months = 0, top = -1;
    for (const [s, e] of spans) if (e > top) { months += e - Math.max(s, top); top = e; }
    return Math.round(months / 12);
  }


  const SECTION = /^(experience|work\s+experience|employment|professional\s+experience|education|skills|technical\s+skills|projects|certifications?|summary|profile|contact|languages|awards|publications|volunteer(ing)?|interests|references|activities)\b/i;
  const NOT_NAME = /(engineer|developer|manager|designer|analyst|consultant|scientist|architect|specialist|director|intern|resume|curriculum|vitae|@|http|\d)/i;
  const NAME_RE = /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,3}$/;
  const TITLE_RE = /(engineer|developer|manager|designer|analyst|consultant|scientist|architect|specialist|director|lead|intern|president|officer|administrator|coordinator|accountant|nurse|teacher|researcher)/i;
  const COMPANY_RE = /(inc|llc|ltd|corp|co\.|company|technologies|technology|labs|systems|solutions|university|college|group|studio|media|bank|hospital|partners|consulting|agency|foundation|institute)\b/i;
  const DEGREE_RE = /(bachelor|master|doctor|ph\.?d|mba|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|associate|diploma)/i;

  function titleCase(s) {
    return s.replace(/\S+/g, (w) =>
      w.length > 2 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w);
  }

  function findName(lines) {
    for (const raw of lines.slice(0, 8)) {
      const line = raw.replace(/\s*[|·].*$/, '').trim();
      if (!line || line.length > 48 || SECTION.test(line) || NOT_NAME.test(line)) continue;
      if (!NAME_RE.test(line)) continue;
      const words = line.split(/\s+/);
      const caps = words.filter((w) => /^[A-Z]/.test(w)).length;
      if (caps < 2 && caps !== words.length) continue;
      const name = titleCase(line);
      const parts = name.split(/\s+/);
      const out = { fullName: name, firstName: parts[0], lastName: parts[parts.length - 1] };
      if (parts.length > 2) out.middleName = parts.slice(1, -1).join(' ');
      return out;
    }
    return {};
  }

  function findPhone(text) {
    const re = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/g;
    for (const m of text.matchAll(re)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 9 && digits.length <= 15) return squash(m[0]);
    }
    return '';
  }

  function findLinks(text) {
    const out = {};
    const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+/i);
    const gh = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i);
    if (li) out.linkedin = normalizeUrl(li[0]);
    if (gh) out.github = normalizeUrl(gh[0]);
    const urls = [...text.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s|,)]*/gi)].map((m) => m[0]);
    for (const u of urls) {
      if (/linkedin|github/i.test(u) || /@/.test(u)) continue;
      out.website = normalizeUrl(u);
      break;
    }
    const pf = text.match(/(?:portfolio|website)[:\s]+((?:https?:\/\/)?[^\s|,)]+\.[^\s|,)]+)/i);
    if (pf) out.portfolio = normalizeUrl(pf[1]);
    return out;
  }

  const normalizeUrl = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u).replace(/[.,;]+$/, '');

  function findLocation(lines) {
    for (const raw of lines.slice(0, 12)) {
      const line = squash(raw);
      const us = line.match(/^([A-Z][A-Za-z .'-]{1,30}),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?$/);
      if (us) return { city: us[1].trim(), state: us[2], postalCode: us[3] || '' };
      const generic = line.match(/^([A-Z][A-Za-z .'-]{1,30}),\s*([A-Z][A-Za-z .'-]{1,30})$/);
      if (generic && !/@/.test(line)) return { city: generic[1].trim(), country: generic[2].trim() };
    }
    return {};
  }

  function headingIndex(lines) {
    const marks = [];
    lines.forEach((line, i) => {
      const l = line.replace(/[:\s]+$/, '');
      if (l.length <= 45 && l.split(/\s+/).length <= 4 && SECTION.test(l)) {
        marks.push({ i, name: l.toLowerCase().replace(/\s+/g, ' ') });
      }
    });
    return marks;
  }

  function block(lines, marks, re) {
    const start = marks.find((m) => re.test(m.name));
    if (!start) return [];
    const next = marks.find((m) => m.i > start.i);
    return lines.slice(start.i + 1, next ? next.i : lines.length).filter(Boolean);
  }

  function education(raw, marks) {
    const out = {};
    const edu = block(raw, marks, /educat|academic|qualification/);
    const source = edu.length ? edu : raw;
    for (const line of source) {
      const segs = line.split(/\s*[,|]\s*/).map(squash).filter(Boolean);
      if (!segs.length) continue;
      if (!out.school) {
        const i = segs.findIndex((s) => /(university|college|institute|academy|school)/i.test(s));
        if (i >= 0) {
          const parts = [segs[i]];
          for (const s of segs.slice(i + 1)) {
            if (/^\d{4}$/.test(s) || /(gpa|degree|major|cum laude)/i.test(s)) break;
            if (/^[A-Z]/.test(s)) parts.push(s);
          }
          out.school = parts.join(', ');
        }
      }
      const deg = segs.find((s) => DEGREE_RE.test(s));
      if (!out.degree && deg) {
        out.degree = deg;
        const major = deg.match(/\bin\s+([A-Za-z][A-Za-z&' -]{2,40})/i);
        if (major) out.major = squash(major[1]).replace(/[,\s]+$/, '');
      }
      if (!out.graduationYear) {
        const year = segs[segs.length - 1].match(/\b(19|20)\d{2}\b/);
        if (year) out.graduationYear = year[0];
      }
    }
    if (out.degree) {
      const d = out.degree;
      out.highestEducation = /ph\.?d|doctor/i.test(d) ? 'Doctorate'
        : /master|mba|m\.?s\.?|m\.?a\.?/i.test(d) ? "Master's"
        : /bachelor|b\.?s\.?|b\.?a\.?/i.test(d) ? "Bachelor's"
        : /associate/i.test(d) ? 'Associate' : 'High School';
    }
    return out;
  }

  function experience(body, marks, raw) {
    const out = {};
    const exp = block(body, marks, /experience|employment|work history/);
    let title = '';
    let company = '';
    for (const line of exp.slice(0, 12)) {
      const parts = line.split(/\s+[—–]\s+|\s+\|\s+|\s+at\s+/i).map(squash).filter(Boolean);
      if (parts.length >= 2) {
        const t = parts.find((p) => TITLE_RE.test(p));
        const c = parts.find((p) => p !== t && COMPANY_RE.test(p)) || parts.find((p) => p !== t);
        if (t && c) { title = t; company = c; break; }
      }
      if (!title && TITLE_RE.test(line) && line.length < 70) title = line;
      if (!company && COMPANY_RE.test(line) && line.length < 70) company = line;
      if (title && company) break;
    }
    if (title) out.currentTitle = title.replace(/\s*[|,].*$/, '');
    if (company) out.currentCompany = company.replace(/\s*\|.*$/, '');
    const worked = yearsWorked(block(raw, marks, /experience|employment|work history/));
    if (worked > 0) out.totalYearsExperience = String(worked);
    // shortcut: min-year span is the fallback for heading-less resumes, which have no ranges to union.
    const thisYear = new Date().getFullYear();
    const years = (raw.join(' ').match(/\b(19|20)\d{2}\b/g) || []).map(Number).filter((y) => y >= 1970 && y <= thisYear);
    if (!out.totalYearsExperience && years.length) {
      const span = thisYear - Math.min(...years);
      if (span > 0 && span < 55) out.totalYearsExperience = String(span);
    }
    return out;
  }

  function resume(text) {
    const raw = text.split(/\r?\n/).map(cleanLine).filter(Boolean);
    const flat = raw.join('\n');
    const marks = headingIndex(raw);
    const body = raw.map(stripDates);
    const profile = {
      ...findName(raw),
      ...findLocation(raw),
      ...findLinks(flat),
      ...education(raw, marks),
      ...experience(body, marks, raw),
    };
    const email = flat.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) profile.email = email[0];
    const phone = findPhone(body.slice(0, 25).join('\n'));
    if (phone) profile.phone = phone;
    if (!profile.fullName && profile.firstName && profile.lastName) {
      profile.fullName = `${profile.firstName} ${profile.lastName}`;
    }
    for (const k of Object.keys(profile)) if (!profile[k]) delete profile[k];
    return profile;
  }

  async function pdfToText(buf) {
    if (!globalThis.pdfjsLib) throw new Error('pdf.js failed to load');
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/lib/pdf.worker.min.js');
    const doc = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const it of content.items) {
        if (!it.str || !it.transform) continue;
        const y = Math.round(it.transform[5] / 3) * 3;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: it.transform[4], s: it.str });
      }
      const lines = [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' '))
        .map(squash)
        .filter(Boolean);
      out.push(lines.join('\n'));
    }
    return out.join('\n');
  }

  async function docxToText(buf) {
    if (!globalThis.mammoth) throw new Error('mammoth failed to load');
    return (await globalThis.mammoth.extractRawText({ arrayBuffer: buf })).value;
  }

  NS.parse = { resume, pdfToText, docxToText };
})();
