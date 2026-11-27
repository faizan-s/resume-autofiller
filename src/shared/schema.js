(() => {
  const NS = (globalThis.RAF ??= {});
  if (NS.schema) return;

  // One entry per profile field. `match` patterns run against normalized text
  // (lowercase, punctuation collapsed to single spaces).
  const fields = [
    // Contact
    { key: 'firstName', label: 'First name', group: 'Contact', kind: 'text', ac: ['given-name'],
      match: [/\bfirst\s*names?\b/, /\bgiven\s*names?\b/, /\bforenames?\b/, /\bfname\b/] },
    { key: 'middleName', label: 'Middle name', group: 'Contact', kind: 'text', ac: ['additional-name'],
      match: [/\bmiddle\s*(names?|initials?)\b/] },
    { key: 'lastName', label: 'Last name', group: 'Contact', kind: 'text', ac: ['family-name'],
      match: [/\blast\s*names?\b/, /\bfamily\s*names?\b/, /\bsurnames?\b/, /\blname\b/] },
    { key: 'fullName', label: 'Full name', group: 'Contact', kind: 'text', derived: true, ac: ['name'],
      match: [/\b(full|legal|candidate)\s*names?\b/, /^names?$/] },
    { key: 'preferredName', label: 'Preferred name', group: 'Contact', kind: 'text', ac: ['nickname'],
      match: [/\bpreferred\s*names?\b/, /\bnicknames?\b/] },
    { key: 'email', label: 'Email', group: 'Contact', kind: 'email', ac: ['email'],
      match: [/\be\s*mail\b/, /\bemail\s*address\b/] },
    { key: 'phone', label: 'Phone', group: 'Contact', kind: 'tel', ac: ['tel', 'tel-national'],
      match: [/\b(phone|telephone|mobile|cell|cellphone)\b/, /\bcontact\s*(number|phone)\b/] },
    { key: 'pronouns', label: 'Pronouns', group: 'Contact', kind: 'text',
      match: [/\bpronouns?\b/] },

    { key: 'addressLine1', label: 'Address line 1', group: 'Address', kind: 'text', ac: ['street-address', 'address-line1'],
      match: [/\b(street|address)\b/], reject: [/\b(e\s*mail|email|line\s*(2|two)|url|web|website)\b/] },
    { key: 'addressLine2', label: 'Address line 2', group: 'Address', kind: 'text', ac: ['address-line2'],
      match: [/\b(line\s*(2|two)|apt|apartment|suite|unit)\b/] },
    { key: 'city', label: 'City', group: 'Address', kind: 'text', ac: ['address-level2'],
      match: [/\bcity\b/, /\btown\b/], reject: [/\bcitizen/] },
    { key: 'state', label: 'State / province', group: 'Address', kind: 'text', ac: ['address-level1'],
      match: [/\bstate\b/, /\bprovince\b/, /\bcounty\b/], reject: [/\bstatement\b/] },
    { key: 'postalCode', label: 'Postal code', group: 'Address', kind: 'text', ac: ['postal-code'],
      match: [/\b(zip|postal)\b/] },
    { key: 'country', label: 'Country', group: 'Address', kind: 'text', ac: ['country', 'country-name'],
      match: [/\bcountry\b/], reject: [/\b(phone|dial|code)\b/] },

    { key: 'linkedin', label: 'LinkedIn', group: 'Links', kind: 'url', ac: ['url'],
      match: [/\blinked\s*in\b/] },
    { key: 'github', label: 'GitHub', group: 'Links', kind: 'url', ac: ['url'],
      match: [/\bgit\s*hub\b/] },
    { key: 'portfolio', label: 'Portfolio', group: 'Links', kind: 'url',
      match: [/\bportfolio\b/] },
    { key: 'website', label: 'Website', group: 'Links', kind: 'url', ac: ['url'],
      match: [/\b(website|web\s*site|personal\s*site|blog)\b/, /\burl\b/] },

    // Work
    { key: 'currentTitle', label: 'Current job title', group: 'Work', kind: 'text', ac: ['organization-title'],
      match: [/\b(job|current|most\s*recent)\s*titles?\b/, /\b(current\s*)?(position|role|occupation)\b/],
      reject: [/\b(mr|mrs|ms|dr)\b/, /\btitle\s*of\b/] },
    { key: 'currentCompany', label: 'Current company', group: 'Work', kind: 'text', ac: ['organization'],
      match: [/\b(current\s*)?(company|employer|organi[sz]ation)\b/],
      reject: [/\b(size|website|address|industry)\b/] },
    { key: 'totalYearsExperience', label: 'Years of experience', group: 'Work', kind: 'number',
      match: [/\b(years?|yrs?)\b[^.]*\bexperience\b/, /\bexperience\b[^.]*\b(years?|yrs?)\b/] },
    { key: 'workAuthorization', label: 'Authorized to work', group: 'Work', kind: 'choice', options: ['Yes', 'No'],
      match: [/\bauthori[sz]ed\b/, /\bright\s*to\s*work\b/, /\blegally\b[^.]*\bwork\b/],
      reject: [/\bsponsor/] },
    { key: 'requiresSponsorship', label: 'Needs sponsorship', group: 'Work', kind: 'choice', options: ['Yes', 'No'],
      match: [/\bsponsor/] },
    { key: 'noticePeriod', label: 'Notice period', group: 'Work', kind: 'text',
      match: [/\bnotice\s*period\b/] },
    { key: 'desiredSalary', label: 'Desired salary', group: 'Work', kind: 'text',
      match: [/\b(salary|compensation|pay)\b[^.]*\b(expect|desired|require|target|request)/,
        /\b(expected|desired|target)\b[^.]*\b(salary|compensation|pay)\b/] },
    { key: 'earliestStartDate', label: 'Earliest start date', group: 'Work', kind: 'date',
      match: [/\b(start|availability|available|earliest)\b[^.]*\b(date|start|begin|join)\b/,
        /\bwhen\s+can\s+you\s+(start|begin)\b/] },
    { key: 'willingToRelocate', label: 'Willing to relocate', group: 'Work', kind: 'choice', options: ['Yes', 'No'],
      match: [/\brelocat/] },

    // Education
    { key: 'highestEducation', label: 'Highest education', group: 'Education', kind: 'choice',
      options: ['High School', 'Associate', "Bachelor's", "Master's", 'Doctorate'],
      match: [/\b(highest|level\s*of)\b[^.]*\beducation\b/, /\beducation\s*level\b/, /\bdegree\s*(type|level)\b/] },
    { key: 'school', label: 'School', group: 'Education', kind: 'text',
      match: [/\b(school|university|college|institution)\b/], reject: [/\bdistrict\b/] },
    { key: 'degree', label: 'Degree', group: 'Education', kind: 'text',
      match: [/\bdegree\b/, /\bqualification\b/], reject: [/\b(level|type)\b/] },
    { key: 'major', label: 'Major / field of study', group: 'Education', kind: 'text',
      match: [/\b(major|field\s*of\s*study|discipline|concentration)\b/] },
    { key: 'graduationYear', label: 'Graduation year', group: 'Education', kind: 'number',
      match: [/\bgraduat\w*/, /\bcompletion\b/] },
    { key: 'skills', label: 'Skills', group: 'Education', kind: 'text',
      match: [/\bskills?\b/], reject: [/\b(level|assessment|rating)\b/] },

    // Non-text field
    { key: 'resumeFile', label: 'Resume file', group: 'Other', kind: 'file',
      match: [/\b(resume|cv|curriculum\s*vitae|attachment)\b/] },

    { key: 'coverLetter', label: 'Cover letter / comments', group: 'Other', kind: 'text',
      match: [/\bcover\s*letters?\b/, /\bcomments?\b/, /\badditional\s+(info|information|notes)\b/, /\banything\s*else\b/] },

    { key: 'currentCompensation', label: 'Current compensation', group: 'Work', kind: 'text',
      match: [/\bcurrent\b[^.]*\b(salary|compensation|pay|pay rate)\b/, /\b(last|previous)\b[^.]*\b(salary|compensation)\b/] },

    // EEO / demographic: matched for display, never filled unless the user opts in.
    { key: 'gender', label: 'Gender (EEO)', group: 'EEO', kind: 'choice', blocked: true,
      match: [/^gender\b/, /\bsex\b/, /\bgender identity\b/] },
    { key: 'race', label: 'Race / ethnicity (EEO)', group: 'EEO', kind: 'choice', blocked: true,
      match: [/\brace\b/, /\bethnicity\b/, /\brace and ethnicity\b/] },
    { key: 'veteranStatus', label: 'Veteran status (EEO)', group: 'EEO', kind: 'choice', blocked: true,
      match: [/\bveteran\b/, /\bveteran status\b/] },
    { key: 'disability', label: 'Disability status (EEO)', group: 'EEO', kind: 'choice', blocked: true,
      match: [/\bdisab\w+/, /\breasonable accommodation\b/] },
    { key: 'nationalOrigin', label: 'National origin (EEO)', group: 'EEO', kind: 'choice', blocked: true,
      match: [/\bnational origin\b/, /\bancestry\b/] },
    { key: 'dob', label: 'Date of birth (EEO)', group: 'EEO', kind: 'date', blocked: true,
      match: [/\bdate of birth\b/, /\bbirth date\b/, /\bborn\b/] },
    { key: 'ssn', label: 'Social security number', group: 'EEO', kind: 'text', blocked: true,
      match: [/\bsocial security\b/, /\bssn\b/] },
  ];

  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  const groups = [...new Set(fields.filter((f) => !f.derived && f.kind !== 'file').map((f) => f.group))];

  NS.schema = { fields, byKey, groups };
})();
