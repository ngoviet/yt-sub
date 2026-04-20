let targetLang        = 'vi';
let isEnabled         = true;
let subtitleMode      = 'bilingual'; // 'bilingual' | 'translated-only' | 'original-only'
let subtitleObserver  = null;
let isInjecting       = false;
let lastOriginalText  = '';
let debounceTimer     = null;
let translationGeneration = 0;
let debugMode         = false;
let isLoading         = false;
let loadingTimeout    = null;
let lastTranslationTime = 0;
let pendingTranslation = false;

// ── Debug Logger ──────────────────────────────────────────────────────
function logDebug(...args) {
  if (debugMode) {
    console.log('[YouTube Bilingual Subtitles]', ...args);
  }
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
    lastOriginalText = '';
    translationGeneration++;
    applyMode();
    logDebug('Settings updated:', { targetLang, subtitleMode, isEnabled, debugMode });
  }
  
  // Handle error messages from background
  if (request.action === 'showError') {
    renderError(request.message);
  }
});

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
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastOriginalText = '';
    translationGeneration++;
    removeOverlay();
    showOriginalCaptions();
    stopObserving();
    if (isEnabled && subtitleMode !== 'original-only') {
      waitForPlayerAndObserve();
    }
    logDebug('URL changed to:', location.href);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

// ── Check if we're on a valid YouTube video page ─────────────────────
function isYouTubeVideoPage() {
  return location.href.includes('youtube.com') && 
         (location.href.includes('v=') || 
          location.href.includes('/shorts/') ||
          document.querySelector('.html5-video-player'));
}

// ── Observer setup ───────────────────────────────────────────────────
function waitForPlayerAndObserve() {
  if (subtitleObserver) return;

  const captionArea = document.querySelector('.ytp-caption-window-container');
  if (!captionArea) {
    setTimeout(waitForPlayerAndObserve, 1000);
    return;
  }

  subtitleObserver = new MutationObserver((mutations) => {
    if (isInjecting) return;
    const hasRealChange = mutations.some(m => {
      if (m.target.closest && m.target.closest('[data-bilingual]')) return false;
      if (m.addedNodes.length > 0) {
        return [...m.addedNodes].some(n =>
          n.nodeType === Node.ELEMENT_NODE &&
          !n.dataset?.bilingual &&
          !(n.closest && n.closest('[data-bilingual]'))
        );
      }
      return m.type === 'characterData';
    });
    if (hasRealChange) handleSubtitleUpdate();
  });

  subtitleObserver.observe(captionArea, {
    childList: true, subtree: true, characterData: true
  });
  
  logDebug('Subtitle observer started');
}

function stopObserving() {
  if (subtitleObserver) {
    subtitleObserver.disconnect();
    subtitleObserver = null;
  }
  logDebug('Subtitle observer stopped');
}

// ── Core subtitle update handler ─────────────────────────────────────
function handleSubtitleUpdate() {
  if (!isEnabled || subtitleMode === 'original-only') return;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    // Collect text from YouTube's original segments only
    const allSegments = [...document.querySelectorAll('.ytp-caption-segment')]
      .filter(el => !el.closest('[data-bilingual]'));

    if (allSegments.length === 0) {
      removeOverlay();
      showOriginalCaptions();
      return;
    }

    const originalText = allSegments
      .map(s => s.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!originalText || originalText === lastOriginalText) return;
    lastOriginalText = originalText;

    logDebug('New subtitle detected:', originalText);

    // Apply original visibility immediately (before translation arrives)
    applyOriginalVisibility();

    // In bilingual mode: update original segments with bilingual content immediately
    if (subtitleMode === 'bilingual') {
      updateBilingualSegments(originalText, null);
    }

    pendingTranslation = true;

    const gen = ++translationGeneration;
    chrome.runtime.sendMessage(
      { action: 'translate', text: originalText, targetLang },
      (response) => {
        if (chrome.runtime.lastError) {
          logDebug('Runtime error:', chrome.runtime.lastError.message);
          pendingTranslation = false;
          return;
        }
        if (gen !== translationGeneration) return;
        
        lastTranslationTime = Date.now();
        pendingTranslation = false;
        
        if (response && response.translatedText) {
          if (response.isFallback) {
            logDebug('Using fallback translation');
          }
          if (subtitleMode === 'bilingual') {
            updateBilingualSegments(originalText, response.translatedText);
          } else {
            renderOverlay(response.translatedText);
          }
        } else {
          logDebug('No translation response');
        }
      }
    );
  }, 150);
}

// ── Update bilingual segments inline ─────────────────────────────────
function updateBilingualSegments(originalText, translatedText) {
  const allSegments = [...document.querySelectorAll('.ytp-caption-segment')]
    .filter(el => !el.closest('[data-bilingual]'));

  allSegments.forEach(seg => {
    if (seg.closest('[data-bilingual-wrapper]')) return;
    
    // Create a wrapper to hold both original and translated
    let wrapper = seg.closest('[data-bilingual-wrapper]');
    if (!wrapper) {
      wrapper = document.createElement('span');
      wrapper.dataset.bilingual = 'true';
      wrapper.dataset.bilingualWrapper = 'true';
      seg.parentNode.insertBefore(wrapper, seg);
      wrapper.appendChild(seg);
    }
    
    // Remove any existing translated span
    const existingTrans = wrapper.querySelector('.bilingual-translated');
    if (existingTrans) existingTrans.remove();
    
    if (translatedText) {
      // Create translated text span
      const transSpan = document.createElement('span');
      transSpan.className = 'bilingual-translated';
      transSpan.dataset.bilingual = 'true';
      transSpan.textContent = translatedText;
      wrapper.appendChild(transSpan);
    }
  });
}

function hideLoadingState() {
  isLoading = false;
  clearTimeout(loadingTimeout);
  const overlay = getOrCreateOverlay();
  overlay.classList.remove('loading');
}

// ── Error Display ────────────────────────────────────────────────────
function renderError(message) {
  const overlay = getOrCreateOverlay();
  overlay.textContent = message;
  overlay.style.color = '#FF5252';
  overlay.style.display = 'block';
  overlay.classList.remove('loading');
  isLoading = false;
  clearTimeout(loadingTimeout);
  logDebug('Error displayed:', message);
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
  const templateSeg = document.querySelector('.ytp-caption-segment:not([data-bilingual])');
  if (templateSeg) {
    const cs = window.getComputedStyle(templateSeg);
    overlay.style.fontFamily    = cs.fontFamily;
    overlay.style.fontSize      = cs.fontSize;
    overlay.style.fontWeight    = cs.fontWeight;
    overlay.style.lineHeight    = cs.lineHeight;
    overlay.style.backgroundColor = cs.backgroundColor || 'rgba(8,8,8,0.75)';
    overlay.style.color         = (subtitleMode === 'translated-only') ? (cs.color || '#fff') : '#FFD54F';
  } else {
    overlay.style.fontFamily    = 'YouTube Noto, Roboto, Arial, sans-serif';
    overlay.style.fontSize      = '24px';
    overlay.style.fontWeight    = 'bold';
    overlay.style.backgroundColor = 'rgba(8,8,8,0.75)';
    overlay.style.color         = subtitleMode === 'translated-only' ? '#fff' : '#FFD54F';
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
  const wrappers = document.querySelectorAll('[data-bilingual-wrapper]');
  wrappers.forEach(wrapper => {
    const seg = wrapper.querySelector('.ytp-caption-segment');
    if (seg) {
      wrapper.parentNode.insertBefore(seg, wrapper);
    }
    wrapper.remove();
  });
}

// ── Original caption visibility ───────────────────────────────────────
function applyOriginalVisibility() {
  const hidden = subtitleMode === 'translated-only';
  document.querySelectorAll('.captions-text:not([data-bilingual])').forEach(el => {
    el.style.visibility = hidden ? 'hidden' : '';
  });
}

function showOriginalCaptions() {
  document.querySelectorAll('.captions-text:not([data-bilingual])').forEach(el => {
    el.style.visibility = '';
  });
}

// ── YouTube SPA navigation ───────────────────────────────────────────
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastOriginalText = '';
    translationGeneration++;
    removeOverlay();
    removeBilingualWrappers();
    showOriginalCaptions();
    stopObserving();
    if (isEnabled && subtitleMode !== 'original-only') {
      waitForPlayerAndObserve();
    }
    logDebug('URL changed to:', location.href);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });
