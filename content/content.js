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

// ── Overlay customization (B6) ────────────────────────────────────────
let fontSizeScale = 1;
let overlayBottom = 55;
let accentColor   = '#FFD54F';

// ── State dịch theo từng segment ───────────────────────────────────────
const segmentStates = new Map(); // element → { text, translated, lang }
const inflight      = new Map(); // key 'text_targetLang' → Promise

// ── Selectors (gom 1 chỗ — YouTube có thể đổi class) ─────────────────
const CAPTION_AREA_SELECTOR = '.ytp-caption-window-container';
const SEGMENT_SELECTOR      = '.ytp-caption-segment';
const SETTINGS_KEYS         = ['targetLang', 'isEnabled', 'subtitleMode', 'debugMode', 'fontSizeScale', 'overlayBottom', 'accentColor'];

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

// ── Thời điểm caption xuất hiện (cho transcript panel link seek) ──────
function currentVideoTime() {
  const video = document.querySelector('video');
  return video ? video.currentTime : 0;
}

// ── Dispatch cho transcript panel (watch pages; không listener = no-op) ─
function dispatchCaptionEvent(text, translated, lang, t) {
  document.dispatchEvent(new CustomEvent('ybs-caption', { detail: { text, translated, lang, t } }));
}

// ── Initialize from storage ──────────────────────────────────────────
chrome.storage.sync.get(['targetLang', 'isEnabled', 'subtitleMode', 'debugMode', 'fontSizeScale', 'overlayBottom', 'accentColor'], (data) => {
  if (data.targetLang)   targetLang   = data.targetLang;
  if (data.subtitleMode) subtitleMode = data.subtitleMode;
  if (data.isEnabled !== undefined) isEnabled = data.isEnabled;
  if (data.debugMode) debugMode = data.debugMode;
  if (data.fontSizeScale) fontSizeScale = data.fontSizeScale;
  if (data.overlayBottom) overlayBottom = data.overlayBottom;
  if (data.accentColor)   accentColor   = data.accentColor;
  applyAccentColor();
  applyMode();
  logDebug('Extension initialized with settings:', { targetLang, subtitleMode, isEnabled, debugMode });
});

// ── Messages from popup ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'updateSettings') {
    targetLang   = request.targetLang;
    subtitleMode = request.subtitleMode;
    isEnabled    = request.isEnabled;
    debugMode    = request.debugMode ?? debugMode;
    if (request.fontSizeScale) fontSizeScale = request.fontSizeScale;
    if (request.overlayBottom) overlayBottom = request.overlayBottom;
    if (request.accentColor)   accentColor   = request.accentColor;
    applyAccentColor();
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
    if (key === 'fontSizeScale' && change.newValue !== fontSizeScale) { fontSizeScale = change.newValue; changed = true; }
    if (key === 'overlayBottom' && change.newValue !== overlayBottom) { overlayBottom = change.newValue; changed = true; }
    if (key === 'accentColor'  && change.newValue !== accentColor)  { accentColor  = change.newValue; changed = true; }
  }
  if (changed) {
    applyAccentColor();
    resetTranslationState();
    applyMode();
  }
});

// ── Ghi màu nhấn vào CSS var --yt-accent (ảnh cả overlay lẫn bilingual) ─
function applyAccentColor() {
  document.documentElement.style.setProperty('--yt-accent', accentColor);
}

// ── Reset mọi trạng thái dịch (settings đổi / SPA nav) ────────────────
function resetTranslationState() {
  clearTimeout(debounceTimer);
  segmentStates.clear();
  inflight.clear();
  translationGeneration++;
  removeOverlay();
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
  // Font size / settings vừa đổi → caption đang hiện không trigger mutation
  // (text không đổi) → overlay giữ font cũ. Xử lý lại ngay để re-render.
  if (subtitleMode !== 'original-only') handleSubtitleUpdate();
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
  clearTimeout(pollTimer);
  pollTimer = null;
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
  clearTimeout(debounceTimer);
  clearTimeout(pollTimer);
  pollTimer = null;
  pollAttempts = 0;
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
// Phân biệt node CỦA EXTENSION (có data-bilingual trên CHÍNH node đó —
// overlay + span cũ từ phiên trước) vs node của YouTube (segment sạch).
function isRealCaptionMutation(m) {
  // YouTube đổi text in-place qua text node; text node của span là của extension
  if (m.type === 'characterData') {
    return !(m.target.parentElement?.dataset?.bilingual);
  }

  const nodes = [...m.addedNodes, ...m.removedNodes];
  if (nodes.length === 0) return false;

  const targetIsExt = m.target.nodeType === Node.ELEMENT_NODE && m.target.dataset?.bilingual;

  for (const n of nodes) {
    if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.TEXT_NODE) continue;
    // Overlay do extension tạo (có data-bilingual trên CHÍNH node) → bỏ qua
    if (n.nodeType === Node.ELEMENT_NODE && n.dataset?.bilingual) continue;
    // Element sạch (segment mới của YouTube) → thật
    if (n.nodeType === Node.ELEMENT_NODE) return true;
    // Text node: sau khi detach không lấy được parentElement → dựa vào target record
    const owner = n.parentElement || (targetIsExt ? m.target : null);
    if (owner?.dataset?.bilingual) continue; // text của transSpan → do extension
    return true; // text mới của YouTube
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
    if (!isEnabled || subtitleMode === 'original-only') return;
    const allSegments = findCaptionSegments();

    if (allSegments.length === 0) {
      // Caption swap tạm thời rỗng → KHÔNG đụng caption DOM (bỏ wrapper
      // gây blink khi segment mới tới). Overlay ẩn, caption gốc hiện lại.
      removeOverlay();
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
        const t = currentVideoTime();
        segmentStates.set(seg, { text, translated: null, t });
        needTranslate.push({ seg, text });
        dispatchCaptionEvent(text, null, null, t);
      }
    }

    // Bilingual: render overlay 2 dòng từ state (kể cả bản dịch đã cache)
    if (subtitleMode === 'bilingual') {
      refreshBilingualOverlay();
    }

    // Gửi request cho text mới (dedupe: cùng text + đang inflight → chờ 1 request)
    for (const { seg, text } of needTranslate) {
      const gen = translationGeneration;
      requestTranslation(text, targetLang).then((res) => {
        if (gen !== translationGeneration) return; // settings đổi / SPA nav giữa chừng
        const st = segmentStates.get(seg);
        if (!st || st.text !== text || !seg.isConnected) return; // stale
        st.translated = (res && res.translatedText) ? res.translatedText : text;
        st.lang = (res && res.detectedLang) ? res.detectedLang : null;
        dispatchCaptionEvent(st.text, res && res.translatedText && !res.isFallback ? res.translatedText : null, st.lang, st.t);

        if (subtitleMode === 'translated-only') {
          refreshTranslatedOverlay();
        } else {
          refreshBilingualOverlay();
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
      if (responded) return;
      attempts++;
      if (attempts > 2) { done(null); return; } // watchdog resend tối đa 1 lần
      watchdog = setTimeout(send, 12000);
      try {
        chrome.runtime.sendMessage({ action: 'translate', text, targetLang }, (response) => {
          if (chrome.runtime.lastError) { done(null); return; }
          done(response);
        });
      } catch (error) { done(null); }
    };
    send();
    // SW có thể bị kill giữa chừng → callback không bao giờ chạy → resend 1 lần
  });

  inflight.set(key, promise);
  promise.finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  return promise;
}

// ── translated-only: gộp bản dịch từng segment vào overlay ────────────
function refreshTranslatedOverlay() {
  const parts = [];
  let detectedLang = null;
  for (const seg of findCaptionSegments()) {
    const st = segmentStates.get(seg);
    if (st && st.translated) {
      parts.push(st.translated);
      if (!detectedLang && st.lang) detectedLang = st.lang;
    }
  }
  if (parts.length > 0) {
    // B7: prefix ngôn ngữ nguồn phát hiện được (vd "[EN] ...")
    const prefix = (detectedLang && detectedLang !== targetLang)
      ? `[${detectedLang.toUpperCase()}] `
      : '';
    renderOverlay(null, prefix + parts.join(' '));
  } else {
    removeOverlay();
  }
}

// ── bilingual: gộp segment → overlay 2 dòng (gốc trắng / dịch accent) ──
function refreshBilingualOverlay() {
  const origParts = [];
  const transParts = [];
  for (const seg of findCaptionSegments()) {
    const st = segmentStates.get(seg);
    if (!st) continue;
    origParts.push(st.text);
    if (st.translated) transParts.push(st.translated);
  }
  if (origParts.length > 0) {
    renderOverlay(origParts.join(' '), transParts.join(' ') || null);
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

// ── Render overlay 1-2 dòng (bilingual: gốc + dịch; translated-only: dịch) ──
// Overlay nằm ngoài caption DOM YouTube (left:50% tự căn giữa) — chèn span
// vào caption window làm width đổi → YouTube JS reposition → text nhảy + lệch.
function renderOverlay(originalText, translatedText) {
  const overlay = getOrCreateOverlay();

  // Vị trí đáy user tùy chỉnh (CSS dùng var --yt-bottom)
  overlay.style.setProperty('--yt-bottom', `${overlayBottom}px`);

  // Copy font/size từ segment thật, nhân fontSizeScale user chọn
  const templateSeg = document.querySelector(`${SEGMENT_SELECTOR}:not([data-bilingual])`);
  if (templateSeg) {
    const cs = window.getComputedStyle(templateSeg);
    overlay.style.fontFamily    = cs.fontFamily;
    overlay.style.fontSize      = `${parseFloat(cs.fontSize) * fontSizeScale}px`;
    overlay.style.fontWeight    = cs.fontWeight;
    overlay.style.lineHeight    = cs.lineHeight;
    overlay.style.backgroundColor = cs.backgroundColor || 'rgba(8,8,8,0.75)';
  } else {
    overlay.style.fontFamily    = 'YouTube Noto, Roboto, Arial, sans-serif';
    overlay.style.fontSize      = `${24 * fontSizeScale}px`;
    overlay.style.fontWeight    = 'bold';
    overlay.style.backgroundColor = 'rgba(8,8,8,0.75)';
  }

  overlay.innerHTML = '';
  if (originalText) {
    const origLine = document.createElement('div');
    origLine.className = 'ybs-line-orig';
    origLine.textContent = originalText;
    overlay.appendChild(origLine);
  }
  if (translatedText) {
    const transLine = document.createElement('div');
    transLine.className = 'ybs-line-trans';
    transLine.textContent = translatedText;
    // translated-only: màu theo YouTube caption (trắng) — bilingual: accent (CSS class)
    if (!originalText && templateSeg) {
      const cs = window.getComputedStyle(templateSeg);
      transLine.style.color = cs.color || '#fff';
    }
    overlay.appendChild(transLine);
  }
  overlay.style.display = 'block';

  logDebug('Overlay rendered:', overlay.textContent);
}

function removeOverlay() {
  const overlay = document.getElementById('yt-bilingual-sub');
  if (overlay) overlay.remove();
}

// ── Original caption visibility ───────────────────────────────────────
function applyOriginalVisibility() {
  // Cả translated-only lẫn bilingual đều hiển thị qua overlay → ẩn gốc
  const hidden = subtitleMode !== 'original-only';
  queryAllInRoots('.captions-text:not([data-bilingual])').forEach(el => {
    el.style.visibility = hidden ? 'hidden' : '';
  });
}

function showOriginalCaptions() {
  queryAllInRoots('.captions-text:not([data-bilingual])').forEach(el => {
    el.style.visibility = '';
  });
}
