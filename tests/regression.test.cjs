const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    timers,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, delay) { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(key) { timers.delete(key); },
    async tick(ms) {
      const end = now + ms;
      await flush();
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = end;
      await flush();
    }
  };
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); }
  };
}
function element() {
  const classes = new Set();
  return Object.assign(events(), {
    style: { setProperty() {} }, dataset: {}, children: [],
    classList: {
      add(value) { classes.add(value); },
      toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value); },
      contains(value) { return classes.has(value); }
    },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    set innerHTML(value) { this.children = []; },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.className === selector.slice(1)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    scrollIntoView() {}
  });
}
function harness(file, options = {}) {
  const timer = clock(), messages = [], writes = [];
  const local = options.local || {};
  const video = Object.assign(element(), { currentTime: 0 });
  const document = Object.assign(events(), {
    readyState: 'complete', body: element(), documentElement: element(),
    createElement: element, getElementById: () => null,
    querySelector: selector => selector === 'video' ? video : null,
    querySelectorAll: () => []
  });
  const window = events();
  const hooks = {};
  let observerCount = 0;
  const context = vm.createContext({
    ...timer, document, window, URL, AbortController,
    location: { href: 'https://www.youtube.com/watch?v=one' },
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    performance: { getEntriesByType: () => options.resources || [] },
    PerformanceObserver: class { constructor() { observerCount++; } observe() {} },
    fetch: options.fetch || (async () => ({ ok: true, json: async () => [[['xin chao']], null, 'en'] })),
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { hooks.message = fn; } },
        sendMessage(request, cb) { messages.push({ request, cb }); }
      },
      commands: { onCommand: { addListener() {} } },
      storage: {
        onChanged: { addListener(fn) { hooks.storage = fn; } },
        sync: { get(keys, cb) { cb({ isEnabled: false }); }, set: async value => { writes.push(value); } },
        local: {
          get: async key => key === null ? { ...local } : { [key]: local[key] },
          set: async value => { Object.assign(local, value); },
          remove: async keys => { for (const key of keys) delete local[key]; }
        }
      }
    }
  });
  if (options.player) window.ytInitialPlayerResponse = options.player;
  const source = options.source || fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInContext(source, context, { filename: file });
  return { context, timer, messages, hooks, document, window, local, video,
    observerCount: () => observerCount,
    eval: code => vm.runInContext(code, context),
    api: window.__ybsTranscript
  };
}

test('background dedupes requests and retains source language through RAM and restart', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { ok: true, json: async () => [[['hello']], null, 'vi'] }; };
  const h = harness('background/background.js', { fetch });
  const translate = instance => new Promise(resolve => instance.hooks.message({ action: 'translate', text: 'xin chao', targetLang: 'en' }, null, resolve));
  const [a, b] = await Promise.all([translate(h), translate(h)]);
  assert.equal(a.detectedLang, 'vi');
  assert.equal(b.detectedLang, 'vi');
  assert.equal((await translate(h)).detectedLang, 'vi');
  const restarted = harness('background/background.js', { fetch, local: h.local });
  assert.equal((await translate(restarted)).detectedLang, 'vi');
  assert.equal(calls, 1);
});

test('legacy persistent cache remains readable', async () => {
  const h = harness('background/background.js', { local: { 'tc:hello_vi': { v: 'xin chao', ts: 1 } } });
  const result = await h.eval("doTranslate('hello', 'vi', 'hello_vi')");
  assert.equal(result.translatedText, 'xin chao');
  assert.equal(result.detectedLang, null);
});

test('closed response channel does not block another subscriber', async () => {
  const h = harness('background/background.js');
  h.hooks.message({ action: 'translate', text: 'hi', targetLang: 'vi' }, null, () => { throw new Error('closed'); });
  const result = await new Promise(resolve => h.hooks.message({ action: 'translate', text: 'hi', targetLang: 'vi' }, null, resolve));
  assert.equal(result.translatedText, 'xin chao');
  assert.equal(result.isFallback, undefined);
});

test('25 concurrent network calls obey sliding-window rate limit', async () => {
  const times = [];
  let h;
  h = harness('background/background.js', { fetch: async () => {
    times.push(h.timer.Date.now());
    return { ok: true, json: async () => [[['ok']], null, 'en'] };
  } });
  const pending = h.eval("Promise.all(Array.from({length: 25}, (_, i) => translateText(String(i), 'vi')))");
  await h.timer.tick(3300);
  await pending;
  assert.equal(times.length, 25);
  for (const time of times) assert.ok(times.filter(t => t >= time && t < time + 1000).length <= 10);
});

test('retries consume rate-limit slots and fallback is never cached', async () => {
  let calls = 0;
  const h = harness('background/background.js', { fetch: async () => { calls++; throw new Error('offline'); } });
  const pending = h.eval("translateWithFallback('hi', 'vi')");
  await h.timer.tick(8000);
  assert.equal((await pending).isFallback, true);
  assert.equal(calls, 4);
  assert.equal(h.eval('rateLimiter.requests.length'), 1);
  assert.equal(Object.keys(h.local).length, 0);
  assert.equal(h.eval('translationCache.cache.size'), 0);
});

test('content watchdog resolves after two unanswered messages', async () => {
  const h = harness('content/content.js');
  const pending = h.eval("requestTranslation('hello', 'vi')");
  await h.timer.tick(24000);
  assert.equal(await pending, null);
  assert.equal(h.messages.length, 2);
  assert.equal(h.timer.timers.size, 0);
});

test('old content request cannot remove a newer inflight entry', async () => {
  const h = harness('content/content.js');
  h.eval("requestTranslation('hello', 'vi'); resetTranslationState(); requestTranslation('hello', 'vi')");
  h.messages[0].cb({ translatedText: 'old' });
  await flush();
  assert.equal(h.eval('inflight.size'), 1);
  h.messages[1].cb({ translatedText: 'new' });
  await flush();
  assert.equal(h.eval('inflight.size'), 0);
});

test('turning off captions cancels pending debounce and player polling', () => {
  const h = harness('content/content.js');
  h.eval('isEnabled = true; handleSubtitleUpdate(); waitForPlayerAndObserve(); waitForPlayerAndObserve();');
  assert.equal(h.timer.timers.size, 2);
  h.eval('isEnabled = false; applyMode();');
  assert.equal(h.timer.timers.size, 0);
  assert.equal(h.eval('pollAttempts'), 0);
});

test('capture accepts translation updates for the same caption', () => {
  const h = harness('content/transcript.js');
  h.api.state.sourceMode = 'capture';
  h.api.onCaption({ detail: { t: 1, text: 'hello', translated: null } });
  h.api.onCaption({ detail: { t: 1, text: 'hello', translated: 'xin chao' } });
  assert.equal(h.api.state.segments.length, 1);
  assert.equal(h.api.state.segments[0].translated, 'xin chao');
});

test('transcript watchdog ends queue after second unanswered attempt', async () => {
  const h = harness('content/transcript.js');
  h.api.state.segments = [{ t: 1, text: 'hi' }];
  h.api.translateAll();
  await h.timer.tick(24000);
  assert.equal(h.messages.length, 2);
  assert.equal(h.api.state.translating, false);
});

test('language switch invalidates old queue without cancelling the new one', async () => {
  const h = harness('content/transcript.js');
  const seg = { t: 1, text: 'hello', translated: null };
  h.api.state.segments = [seg];
  h.api.renderList();
  h.api.translateAll();
  h.hooks.storage({ targetLang: { newValue: 'ja' } }, 'sync');
  h.api.translateAll();
  h.messages[0].cb({ translatedText: 'xin chao' });
  await flush();
  assert.equal(seg.translated, null);
  assert.equal(h.api.state.translating, true);
  assert.equal(h.messages[1].request.targetLang, 'ja');
  h.messages[1].cb({ translatedText: 'konnichiwa' });
  await flush();
  assert.equal(seg.translated, 'konnichiwa');
  assert.equal(h.api.state.translating, false);
});

test('navigation rejects stale transcript fetch and reuses resource observer', async () => {
  const requests = [];
  const h = harness('content/transcript.js', { fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) });
  h.api.setPanelOpen(true);
  h.api.setPanelOpen(false);
  h.api.setPanelOpen(true);
  assert.equal(h.observerCount(), 1);
  h.api.handleResourceEntry({ name: 'https://www.youtube.com/api/timedtext?v=one&fmt=json3' });
  h.context.location.href = 'https://www.youtube.com/watch?v=two';
  h.document.dispatchEvent({ type: 'yt-navigate-finish' });
  assert.equal(requests[0].options.signal.aborted, true);
  h.api.handleResourceEntry({ name: 'https://www.youtube.com/api/timedtext?v=one&fmt=json3' });
  h.api.handleResourceEntry({ name: 'https://www.youtube.com/api/timedtext?v=two&fmt=json3' });
  assert.equal(requests.length, 2);
  const response = text => ({ ok: true, text: async () => JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: text }] }] }) });
  requests[0].resolve(response('old'));
  await flush();
  assert.equal(h.api.state.segments.length, 0);
  requests[1].resolve(response('new'));
  await flush();
  assert.equal(h.api.state.segments[0].text, 'new');
});

test('render highlights only current row', () => {
  const h = harness('content/transcript.js');
  h.api.state.segments = [{ t: 1, text: 'a' }, { t: 2, text: 'b' }];
  h.api.state.activeT = 2;
  h.api.renderList();
  assert.equal([...h.api.state.rowMap.values()].filter(row => row.classList.contains('active')).length, 1);
});

test('MAIN bridge extracts nested tracks and never replays previous video', async () => {
  const player = { videoDetails: { videoId: 'one', title: 'First' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en', baseUrl: 'track' }] } } };
  const h = harness('content/yt-player-data.js', { player });
  const payloads = [];
  h.window.addEventListener('ybs-player-data', e => payloads.push(e.detail));
  h.window.dispatchEvent({ type: 'ybs-player-data-request' });
  assert.equal(payloads[0].tracks[0].langCode, 'en');
  assert.equal(h.timer.timers.size, 0);
  h.context.location.href = 'https://www.youtube.com/watch?v=two';
  h.window.dispatchEvent({ type: 'ybs-player-data-request' });
  assert.equal(payloads.length, 1);
  h.document.dispatchEvent({ type: 'yt-navigate-finish' });
  h.document.dispatchEvent({ type: 'yt-navigate-finish' });
  assert.equal(h.timer.timers.size, 1);
  h.window.ytInitialPlayerResponse = { videoDetails: { videoId: 'two', title: 'Second' } };
  await h.timer.tick(500);
  assert.equal(payloads.at(-1).title, 'Second');
});

test('synchronous messaging failure resolves safely and clears timers', async () => {
  const h = harness('content/content.js');
  h.context.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
  assert.equal(await h.eval("requestTranslation('hi', 'vi')"), null);
  assert.equal(h.timer.timers.size, 0);
});

test('hung timedtext fetch aborts after eight seconds', async () => {
  const h = harness('content/transcript.js', {
    fetch: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    })
  });
  const pending = h.api.fetchTranscript('https://www.youtube.com/api/timedtext?v=one&fmt=json3');
  await h.timer.tick(8000);
  assert.equal(await pending, null);
  assert.equal(h.timer.timers.size, 0);
});

test('old queue completion cannot end a new video translation queue', async () => {
  const h = harness('content/transcript.js');
  h.api.state.segments = [{ t: 0, text: 'old' }];
  h.api.translateAll();
  h.document.dispatchEvent({ type: 'yt-navigate-finish' });
  const fresh = { t: 0, text: 'new' };
  h.api.state.segments = [fresh];
  h.api.renderList();
  h.api.translateAll();
  h.messages[0].cb({ translatedText: 'stale' });
  await flush();
  assert.equal(h.api.state.translating, true);
  assert.equal(fresh.translated, undefined);
  h.messages[1].cb({ translatedText: 'fresh' });
  await flush();
  assert.equal(fresh.translated, 'fresh');
});
