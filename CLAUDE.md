# CLAUDE.md — yt-sub (YouTube Bilingual Subtitles)

Chrome extension **Manifest V3** dịch phụ đề YouTube sang song ngữ realtime.
Provider và hướng dẫn nâng cấp: xem [README](README.md#-cách-sử-dụng).

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
  3. translateWithFallback() → translateWithRetry() → translateText()
```

Hợp đồng cache, retry, dedupe và watchdog: xem [chi tiết hardening](docs/codebase-review-2026-09-17.md#hợp-đồng-dịch-và-cache).

## Cơ Chế Chính

### Bắt phụ đề (content.js)
- **MutationObserver** trên `.ytp-caption-window-container` (Light + Shadow DOM).
- **KHÔNG fetch timedtext** cho overlay → miễn nhiễm PoToken (YouTube chặn timedtext không pot).
- Selector gom ở constants đầu file (`CAPTION_AREA_SELECTOR`, `SEGMENT_SELECTOR`).
- Dịch **từng segment** riêng (tránh nhân bản), dedupe qua `inflight` map + `segmentStates`.
- Overlay `#yt-bilingual-sub` chèn vào `.html5-video-player` (căn giữa theo fullscreen), font/size copy từ segment thật qua `getComputedStyle`.
- SPA nav: bắt `yt-navigate-finish` (rẻ hơn urlObserver full body).

### Transcript panel (transcript.js)
- Metadata track/title: `yt-player-data.js` (MAIN world) đọc player response của video hiện tại → CustomEvent `ybs-player-data`; xem `extract()` để biết đường dẫn dữ liệu và fallback.
- Nguồn 2: `PerformanceObserver` bắt URL `/api/timedtext?fmt=json3` (bỏ `aAppend=`, `tlang=`, `translate_uri`) → fetch JSON3.
- PoToken fail (200+rỗng) → **capture mode**: nghe `ybs-caption` events từ content.js.
- Translate All: queue concurrency 1, cancelable, progress bar; vòng đời queue và watchdog nằm trong [báo cáo hardening](docs/codebase-review-2026-09-17.md#các-thay-đổi).

### MAIN world bridge (yt-player-data.js)
- Chạy `world: MAIN`, `run_at: document_start` — isolated world KHÔNG thấy `window.ytInitialPlayerResponse`.
- KHÔNG dùng `chrome.*` APIs. Giao tiếp qua CustomEvent (`ybs-player-data`, request lại khi race).

## Storage

| Key | Area | Mục đích |
|-----|------|----------|
| `isEnabled`, `targetLang`, `subtitleMode`, `debugMode`, `fontSizeScale`, `overlayBottom`, `accentColor` | sync | Settings (nhỏ) |
| `transcriptOpen` | sync | Trạng thái panel |
| `tc:<cacheKey>` | local | [Hợp đồng cache](docs/codebase-review-2026-09-17.md#hợp-đồng-dịch-và-cache) |

## Phím Tắt (manifest commands)

- `Alt+T` — toggle dịch (`toggle-subtitles`)
- `Alt+Shift+T` — xoay mode (`cycle-mode`): bilingual → translated-only → original-only
- `Alt+B` — toggle transcript (`toggle-transcript`)

## Conventions

- Comment/giải thích tiếng Việt; code, tên biến/hàm, commit message tiếng Anh.
- Conventional Commits: `feat:` / `fix:` / `refactor:` / `docs:` / `chore:`.
- Selector YouTube gom 1 chỗ (constants) vì YouTube hay đổi class — sửa 1 chỗ.
- `transcript.js` và `yt-player-data.js` bọc IIFE; `transcript.js` expose `window.__ybsTranscript` cho test harness.

## Test / Build

- **Không có build step** — xem [cài đặt từ source](README.md#từ-source-code).
- Test hiện hành và lệnh chạy: [kiểm tra hồi quy](README.md#kiểm-tra-hồi-quy).
- Verify bằng tay: mở video YouTube có CC → bật toggle → đổi mode/ngôn ngữ → overlay hiển thị; `Alt+B` → transcript panel.

## Lưu ý

- SW bị kill ~30s idle → cache dịch phải persistent (`storage.local`), không chỉ RAM.
- Fallback `[lang] text` KHÔNG được cache (lỗi tạm thời không nên dính vĩnh viễn).
- Overlay KHÔNG chèn vào caption DOM YouTube (gây reposition/nhảy) — dùng div riêng ngoài.
