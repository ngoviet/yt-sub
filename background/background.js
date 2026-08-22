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
// Message Listener
// ================================================
chrome.runtime.onMessage.addListener((request, _, sendResponse) => {
  if (request.action === 'translate') {
    const { text, targetLang } = request;
    const cacheKey = `${text}_${targetLang}`;

    // Check cache first
    const cached = translationCache.get(cacheKey);
    if (cached !== null) {
      sendResponse({ translatedText: cached });
      return true;
    }

    // Check rate limit
    if (!rateLimiter.isAllowed()) {
      const waitTime = rateLimiter.getWaitTime();
      setTimeout(() => {
        translateWithFallback(text, targetLang, cacheKey, sendResponse);
      }, waitTime);
      return true;
    }

    // Translate with retry and fallback
    translateWithFallback(text, targetLang, cacheKey, sendResponse);

    return true; // Keep the message channel open for async response
  }
});

// ================================================
// Translate with Retry & Fallback
// ================================================
async function translateWithFallback(text, targetLang, cacheKey, sendResponse) {
  try {
    const translatedText = await translateWithRetry(text, targetLang);
    
    // Cache result
    if (cacheKey) {
      translationCache.set(cacheKey, translatedText);
    }
    
    sendResponse({ translatedText });
  } catch (error) {
    console.error('Translation failed:', error);
    
    // Graceful degradation: return original text with indicator
    const fallbackText = `[${targetLang}] ${text}`;
    
    if (cacheKey) {
      translationCache.set(cacheKey, fallbackText);
    }
    
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

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  // Google Translate API returns an array of arrays. The translated text is in the first element.
  return data[0].map(item => item[0]).join('');
}
