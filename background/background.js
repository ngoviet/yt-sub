// ================================================
// LRU Cache - Giới hạn bộ nhớ
// ================================================
class LRUCache {
  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;
    // Move to end (most recently used)
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, value);
  }
}

// ================================================
// Rate Limiter - Giới hạn request
// ================================================
class RateLimiter {
  constructor(maxRequests = 10, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  isAllowed() {
    const now = Date.now();
    // Remove requests outside the window
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    
    if (this.requests.length < this.maxRequests) {
      this.requests.push(now);
      return true;
    }
    return false;
  }

  getWaitTime() {
    const now = Date.now();
    this.requests = this.requests.filter(t => now - t < this.windowMs);
    if (this.requests.length === 0) return 0;
    return this.windowMs - (now - this.requests[0]) + 100;
  }
}

// ================================================
// Cấu hình
// ================================================
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,  // ms
  maxDelay: 5000,
  exponentialBase: 2
};

const RATE_LIMIT_CONFIG = {
  maxRequests: 10,
  windowMs: 1000
};

// ================================================
// Khởi tạo
// ================================================
const translationCache = new LRUCache(1000);
const rateLimiter = new RateLimiter(
  RATE_LIMIT_CONFIG.maxRequests,
  RATE_LIMIT_CONFIG.windowMs
);

// ================================================
// Persistent translation cache (chrome.storage.local)
// SW bị kill ~30s idle → cache RAM mất sạch. Storage.local giữ lại.
// KHÔNG dùng sync (quota 8KB/item) — cache dịch bắt buộc local (10MB).
// ================================================
const PERSISTENT_CACHE_MAX = 2000;
const TC_PREFIX = 'tc:';

function tcKey(cacheKey) {
  return TC_PREFIX + cacheKey;
}

// Prune khi SW khởi động: giữ max 2000 key mới nhất theo ts
function prunePersistentCache() {
  chrome.storage.local.get(null).then((all) => {
    const entries = Object.entries(all)
      .filter(([k]) => k.startsWith(TC_PREFIX))
      .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    if (entries.length <= PERSISTENT_CACHE_MAX) return;
    const remove = entries.slice(PERSISTENT_CACHE_MAX).map(([k]) => k);
    return chrome.storage.local.remove(remove);
  }).catch(() => { /* best-effort */ });
}
prunePersistentCache();

function storePersistent(cacheKey, translatedText) {
  chrome.storage.local.set({
    [tcKey(cacheKey)]: { v: translatedText, ts: Date.now() }
  }).catch(() => { /* best-effort */ });
}

async function getPersistent(cacheKey) {
  const entry = await chrome.storage.local.get(tcKey(cacheKey));
  const val = entry[tcKey(cacheKey)];
  return val ? val.v : null;
}

// ================================================
// Message Listener
// ================================================
chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
  if (request.action === 'translate') {
    const { text, targetLang } = request;
    if (!text || typeof text !== 'string') {
      sendResponse({ translatedText: '' });
      return true;
    }
    handleTranslate(text, targetLang, `${text}_${targetLang}`, sendResponse);
    return true; // Keep the message channel open for async response
  }
});

async function handleTranslate(text, targetLang, cacheKey, sendResponse) {
  // 1. RAM cache
  const cached = translationCache.get(cacheKey);
  if (cached !== null) {
    sendResponse({ translatedText: cached });
    return;
  }

  // 2. Persistent cache (storage.local) — set ngược RAM
  try {
    const persisted = await getPersistent(cacheKey);
    if (persisted) {
      translationCache.set(cacheKey, persisted);
      sendResponse({ translatedText: persisted });
      return;
    }
  } catch (error) {
    // storage lỗi → cứ translate tiếp
  }

  // 3. Rate limit
  if (!rateLimiter.isAllowed()) {
    const waitTime = rateLimiter.getWaitTime();
    setTimeout(() => {
      translateWithFallback(text, targetLang, cacheKey, sendResponse);
    }, waitTime);
    return;
  }

  // 4. Translate with retry and fallback
  translateWithFallback(text, targetLang, cacheKey, sendResponse);
}

// ================================================
// Keyboard shortcuts (chrome.commands)
// ================================================
const MODE_CYCLE = ['bilingual', 'translated-only', 'original-only'];

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-subtitles') {
    const { isEnabled } = await chrome.storage.sync.get('isEnabled');
    const next = !(isEnabled !== undefined ? isEnabled : true);
    await chrome.storage.sync.set({ isEnabled: next });
    console.log(`Translation ${next ? 'enabled' : 'disabled'} (Alt+T)`);
  } else if (command === 'cycle-mode') {
    const { subtitleMode } = await chrome.storage.sync.get('subtitleMode');
    const cur = subtitleMode || 'bilingual';
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(cur) + 1) % MODE_CYCLE.length];
    await chrome.storage.sync.set({ subtitleMode: next });
    console.log(`Display mode: ${next} (Alt+Shift+T)`);
  }
});

// ================================================
// Translate with Retry & Fallback
// ================================================
async function translateWithFallback(text, targetLang, cacheKey, sendResponse) {
  try {
    const result = await translateWithRetry(text, targetLang);

    // Cache result (RAM + persistent)
    if (cacheKey) {
      translationCache.set(cacheKey, result.translatedText);
      storePersistent(cacheKey, result.translatedText);
    }

    sendResponse({ translatedText: result.translatedText, detectedLang: result.detectedLang });
  } catch (error) {
    console.error('Translation failed:', error);

    // Graceful degradation: return original text with indicator
    // KHÔNG cache fallback — lỗi tạm thời (mạng/429) không nên dính cache vĩnh viễn
    const fallbackText = `[${targetLang}] ${text}`;

    sendResponse({
      translatedText: fallbackText,
      isFallback: true
    });
  }
}

async function translateWithRetry(text, targetLang, retryCount = 0) {
  try {
    return await translateText(text, targetLang);
  } catch (error) {
    if (retryCount < RETRY_CONFIG.maxRetries) {
      const delay = Math.min(
        RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.exponentialBase, retryCount),
        RETRY_CONFIG.maxDelay
      );
      console.warn(`Retry ${retryCount + 1}/${RETRY_CONFIG.maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return translateWithRetry(text, targetLang, retryCount + 1);
    }
    throw new Error(`Translation failed after ${RETRY_CONFIG.maxRetries} retries: ${error.message}`);
  }
}

// ================================================
// Google Translate API
// ================================================
async function translateText(text, targetLang) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  // Timeout 8s — request treo thì retry không bao giờ chạy, kênh message treo vô hạn
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    // Google Translate API returns an array of arrays. The translated text is in the first element.
    // data[2] = detected source language (sl=auto)
    return {
      translatedText: data[0].map(item => item[0]).join(''),
      detectedLang: typeof data[2] === 'string' ? data[2] : null
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Translation request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
