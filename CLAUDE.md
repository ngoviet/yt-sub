# CLAUDE.md — yt-sub (YouTube Bilingual Subtitles)

Chrome extension **Manifest V3** dịch phụ đề YouTube sang song ngữ realtime.
Chỉ dùng **Google Translate** (gtx endpoint `translate.googleapis.com`) làm provider dịch — không có DeepSeek.

## Cấu Trúc

```
yt-sub/
├── manifest.json              # MV3 config: permission, content_scripts, commands, action
├── background/
│   └── background.js          # Service worker: nhận message 'translate', cache, rate limit, gọi gtx
├── content/
│   ├── content.js             # Content script chính: bắt caption, overlay song ngữ, settings
│   ├── overlay.css            # Style overlay #yt-bilingual-sub
│   ├── transcript.js          # Transcript panel (drawer phải) — watch pages
│   ├── transcript.css         # Style panel
│   └── yt-player-data.js      # MAIN-world bridge (document_start): đọc player response → CustomEvent
├── popup/
│   ├── popup.html             # UI settings
│   ├── popup.css              # Style popup (dark theme)
│   └── popup.js               # Logic settings, ghi storage, pushSettings sang tab
├── icons/                     # icon16/48/128
└── plans/
    └── improvement-plan.md    # Roadmap + changelog + test harness (lịch sử, KHÔNG sửa)
```

## Luồng Dịch (quan trọng nhất)

```
content.js  --chrome.runtime.sendMessage({action:'translate', text, targetLang})-->
background.js:
  1. RAM LRU cache (Map, max 1000)
  2. Persistent cache (storage.local, prefix 'tc:') — set ngược RAM
  3. Rate limiter (10 req/1s)
  4. translateText() → gtx + AbortController 8s timeout
  5. translateWithRetry() (3 lần, exponential backoff 1s→5s)
  6. Graceful fallback → `[lang] text` (KHÔNG cache fallback)
```

- **Cache key** = `` `${text}_${targetLang}` `` (background.js `makeCacheKey`).
- **bgInflight** (Map cacheKey→[sendResponse]): dedupe request trùng text — content watchdog 12s resend + Translate All queue chỉ tốn 1 network call.
- Response shape: `{ translatedText, detectedLang? }`. `detectedLang` từ gtx `data[2]` (sl=auto) → content.js dùng prefix `[EN]`.

## Cơ Chế Chính

### Bắt phụ đề (content.js)
- **MutationObserver** trên `.ytp-caption-window-container` (Light + Shadow DOM).
- **KHÔNG fetch timedtext** cho overlay → miễn nhiễm PoToken (YouTube chặn timedtext không pot).
- Selector gom ở constants đầu file (`CAPTION_AREA_SELECTOR`, `SEGMENT_SELECTOR`).
- Dịch **từng segment** riêng (tránh nhân bản), dedupe qua `inflight` map + `segmentStates`.
- Overlay `#yt-bilingual-sub` chèn vào `.html5-video-player` (căn giữa theo fullscreen), font/size copy từ segment thật qua `getComputedStyle`.
- SPA nav: bắt `yt-navigate-finish` (rẻ hơn urlObserver full body).

### Transcript panel (transcript.js)
- Nguồn 1: `yt-player-data.js` (MAIN world) đọc `ytInitialPlayerResponse.captionTracks` → CustomEvent `ybs-player-data`.
- Nguồn 2: `PerformanceObserver` bắt URL `/api/timedtext?fmt=json3` (bỏ `aAppend=`, `tlang=`, `translate_uri`) → fetch JSON3.
- PoToken fail (200+rỗng) → **capture mode**: nghe `ybs-caption` events từ content.js.
- Translate All: queue concurrency 1, cancelable, watchdog 12s, progress bar.

### MAIN world bridge (yt-player-data.js)
- Chạy `world: MAIN`, `run_at: document_start` — isolated world KHÔNG thấy `window.ytInitialPlayerResponse`.
- KHÔNG dùng `chrome.*` APIs. Giao tiếp qua CustomEvent (`ybs-player-data`, request lại khi race).

## Storage

| Key | Area | Mục đích |
|-----|------|----------|
| `isEnabled`, `targetLang`, `subtitleMode`, `debugMode`, `fontSizeScale`, `overlayBottom`, `accentColor` | sync | Settings (nhỏ) |
| `transcriptOpen` | sync | Trạng thái panel |
| `tc:<cacheKey>` | local | Cache dịch (prefix `tc:`, max 2000, prune khi SW khởi động) |

## Phím Tắt (manifest commands)

- `Alt+T` — toggle dịch (`toggle-subtitles`)
- `Alt+Shift+T` — xoay mode (`cycle-mode`): bilingual → translated-only → original-only
- `Alt+B` — toggle transcript (`toggle-transcript`)

## Conventions

- Comment/giải thích tiếng Việt; code, tên biến/hàm, commit message tiếng Anh.
- Conventional Commits: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`.
- Selector YouTube gom 1 chỗ (constants) vì YouTube hay đổi class — sửa 1 chỗ.
- Content scripts bọc IIFE, transcript.js expose `window.__ybsTranscript` cho test harness.

## Test / Build

- **Không có build step** — Load unpacked: `chrome://extensions/` → Developer mode → Load unpacked → chọn `d:/code/yt-sub`.
- Test harness (Node chrome-stub + Playwright stub) mô tả trong `plans/improvement-plan.md` — không có file test trong repo.
- Verify bằng tay: mở video YouTube có CC → bật toggle → đổi mode/ngôn ngữ → overlay hiển thị; `Alt+B` → transcript panel.

## Lưu ý

- SW bị kill ~30s idle → cache dịch phải persistent (`storage.local`), không chỉ RAM.
- Fallback `[lang] text` KHÔNG được cache (lỗi tạm thời không nên dính vĩnh viễn).
- Overlay KHÔNG chèn vào caption DOM YouTube (gây reposition/nhảy) — dùng div riêng ngoài.
