document.addEventListener('DOMContentLoaded', () => {
  const isEnabledCheckbox = document.getElementById('isEnabled');
  const targetLangSelect  = document.getElementById('targetLang');
  const debugModeCheckbox = document.getElementById('debugMode');
  const fontSizeScale     = document.getElementById('fontSizeScale');
  const fontSizeScaleVal  = document.getElementById('fontSizeScaleVal');
  const overlayBottom     = document.getElementById('overlayBottom');
  const overlayBottomVal  = document.getElementById('overlayBottomVal');
  const accentColor       = document.getElementById('accentColor');
  const statusText        = document.getElementById('status');
  const segBtns           = document.querySelectorAll('.seg-btn');
  const providerSelect    = document.getElementById('provider');
  const deepseekSettings  = document.getElementById('deepseekSettings');
  const deepseekApiKey    = document.getElementById('deepseekApiKey');
  const deepseekModel     = document.getElementById('deepseekModel');
  let apiKeyTimer         = null;

  // ── Load saved settings ──────────────────────────────────────
  chrome.storage.sync.get(['isEnabled', 'targetLang', 'subtitleMode', 'debugMode', 'fontSizeScale', 'overlayBottom', 'accentColor', 'provider', 'deepseekModel'], (data) => {
    isEnabledCheckbox.checked = data.isEnabled !== undefined ? data.isEnabled : true;
    targetLangSelect.value    = data.targetLang  || 'vi';
    debugModeCheckbox.checked = data.debugMode || false;
    fontSizeScale.value       = data.fontSizeScale || 1;
    overlayBottom.value       = data.overlayBottom || 55;
    accentColor.value         = data.accentColor   || '#FFD54F';
    providerSelect.value      = data.provider === 'deepseek' ? 'deepseek' : 'google';
    deepseekModel.value       = data.deepseekModel || 'deepseek-v4-flash';
    showDeepseekBlock(providerSelect.value === 'deepseek');
    updateRangeLabels();
    setActiveMode(data.subtitleMode || 'bilingual');
    updateStatus(isEnabledCheckbox.checked);
  });

  chrome.storage.local.get(['deepseekApiKey', 'deepseekError'], (data) => {
    deepseekApiKey.value = data.deepseekApiKey || '';
    if (data.deepseekError) {
      statusText.innerText = `DeepSeek: ${data.deepseekError}`;
      statusText.style.color = '#ff5c5c';
    }
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

  // ── Overlay style controls ───────────────────────────────────
  fontSizeScale.addEventListener('input', () => {
    fontSizeScaleVal.textContent = `${Math.round(fontSizeScale.value * 100)}%`;
    chrome.storage.sync.set({ fontSizeScale: parseFloat(fontSizeScale.value) });
    pushSettings();
  });

  overlayBottom.addEventListener('input', () => {
    overlayBottomVal.textContent = `${overlayBottom.value}px`;
    chrome.storage.sync.set({ overlayBottom: parseInt(overlayBottom.value, 10) });
    pushSettings();
  });

  accentColor.addEventListener('input', () => {
    chrome.storage.sync.set({ accentColor: accentColor.value });
    pushSettings();
  });

  // ── Provider: DeepSeek BYOK ─────────────────────────────────
  providerSelect.addEventListener('change', async () => {
    const val = providerSelect.value;
    // Lưu TRƯỚC khi xin quyền — popup có thể bị đóng giữa prompt,
    // background guard `permissions.contains` sẽ tự fallback gtx
    await chrome.storage.sync.set({ provider: val });
    if (val === 'deepseek') {
      try {
        const granted = await chrome.permissions.request({ origins: ['https://api.deepseek.com/*'] });
        if (!granted) {
          await chrome.storage.sync.set({ provider: 'google' });
          providerSelect.value = 'google';
          updateStatus('Permission denied for api.deepseek.com');
          return;
        }
      } catch (error) {
        // chrome.permissions không có (test env) → cứ tiếp tục
      }
    }
    showDeepseekBlock(val === 'deepseek');
    updateStatus(isEnabledCheckbox.checked);
  });

  deepseekApiKey.addEventListener('input', () => {
    clearTimeout(apiKeyTimer);
    apiKeyTimer = setTimeout(() => {
      chrome.storage.local.set({ deepseekApiKey: deepseekApiKey.value });
      // Key mới → xóa lỗi auth cũ đang hiển thị
      chrome.storage.local.remove('deepseekError');
      updateStatus(isEnabledCheckbox.checked);
    }, 500);
  });

  deepseekModel.addEventListener('change', () => {
    chrome.storage.sync.set({ deepseekModel: deepseekModel.value });
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
  function updateRangeLabels() {
    fontSizeScaleVal.textContent = `${Math.round(fontSizeScale.value * 100)}%`;
    overlayBottomVal.textContent = `${overlayBottom.value}px`;
  }

  function setActiveMode(mode) {
    segBtns.forEach(b => b.classList.toggle('active', b.dataset.value === mode));
  }

  function updateStatus(isEnabled) {
    statusText.innerText     = `Status: ${isEnabled ? 'Active' : 'Paused'}`;
    statusText.style.color   = isEnabled ? '#3ea6ff' : '#aaaaaa';
  }

  function showDeepseekBlock(show) {
    deepseekSettings.hidden = !show;
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
        debugMode:    debugModeCheckbox.checked,
        fontSizeScale: parseFloat(fontSizeScale.value),
        overlayBottom: parseInt(overlayBottom.value, 10),
        accentColor:  accentColor.value
      }).catch(() => {
        console.log('Content script not ready or not on YouTube.');
      });
    });
  }
});
