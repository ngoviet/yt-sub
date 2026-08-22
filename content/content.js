let targetLang        = 'vi';
let isEnabled         = true;
let subtitleMode      = 'bilingual'; // 'bilingual' | 'translated-only' | 'original-only'
let subtitleObserver  = null;
let shadowObserver   = null;
let debounceTimer     = null;
let translationGeneration = 0;
let debugMode         = false;
let pollTimer         = null;
let pollAttempts      = 0;
const MAX_POLL_ATTEMPTS = 30; // 30s tối đa chờ player

// ── State dịch theo từng segment ───────────────────────────────────────
const segmentStates = new Map(); // element → { text, translated }
const inflight      = new Map(); // key 'text_targetLang' → Promise

// ── Selectors (gom 1 chỗ — YouTube có thể đổi class) ─────────────────
const CAPTION_AREA_SELECTOR = '.ytp-caption-window-container';
const SEGMENT_SELECTOR      = '.ytp-caption-segment';
const SETTINGS_KEYS         = ['targetLang', 'isEnabled', 'subtitleMode', 'debugMode'];

// ── Debug Logger ──────────────────────────────────────────────────────
function logDebug(...args) {
  if (debugMode) {
    console.log('[YouTube Bilingual Subtitles]', ...args);
  }
}

// ── Query cả Light DOM lẫn Shadow DOM của caption area ────────────────
function queryAllInRoots(selector) {
  const results = [...document.querySelectorAll(selector)];
  const area = document.querySelector(CAPTION_AREA_SELECTOR);
  const shadow = area && area.shadowRoot;
  if (shadow) results.push(...shadow.querySelectorAll(selector));
  return results;
}

// ── Initialize from storage ──────────────────────────────────────────
chrome.storage.sync.get(['targetLang', 'isEnabled', 'subtitleMode', 'debugMode'], (data) => {
  if (data.targetLang)   targetLang   = data.targetLang;
  if (data.subtitleMode) subtitleMode = data.subtitleMode;
  if (data.isEnabled !== undefined) isEnabled = data.isEnabled;
  if (data.debugMode) debugMode = data.debugMode;
  applyMode();
  logDebug('Extension initialized with settings:', { targetLang, subtitleMode, isEnabled, debugMode });
});

// ── Messages from popup ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateSettings') {
    targetLang   = request.targetLang;
    subtitleMode = request.subtitleMode;
    isEnabled    = request.isEnabled;
    debugMode    = request.debugMode || debugMode;
    resetTranslationState();
    applyMode();
    logDebug('Settings updated:', { targetLang, subtitleMode, isEnabled, debugMode });
  }
});

// ── Storage change: mọi tab YouTube tự cập nhật (không chỉ tab active) ─
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  let changed = false;
  for (const key of SETTINGS_KEYS) {
    const change = changes[key];
    if (!change) continue;
    if (key === 'targetLang'   && change.newValue !== targetLang)   { targetLang   = change.newValue; changed = true; }
    if (key === 'isEnabled'    && change.newValue !== isEnabled)    { isEnabled    = change.newValue; changed = true; }
    if (key === 'subtitleMode' && change.newValue !== subtitleMode) { subtitleMode = change.newValue; changed = true; }
    if (key === 'debugMode'    && change.newValue !== debugMode)    { debugMode    = change.newValue; changed = true; }
  }
  if (changed) {
    resetTranslationState();
    applyMode();
  }
});

// ── Reset mọi trạng thái dịch (settings đổi / SPA nav) ────────────────
function resetTranslationState() {
  segmentStates.clear();
  inflight.clear();
  translationGeneration++;
  removeOverlay();
  removeBilingualWrappers();
  showOriginalCaptions();
}

// ── Apply current mode ───────────────────────────────────────────────
function applyMode() {
  if (!isEnabled || subtitleMode === 'original-only') {
    stopObserving();
    removeOverlay();
    showOriginalCaptions();
    return;
  }
  showOriginalCaptions();
  waitForPlayerAndObserve();
}

// ── YouTube SPA navigation ───────────────────────────────────────────
// `yt-navigate-finish` fire sau mỗi lần SPA navigation (rẻ hơn
// MutationObserver quét toàn body subtree)
let lastUrl = location.href;
function onUrlChange() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  resetTranslationState();
  stopObserving();
  if (isEnabled && subtitleMode !== 'original-only') {
    waitForPlayerAndObserve();
  }
  logDebug('URL changed to:', location.href);
}
document.addEventListener('yt-navigate-finish', onUrlChange);

// ── Observer setup ───────────────────────────────────────────────────
function waitForPlayerAndObserve() {
  if (subtitleObserver) return;

  const captionArea = document.querySelector(CAPTION_AREA_SELECTOR);
  logDebug('Looking for captionArea...', captionArea ? 'FOUND' : 'NOT FOUND');
  if (!captionArea) {
    // Giới hạn poll: 30 lần (30s) — không leak timer khi player không xuất hiện
    if (pollAttempts < MAX_POLL_ATTEMPTS) {
      pollAttempts++;
      pollTimer = setTimeout(waitForPlayerAndObserve, 1000);
    }
    return;
  }
  pollAttempts = 0;

  subtitleObserver = new MutationObserver((mutations) => {
    if (mutations.some(isRealCaptionMutation)) {
      logDebug('Mutation detected, calling handleSubtitleUpdate');
      handleSubtitleUpdate();
    }
  });

  // Observe the Light DOM
  subtitleObserver.observe(captionArea, {
    childList: true, subtree: true, characterData: true
  });
  
  // Also observe the Shadow DOM if it exists
  const shadowRoot = captionArea.shadowRoot;
  logDebug('Shadow DOM detected:', shadowRoot ? 'YES' : 'NO');
  if (shadowRoot && !shadowObserver) {
    shadowObserver = new MutationObserver((mutations) => {
      if (mutations.some(isRealCaptionMutation)) {
        logDebug('Shadow DOM mutation detected, calling handleSubtitleUpdate');
        handleSubtitleUpdate();
      }
    });
    
    shadowObserver.observe(shadowRoot, {
      childList: true, subtree: true, characterData: true
    });
    logDebug('Shadow DOM observer started');
  }
  
  logDebug('Subtitle observer started');
}

function stopObserving() {
  clearTimeout(pollTimer);
  pollTimer = null;
  if (subtitleObserver) {
    subtitleObserver.disconnect();
    subtitleObserver = null;
  }
  if (shadowObserver) {
    shadowObserver.disconnect();
    shadowObserver = null;
  }
  logDebug('Subtitle observer stopped');
}

// ── Mutation filter dùng chung 2 observer ────────────────────────────
function isRealCaptionMutation(m) {
  // Skip if target is our bilingual wrapper
  if (m.target.closest && m.target.closest('[data-bilingual-wrapper]')) return false;
  // Check added nodes
  if (m.addedNodes.length > 0) {
    return [...m.addedNodes].some(n =>
      n.nodeType === Node.ELEMENT_NODE &&
      !n.dataset?.bilingual &&
      !(n.closest && n.closest('[data-bilingual-wrapper]'))
    );
  }
  // Check for text content changes
  if (m.type === 'characterData') {
    return !m.target.closest?.('[data-bilingual-wrapper]');
  }
  // Check removed nodes
  if (m.removedNodes.length > 0) {
    return true; // Always process removals
  }
  return false;
}

// ── Core subtitle update handler ─────────────────────────────────────
// Dịch TỪNG segment riêng (fix lỗi nhân bản khi caption nhiều dòng),
// dedupe request theo text qua inflight map.
function handleSubtitleUpdate() {
  if (!isEnabled || subtitleMode === 'original-only') return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const allSegments = findCaptionSegments();

    if (allSegments.length === 0) {
      removeOverlay();
      removeBilingualWrappers();
      showOriginalCaptions();
      return;
    }

    // Dọn state của segment đã bị YouTube gỡ khỏi DOM
    for (const el of segmentStates.keys()) {
      if (!el.isConnected) segmentStates.delete(el);
    }

    // Ẩn caption gốc ngay (translated-only) trước khi bản dịch tới
    applyOriginalVisibility();

    const needTranslate = [];
    for (const seg of allSegments) {
      const text = seg.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const st = segmentStates.get(seg);
      if (!st || st.text !== text) {
        segmentStates.set(seg, { text, translated: null });
        needTranslate.push({ seg, text });
      }
    }

    // Bilingual: đảm bảo wrapper tồn tại + render lại bản dịch đã cache
    if (subtitleMode === 'bilingual') {
      wrapOriginalSegments();
      for (const seg of allSegments) {
        const st = segmentStates.get(seg);
        if (st && st.translated) {
          const transSpan = getWrapperTransSpan(seg);
          if (transSpan) {
            transSpan.textContent = st.translated;
            transSpan.style.display = 'block';
          }
        }
      }
    }

    // Gửi request cho text mới (dedupe: cùng text + đang inflight → chờ 1 request)
    for (const { seg, text } of needTranslate) {
      const gen = translationGeneration;
      requestTranslation(text, targetLang).then((res) => {
        if (gen !== translationGeneration) return; // settings đổi / SPA nav giữa chừng
        const st = segmentStates.get(seg);
        if (!st || st.text !== text || !seg.isConnected) return; // stale
        st.translated = (res && res.translatedText) ? res.translatedText : text;

        if (subtitleMode === 'translated-only') {
          refreshTranslatedOverlay();
        } else {
          const transSpan = getWrapperTransSpan(seg);
          if (transSpan) {
            transSpan.textContent = st.translated;
            transSpan.style.display = 'block';
          }
        }
      });
    }

    // translated-only: cập nhật overlay từ state (kể cả bản dịch đã cache)
    if (subtitleMode === 'translated-only') {
      refreshTranslatedOverlay();
    }
  }, 150);
}

// ── Gửi request dịch, dedupe + watchdog (A3) ──────────────────────────
function requestTranslation(text, targetLang) {
  const key = `${text}_${targetLang}`;
  if (inflight.has(key)) return inflight.get(key);

  const promise = new Promise((resolve) => {
    let responded = false;
    let attempts = 0;
    let watchdog = null;
    const done = (res) => {
      if (responded) return;
      responded = true;
      clearTimeout(watchdog);
      resolve(res);
    };
    const send = () => {
      attempts++;
      if (attempts > 2) { done(null); return; } // watchdog resend tối đa 1 lần
      chrome.runtime.sendMessage({ action: 'translate', text, targetLang }, (response) => {
        if (chrome.runtime.lastError) { done(null); return; }
        done(response);
      });
    };
    send();
    // SW có thể bị kill giữa chừng → callback không bao giờ chạy → resend 1 lần
    watchdog = setTimeout(send, 12000);
  });

  inflight.set(key, promise);
  promise.catch(() => {}).finally(() => inflight.delete(key));
  return promise;
}

// ── Lấy translated span của segment (tạo wrapper nếu cần) ─────────────
function getWrapperTransSpan(seg) {
  let wrapper = seg.closest('[data-bilingual-wrapper]');
  if (!wrapper) {
    wrapper = document.createElement('span');
    wrapper.dataset.bilingual = 'true';
    wrapper.dataset.bilingualWrapper = 'true';
    wrapper.style.display = 'inline';
    wrapper.style.whiteSpace = 'pre-wrap';
    seg.parentNode.insertBefore(wrapper, seg);
    wrapper.appendChild(seg);
  }
  let transSpan = wrapper.querySelector('.bilingual-translated');
  if (!transSpan) {
    transSpan = createTranslatedSpan();
    wrapper.appendChild(transSpan);
  }
  return transSpan;
}

// ── translated-only: gộp bản dịch từng segment vào overlay ────────────
function refreshTranslatedOverlay() {
  const parts = [];
  for (const seg of findCaptionSegments()) {
    const st = segmentStates.get(seg);
    if (st && st.translated) parts.push(st.translated);
  }
  if (parts.length > 0) {
    renderOverlay(parts.join(' '));
  } else {
    removeOverlay();
  }
}

// ── Find caption segments in both Light and Shadow DOM ───────────────
function findCaptionSegments() {
  const segments = queryAllInRoots(SEGMENT_SELECTOR);
  logDebug('Found segments:', segments.length, '(Light + Shadow)');
  return segments;
}

// ── Factory: tạo translated span dùng chung ──────────────────────────
function createTranslatedSpan() {
  const span = document.createElement('span');
  span.className = 'bilingual-translated';
  span.dataset.bilingual = 'true';
  return span;
}

// ── Wrap original segments in bilingual wrappers ─────────────────────
function wrapOriginalSegments() {
  // Get segments from both Light and Shadow DOM
  const allSegments = findCaptionSegments()
    .filter(el => !el.closest('[data-bilingual-wrapper]'));

  logDebug('wrapOriginalSegments called with:', allSegments.length, 'segments');

  allSegments.forEach((seg, index) => {
    // Get or create wrapper
    let wrapper = seg.closest('[data-bilingual-wrapper]');
    if (!wrapper) {
      wrapper = document.createElement('span');
      wrapper.dataset.bilingual = 'true';
      wrapper.dataset.bilingualWrapper = 'true';
      wrapper.style.display = 'inline';
      wrapper.style.whiteSpace = 'pre-wrap';
      seg.parentNode.insertBefore(wrapper, seg);
      wrapper.appendChild(seg);
      logDebug('Created wrapper for segment', index);
    }

    // Get or create translated span
    if (!wrapper.querySelector('.bilingual-translated')) {
      wrapper.appendChild(createTranslatedSpan());
      logDebug('Created translated span for segment', index);
    }
  });
}

// ── Overlay (our own div, outside YouTube's caption DOM) ─────────────
function getOrCreateOverlay() {
  let overlay = document.getElementById('yt-bilingual-sub');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'yt-bilingual-sub';
    overlay.dataset.bilingual = 'true';

    // Insert inside the YouTube player container so it scales with fullscreen
    const player = document.querySelector('.html5-video-player') ||
                   document.querySelector('#movie_player');
    if (player) {
      player.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
    logDebug('Overlay created');
  }
  return overlay;
}

function renderOverlay(translatedText) {
  const overlay = getOrCreateOverlay();

  // Copy font/size from a real YouTube caption segment for a native look
  const templateSeg = document.querySelector(`${SEGMENT_SELECTOR}:not([data-bilingual])`);
  if (templateSeg) {
    const cs = window.getComputedStyle(templateSeg);
    overlay.style.fontFamily    = cs.fontFamily;
    overlay.style.fontSize      = cs.fontSize;
    overlay.style.fontWeight    = cs.fontWeight;
    overlay.style.lineHeight    = cs.lineHeight;
    overlay.style.backgroundColor = cs.backgroundColor || 'rgba(8,8,8,0.75)';
    overlay.style.color         = (subtitleMode === 'translated-only') ? (cs.color || '#fff') : 'var(--yt-accent)';
  } else {
    overlay.style.fontFamily    = 'YouTube Noto, Roboto, Arial, sans-serif';
    overlay.style.fontSize      = '24px';
    overlay.style.fontWeight    = 'bold';
    overlay.style.backgroundColor = 'rgba(8,8,8,0.75)';
    overlay.style.color         = subtitleMode === 'translated-only' ? '#fff' : 'var(--yt-accent)';
  }

  overlay.textContent   = translatedText;
  overlay.style.display = 'block';
  
  logDebug('Overlay rendered:', translatedText);
}

function removeOverlay() {
  const overlay = document.getElementById('yt-bilingual-sub');
  if (overlay) overlay.remove();
}

// ── Remove bilingual wrappers ────────────────────────────────────────
function removeBilingualWrappers() {
  const wrappers = queryAllInRoots('[data-bilingual-wrapper]');

  wrappers.forEach(wrapper => {
    const seg = wrapper.querySelector(SEGMENT_SELECTOR);
    if (seg) {
      wrapper.parentNode.insertBefore(seg, wrapper);
    }
    wrapper.remove();
  });
}

// ── Original caption visibility ───────────────────────────────────────
function applyOriginalVisibility() {
  const hidden = subtitleMode === 'translated-only';
  queryAllInRoots('.captions-text:not([data-bilingual])').forEach(el => {
    el.style.visibility = hidden ? 'hidden' : '';
  });
}

function showOriginalCaptions() {
  queryAllInRoots('.captions-text:not([data-bilingual])').forEach(el => {
    el.style.visibility = '';
  });
}
