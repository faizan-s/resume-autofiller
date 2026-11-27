// Popup: status, panel launch, EEO opt-in, optional-permission grant for cross-origin frames.
const $ = (id) => document.getElementById(id);
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return ''; } };

// Declared as optional_permissions in the manifest; the popup asks for them only when a frame is blocked.
const OPTIONAL_HOSTS = [
  '*://*.greenhouse.co/*', '*://*.lever.co/*', '*://*.ashbyhq.com/*', '*://*.workday.com/*',
  '*://*.myworkdayjobs.com/*', '*://*.smartrecruiters.com/*', '*://*.icims.com/*', '*://*.taleo.net/*',
  '*://*.jobvite.com/*', '*://*.zoho.com/*', '*://*.bamboohr.com/*', '*://*.recruitee.com/*',
];

async function activeTab() {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function init() {
  const tab = await activeTab();
  const { state } = await chrome.runtime.sendMessage({ type: 'RA:STATE' });
  const ready = state.profile && Object.keys(state.profile).length > 0;

  $('status').textContent = ready
    ? `Profile: ${state.profile.fullName || state.profile.firstName || 'set'} · resume: ${state.file ? state.file.name : 'none'}`
    : 'No resume imported yet. Open Options to import one.';
  $('eeo').checked = state.eeoOptIn;
  $('open').disabled = !ready;

  // Prime the content script (if already injected) with the current profile + host.
  chrome.tabs.sendMessage(tab.id, { type: 'RA:STATE', state: { ...state, host: hostOf(tab.url) } }).catch(() => {});

  $('open').addEventListener('click', async () => {
    const out = await chrome.runtime.sendMessage({ type: 'RA:OPEN', tabId: tab.id, url: tab.url });
    if (out && out.blocked && out.blocked.length) {
      $('frames').textContent = `Skipped ${out.blocked.length} cross-origin frame(s): fields there need access.`;
      $('grant').classList.remove('hidden');
    } else {
      $('frames').textContent = out && out.ok ? 'Panel opened. Review, then press Fill.' : 'Page not reachable.';
    }
  });

  $('grant').addEventListener('click', async () => {
    // permissions.request must ride a real user gesture, so it runs here in the popup and not in the
    // service worker's message handler.
    const ok = await chrome.permissions.request({ origins: OPTIONAL_HOSTS });
    $('frames').textContent = ok ? 'Access granted. Press "Open panel" again.' : 'Access declined; frames will stay unfilled.';
    $('grant').classList.add('hidden');
  });

  $('eeo').addEventListener('change', async () => {
    await chrome.storage.local.set({ eeoOptIn: $('eeo').checked });
    $('frames').textContent = $('eeo').checked
      ? 'EEO opt-in is on: demographic fields will be filled from your profile.'
      : 'EEO fields stay blocked.';
  });

  $('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
}

init();
