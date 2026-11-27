// MV3 service worker: message router, storage, and injection into the frames we can legally reach.
// No host permissions are requested up front; cross-origin ATS iframes use optional permissions.
// Two realms per frame: the isolated-world bridge owns chrome.*, the MAIN-world modules are pure DOM.
// MAIN world is what makes DataTransfer file attach and React's value tracker work in the page realm.
const BRIDGE = ['src/content/bridge.js'];
const MAIN_FILES = ['src/shared/schema.js', 'src/content/detect.js', 'src/content/match.js',
  'src/content/fill.js', 'src/content/panel.js', 'src/content/scan.js', 'src/content/main.js'];

async function readState() {
  const s = await chrome.storage.local.get(['profile', 'resumeFile', 'learned', 'eeoOptIn']);
  return {
    profile: s.profile || {},
    file: s.resumeFile || null,
    learned: s.learned || {},
    eeoOptIn: !!s.eeoOptIn,
  };
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return ''; }
}

// Inject into the top frame plus any subframe whose origin we already have access to. Returns the
// origins we could not reach, so the popup can offer an optional-permission grant.
async function inject(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const blocked = [];
  for (const f of frames) {
    const origin = new URL(f.url).origin;
    const allowed = f.frameId === 0 || await chrome.permissions.contains({ origins: [origin] });
    if (!allowed) { blocked.push(origin); continue; }
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [f.frameId] }, files: BRIDGE, world: 'ISOLATED' });
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [f.frameId] }, files: MAIN_FILES, world: 'MAIN' });
    } catch (e) { blocked.push(origin); }   // activeTab covers the top frame only
  }
  return blocked;
}

async function openPanel(tabId, url) {
  const state = await readState();
  state.host = hostOf(url);
  const blocked = await inject(tabId);
  const res = await chrome.tabs.sendMessage(tabId, { type: 'RA:STATE', state: { ...state, blocked } });
  await chrome.tabs.sendMessage(tabId, { type: 'RA:OPEN' });
  return { state, blocked, ok: res && res.ok };
}

async function setBadge(tabId, text) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2e7d32' });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const scheme = (tab.url || '').split(':')[0];
  if (scheme !== 'http' && scheme !== 'https') return;   // chrome://, file://, view-source: cannot be scripted
  const out = await openPanel(tab.id, tab.url);
  setBadge(tab.id, out.blocked.length ? '!' : '✓');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'RA:LEARN') {
      const s = await chrome.storage.local.get(['learned']);
      const learned = s.learned || {};
      const map = learned[msg.host] || {};
      map[msg.fp] = msg.key;
      learned[msg.host] = map;
      await chrome.storage.local.set({ learned });
      sendResponse({ ok: true });
    } else if (msg.type === 'RA:STATE') {
      sendResponse({ state: await readState() });
    } else if (msg.type === 'RA:OPEN') {
      sendResponse(await openPanel(msg.tabId, msg.url || (sender.tab && sender.tab.url) || ''));
    } else if (msg.type === 'RA:CLOSE') {
      sendResponse(await chrome.tabs.sendMessage(msg.tabId, { type: 'RA:CLOSE' }));
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;   // async response
});
