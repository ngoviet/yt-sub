document.addEventListener('DOMContentLoaded', () => {
  const isEnabledCheckbox = document.getElementById('isEnabled');
  const targetLangSelect  = document.getElementById('targetLang');
  const debugModeCheckbox = document.getElementById('debugMode');
  const statusText        = document.getElementById('status');
  const segBtns           = document.querySelectorAll('.seg-btn');

  // ── Load saved settings ──────────────────────────────────────
  chrome.storage.sync.get(['isEnabled', 'targetLang', 'subtitleMode', 'debugMode'], (data) => {
    isEnabledCheckbox.checked = data.isEnabled !== undefined ? data.isEnabled : true;
    targetLangSelect.value    = data.targetLang  || 'vi';
    debugModeCheckbox.checked = data.debugMode || false;
    setActiveMode(data.subtitleMode || 'bilingual');
    updateStatus(isEnabledCheckbox.checked);
  });

  // ── Master toggle ────────────────────────────────────────────
  isEnabledCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ isEnabled: isEnabledCheckbox.checked });
    pushSettings();
    updateStatus(isEnabledCheckbox.checked);
  });

  // ── Language select ──────────────────────────────────────────
  targetLangSelect.addEventListener('change', () => {
    chrome.storage.sync.set({ targetLang: targetLangSelect.value });
    pushSettings();
  });

  // ── Debug mode toggle ────────────────────────────────────────
  debugModeCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ debugMode: debugModeCheckbox.checked });
    pushSettings();
  });

  // ── Segmented mode buttons ───────────────────────────────────
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.value;
      setActiveMode(mode);
      chrome.storage.sync.set({ subtitleMode: mode });
      pushSettings();
    });
  });

  // ── Helpers ──────────────────────────────────────────────────
  function setActiveMode(mode) {
    segBtns.forEach(b => b.classList.toggle('active', b.dataset.value === mode));
  }

  function updateStatus(isEnabled) {
    statusText.innerText     = `Status: ${isEnabled ? 'Active' : 'Paused'}`;
    statusText.style.color   = isEnabled ? '#3ea6ff' : '#aaaaaa';
  }

  function getActiveMode() {
    const active = document.querySelector('.seg-btn.active');
    return active ? active.dataset.value : 'bilingual';
  }

  function pushSettings() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        action:       'updateSettings',
        isEnabled:    isEnabledCheckbox.checked,
        targetLang:   targetLangSelect.value,
        subtitleMode: getActiveMode(),
        debugMode:    debugModeCheckbox.checked
      }).catch(() => {
        console.log('Content script not ready or not on YouTube.');
      });
    });
  }
});
