// ================================================================
// YouTube Bilingual Subtitles — Transcript Panel (drawer phải)
// Watch pages only (manifest match).
// Nguồn dữ liệu: intercept timedtext URL (có pot) → JSON3;
// fallback capture mode: ybs-caption events từ content.js.
// ================================================================
(() => {
  const PANEL_ID   = 'ybs-transcript-panel';
  const TOGGLE_ID  = 'ybs-transcript-toggle';
  const MAX_CAPTURE_GAP = 4;   // capture mode: endT ước lượng cho export
  const CAPTION_EVENT    = 'ybs-caption';
  const PLAYER_EVENT     = 'ybs-player-data';

  let targetLang = 'vi';

  const state = {
    open: false,
    title: '',
    sourceMode: 'none',        // none | loading | player | capture
    tracks: [],
    candidates: [],            // timedtext URLs đã lọc
    processedUrls: new Set(),
    segments: [],              // {t, endT, text, translated}
    lastCaptionKey: null,      // `${t}|${text}` dedupe capture
    translating: false,
    cancelTranslate: false,
    rowMap: new Map(),         // segment → <li>
    activeT: -1
  };

  // ── DOM ───────────────────────────────────────────────────────
  let panel, toggleBtn, listEl, emptyEl, titleEl, progressEl, progressBarEl, progressTextEl, translateAllBtn;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = PANEL_ID;

    const header = document.createElement('div');
    header.className = 'ybs-header';
    titleEl = document.createElement('span');
    titleEl.className = 'ybs-title';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ybs-btn ybs-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Đóng (Alt+B)';
    closeBtn.addEventListener('click', () => setPanelOpen(false));
    header.append(titleEl, closeBtn);

    progressEl = document.createElement('div');
    progressEl.className = 'ybs-progress';
    progressEl.hidden = true;
    progressBarEl = document.createElement('div');
    progressBarEl.className = 'ybs-progress-bar';
    progressTextEl = document.createElement('span');
    progressTextEl.className = 'ybs-progress-text';
    progressEl.append(progressBarEl, progressTextEl);

    const actions = document.createElement('div');
    actions.className = 'ybs-actions';
    translateAllBtn = document.createElement('button');
    translateAllBtn.className = 'ybs-btn ybs-primary';
    translateAllBtn.textContent = 'Translate All';
    translateAllBtn.addEventListener('click', translateAll);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'ybs-btn';
    copyBtn.textContent = 'Copy TXT';
    copyBtn.addEventListener('click', copyTxt);
    const srtBtn = document.createElement('button');
    srtBtn.className = 'ybs-btn';
    srtBtn.textContent = 'SRT';
    srtBtn.addEventListener('click', () => exportFile(makeFilename('srt'), buildSrt(state.segments), 'application/x-subrip'));
    const vttBtn = document.createElement('button');
    vttBtn.className = 'ybs-btn';
    vttBtn.textContent = 'VTT';
    vttBtn.addEventListener('click', () => exportFile(makeFilename('vtt'), buildVtt(state.segments), 'text/vtt'));
    actions.append(translateAllBtn, copyBtn, srtBtn, vttBtn);

    emptyEl = document.createElement('div');
    emptyEl.className = 'ybs-empty';
    emptyEl.hidden = true;

    listEl = document.createElement('ul');
    listEl.className = 'ybs-list';

    panel.append(header, progressEl, actions, emptyEl, listEl);

    toggleBtn = document.createElement('button');
    toggleBtn.id = TOGGLE_ID;
    toggleBtn.textContent = '📜';
    toggleBtn.title = 'Mở transcript (Alt+B)';
    toggleBtn.addEventListener('click', () => setPanelOpen(true));

    (document.body || document.documentElement).append(toggleBtn, panel);
  }

  function setPanelOpen(open) {
    ensurePanel();
    if (state.open === open) return;
    state.open = open;
    panel.classList.toggle('ybs-open', open);
    toggleBtn.hidden = open;
    if (open) {
      if (state.sourceMode === 'none') scanResources();
      highlightCurrent();
    }
    chrome.storage.sync.set({ transcriptOpen: open }).catch(() => {});
  }

  // ── Timedtext interception ─────────────────────────────────────
  function scanResources() {
    if (typeof performance !== 'undefined') {
      performance.getEntriesByType('resource').forEach(handleResourceEntry);
    }
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) handleResourceEntry(entry);
      }).observe({ type: 'resource', buffered: true });
    } catch (e) { /* test env / cũ */ }
  }

  function handleResourceEntry(entry) {
    if (!entry || !entry.name) return;
    const url = entry.name;
    if (!url.includes('/api/timedtext')) return;
    if (!url.includes('fmt=json3')) return;
    // Rolling-window refetch: lặp lại với đoạn bị cắt → bỏ
    if (url.includes('aAppend=')) return;
    // Track đã auto-translate sẵn → bỏ, không dịch lại
    if (url.includes('tlang=')) return;
    const clean = url.split('&translate_uri=')[0];
    if (state.processedUrls.has(clean)) return;
    state.processedUrls.add(clean);

    let lang = null;
    try { lang = new URL(clean).searchParams.get('lang'); } catch (e) {}
    // Ưu tiên track manual (kind !== 'asr') qua metadata từ player
    const isManual = state.tracks.some(t => t.langCode === lang && t.kind !== 'asr');
    state.candidates.push({ url: clean, lang, isManual });

    if (state.sourceMode === 'none' && state.candidates.length === 1) loadBestTranscript();
    else if (isManual && state.sourceMode === 'loading') loadBestTranscript();
  }

  async function loadBestTranscript() {
    const best = state.candidates.filter(c => c.isManual)[0] || state.candidates[0];
    if (!best) return;
    const url = best.url;
    state.sourceMode = 'loading';
    const segments = await fetchTranscript(url);
    if (state.sourceMode !== 'loading') return; // nav / reset giữa chừng
    if (segments && segments.length > 0) {
      state.segments = segments;
      state.sourceMode = 'player';
      emptyEl.hidden = true;
      renderList();
      highlightCurrent();
    } else {
      // PoToken: timedtext trả 200 + body rỗng → chuyển capture mode
      state.sourceMode = 'capture';
      showEmpty('Không tải được transcript trực tiếp (po-token). Bật phụ đề (CC) để thu thập từng dòng.');
    }
  }

  async function fetchTranscript(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const raw = await res.text();
      if (!raw.trim()) return null; // 200 + rỗng
      const data = JSON.parse(raw);
      const out = [];
      for (const ev of data.events || []) {
        if (!ev.segs || !ev.segs.length) continue;
        const text = ev.segs.map(s => s.utf8 || '').join('\n').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const t = (ev.tStartMs || 0) / 1000;
        out.push({ t, endT: t + (ev.dDurationMs || 0) / 1000, text, translated: null });
      }
      return out;
    } catch (e) {
      return null;
    }
  }

  // ── Capture mode (fallback) ────────────────────────────────────
  let renderTimer = null;
  function onCaption(e) {
    if (state.sourceMode !== 'capture') return;
    const { text, translated, lang, t } = e.detail || {};
    if (!text) return;
    const key = `${t}|${text}`;
    if (state.lastCaptionKey === key) return; // caption đang hiện, chưa đổi
    state.lastCaptionKey = key;
    const existing = state.segments.find(s => s.t === t && s.text === text);
    if (existing) {
      if (translated) existing.translated = translated;
    } else {
      state.segments.push({ t, endT: t + MAX_CAPTURE_GAP, text, translated });
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderList, 200); // idiom content.js debounce
  }

  function onPlayerData(e) {
    const detail = e.detail || {};
    state.tracks = detail.tracks || [];
    if (detail.title && detail.title !== state.title) {
      state.title = detail.title;
      if (titleEl) titleEl.textContent = state.title;
      titleEl.title = state.title;
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = '';
    state.rowMap.clear();
    for (const seg of state.segments) {
      const li = document.createElement('li');
      li.className = 'ybs-row';
      if (seg.t <= state.activeT) li.classList.add('active');

      const time = document.createElement('span');
      time.className = 'ybs-time';
      time.textContent = fmtTime(seg.t);

      const body = document.createElement('div');
      body.className = 'ybs-body';
      const orig = document.createElement('div');
      orig.className = 'ybs-orig';
      orig.textContent = seg.text;
      body.appendChild(orig);
      if (seg.translated) {
        const tr = document.createElement('div');
        tr.className = 'ybs-trans';
        tr.textContent = seg.translated;
        body.appendChild(tr);
      }

      li.append(time, body);
      li.addEventListener('click', () => seekTo(seg.t));
      state.rowMap.set(seg, li);
      listEl.appendChild(li);
    }
  }

  function updateRow(seg) {
    const li = state.rowMap.get(seg);
    if (!li) return;
    let tr = li.querySelector('.ybs-trans');
    if (!tr) {
      tr = document.createElement('div');
      tr.className = 'ybs-trans';
      li.querySelector('.ybs-body').appendChild(tr);
    }
    tr.textContent = seg.translated;
  }

  // ── Seek + highlight ───────────────────────────────────────────
  function seekTo(t) {
    const video = document.querySelector('video');
    if (video) video.currentTime = t;
  }

  function highlightCurrent() {
    const video = document.querySelector('video');
    if (!video) return;
    // Tái dùng logic onTimeUpdate: highlight segment đang phát
    const cur = video.currentTime;
    let active = -1;
    for (const seg of state.segments) if (seg.t <= cur) active = seg.t;
    if (active === state.activeT) return;
    state.activeT = active;
    for (const [seg, li] of state.rowMap) li.classList.toggle('active', seg.t === active);
    if (active >= 0) {
      const li = state.rowMap.get(state.segments.find(s => s.t === active));
      if (li) li.scrollIntoView({ block: 'nearest' });
    }
  }

  function onTimeUpdate() {
    const video = document.querySelector('video');
    if (!video || !state.open) return;
    const cur = video.currentTime;
    let active = -1;
    for (const seg of state.segments) if (seg.t <= cur) active = seg.t;
    if (active === state.activeT) return;
    state.activeT = active;
    for (const [seg, li] of state.rowMap) li.classList.toggle('active', seg.t === active);
    if (active >= 0) {
      const li = state.rowMap.get(state.segments.find(s => s.t === active));
      if (li) li.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── Translate All (queue concurrency 1, cancelable) ────────────
  function translateAll() {
    if (state.translating) {
      state.cancelTranslate = true; // lần nhấn thứ 2 = hủy
      return;
    }
    const pending = state.segments.filter(s => !s.translated);
    if (!pending.length) return;
    state.translating = true;
    state.cancelTranslate = false;
    translateAllBtn.textContent = 'Cancel';
    showProgress(0, pending.length);
    runQueue(pending);
  }

  async function runQueue(pending) {
    const total = pending.length;
    let done = 0;
    for (const seg of pending) {
      if (state.cancelTranslate) break;
      const res = await sendTranslate(seg.text, targetLang);
      if (state.cancelTranslate) break;
      if (res && res.translatedText && !res.isFallback) {
        seg.translated = res.translatedText;
        updateRow(seg);
      }
      done++;
      showProgress(done, total);
    }
    state.translating = false;
    state.cancelTranslate = false;
    translateAllBtn.textContent = 'Translate All';
    hideProgress();
  }

  function sendTranslate(text, targetLang) {
    return new Promise((resolve) => {
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
        if (attempts > 2) { done(null); return; } // resend tối đa 1 lần
        chrome.runtime.sendMessage({ action: 'translate', text, targetLang }, (response) => {
          if (chrome.runtime.lastError) { done(null); return; }
          done(response);
        });
      };
      send();
      watchdog = setTimeout(send, 12000);
    });
  }

  function showProgress(done, total) {
    progressEl.hidden = false;
    progressBarEl.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
    progressTextEl.textContent = `${done}/${total}`;
  }

  function hideProgress() {
    progressEl.hidden = true;
  }

  function showEmpty(msg) {
    emptyEl.textContent = msg;
    emptyEl.hidden = false;
  }

  // ── Copy / Export ──────────────────────────────────────────────
  function copyTxt() {
    const text = state.segments.map(s => s.translated || s.text).join('\n');
    navigator.clipboard.writeText(text).then(
      () => { translateAllBtn.dataset.feedback = '✓ Copied'; setTimeout(() => delete translateAllBtn.dataset.feedback, 1500); },
      () => {}
    );
  }

  function makeFilename(ext) {
    return `${sanitizeFilename(state.title || 'transcript')}.${ext}`;
  }

  function exportFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ── Pure helpers (testable) ────────────────────────────────────
  // Gộp endT: segment chưa có end (capture mode) → dùng t của segment kế
  function computeEnds(segments) {
    return segments.map((s, i) => ({
      ...s,
      endT: s.endT > s.t ? s.endT : (segments[i + 1] ? segments[i + 1].t : s.t + MAX_CAPTURE_GAP)
    }));
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${m}:${String(ss).padStart(2, '0')}`;
  }

  function fmtSrtTime(sec) {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function fmtVttTime(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function buildSrt(segments) {
    return computeEnds(segments).map((s, i) =>
      `${i + 1}\n${fmtSrtTime(s.t)} --> ${fmtSrtTime(s.endT)}\n${(s.translated || s.text).trim()}\n`
    ).join('\n');
  }

  function buildVtt(segments) {
    const body = computeEnds(segments).map((s, i) =>
      `${fmtVttTime(s.t)} --> ${fmtVttTime(s.endT)}\n${(s.translated || s.text).trim()}\n`
    ).join('\n');
    return `WEBVTT\n\n${body}`;
  }

  function sanitizeFilename(name) {
    const clean = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
    return clean || 'transcript';
  }

  // ── Lifecycle ──────────────────────────────────────────────────
  function onNav() {
    state.cancelTranslate = true;
    state.segments = [];
    state.candidates = [];
    state.processedUrls.clear();
    state.lastCaptionKey = null;
    state.sourceMode = 'none';
    state.tracks = [];
    state.title = '';
    state.activeT = -1;
    hideProgress();
    if (state.translating) {
      state.translating = false;
      translateAllBtn.textContent = 'Translate All';
    }
    if (listEl) renderList();
    if (state.open) scanResources();
  }

  function setup() {
    ensurePanel();
    document.addEventListener(CAPTION_EVENT, onCaption);
    window.addEventListener(PLAYER_EVENT, onPlayerData);
    document.addEventListener('yt-navigate-finish', onNav);

    const video = document.querySelector('video');
    if (video) {
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('seeked', () => { if (state.open) onTimeUpdate(); });
    } else {
      // video có thể xuất hiện sau — poll nhẹ 1 lần
      const t = setInterval(() => {
        const v = document.querySelector('video');
        if (v) {
          clearInterval(t);
          v.addEventListener('timeupdate', onTimeUpdate);
          v.addEventListener('seeked', () => { if (state.open) onTimeUpdate(); });
        }
      }, 1000);
    }

    chrome.storage.sync.get(['transcriptOpen', 'targetLang'], (data) => {
      if (data.targetLang) targetLang = data.targetLang;
      if (data.transcriptOpen) setPanelOpen(true);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.targetLang) targetLang = changes.targetLang.newValue;
      if (changes.transcriptOpen && changes.transcriptOpen.newValue !== undefined) {
        setPanelOpen(Boolean(changes.transcriptOpen.newValue));
      }
    });

    scanResources();
  }

  // Expose cho Harness B (test trong vm không chạy module, gọi qua window)
  window.__ybsTranscript = {
    state, setPanelOpen, renderList, onCaption, onPlayerData, onTimeUpdate,
    translateAll, buildSrt, buildVtt, fmtSrtTime, fmtVttTime, fmtTime,
    sanitizeFilename, computeEnds, handleResourceEntry, fetchTranscript,
    parseJson3: (data) => {
      const out = [];
      for (const ev of data.events || []) {
        if (!ev.segs || !ev.segs.length) continue;
        const text = ev.segs.map(s => s.utf8 || '').join('\n').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const t = (ev.tStartMs || 0) / 1000;
        out.push({ t, endT: t + (ev.dDurationMs || 0) / 1000, text, translated: null });
      }
      return out;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
