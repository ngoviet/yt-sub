# Kế Hoạch Cải Tiến YouTube Bilingual Subtitles

> **Cập nhật 2026-08-22:** Plan gốc (7 item, v1.2) đã implement 6/7. Kế hoạch mới: v1.4 (bugs) → v1.5 (quick wins) → v1.6 (BYOK + transcript panel). Chi tiết đầy đủ: `C:\Users\Vokupt\.claude\plans\hi-staged-cocke.md`.

---

## Trạng Thái Plan Cũ (v1.2 → v1.3)

| # | Item | Trạng thái |
|---|------|-----------|
| 1 | Retry mechanism | ✅ Đã implement (background.js) |
| 2 | LRU Cache giới hạn | ✅ Đã implement (background.js) |
| 3 | Loading state + feedback | ⚠️ CSS có (`.loading`/pulse), JS chưa gọi — sẽ xử lý trong v1.4 (A2/A3) |
| 4 | Mở rộng URL match | ⚠️ Một phần: đã thêm `shorts*` + `embed/*`; **bỏ** đề xuất match `www.youtube.com/*` rộng (tiêm toàn trang không cần thiết) |
| 5 | Rate limiting | ✅ Đã implement (background.js) |
| 6 | Debug mode | ✅ Đã implement (storage + toggle popup) |
| 7 | Graceful degradation | ✅ Đã implement `[lang] text` (background.js) |

---

## Roadmap Mới

### v1.4.0 — Fix bugs (7 bug đã verify trong code)

| Bug | Mô tả | File |
|-----|-------|------|
| A1 | translated-only không ẩn caption gốc trong Shadow DOM (`querySelectorAll` không xuyên shadowRoot) | content.js |
| A2 | Bản dịch nhân bản khi nhiều segment — dịch theo từng segment + dedupe | content.js |
| A3 | Fetch không timeout → kênh message treo, retry không chạy (AbortController 8s + watchdog content 12s) | background.js, content.js |
| A4 | Fallback `[lang] text` bị cache vĩnh viễn — không cache fallback | background.js |
| A5 | Poll 1s vô hạn leak timer — giới hạn 30 lần + clear khi stop | content.js |
| A6 | urlObserver toàn body subtree tốn CPU — thay bằng `yt-navigate-finish` event | content.js |
| A7 | Đổi setting không lan sang tab khác — thêm `storage.onChanged` listener | content.js |

### v1.5.0 — Quick wins

- **B1.** Cache dịch persistent sang `chrome.storage.local` (SW bị kill ~30s idle không mất cache; giảm tải gtx). Lazy read: LRU → storage.local → network; write-through; prune ~2000 key khi SW khởi động
- **B4.** Phím tắt `chrome.commands`: `Alt+T` toggle, `Alt+Shift+T` xoay mode
- **B6.** Tùy chỉnh overlay: fontSize scale, bottom offset, màu nhấn (`--yt-accent`)
- **B7.** Hiển thị ngôn ngữ nguồn từ gtx response `data[2]`

### v1.6.0 — Tính năng lớn (roadmap)

- **B2. BYOK DeepSeek:** provider select + API key (storage.local) + model; endpoint OpenAI-compatible `POST https://api.deepseek.com/chat/completions`; fallback chain: DeepSeek → gtx → `[lang] text`; `optional_host_permissions`
- **B3. Transcript panel trong trang:** lấy transcript từ `ytInitialPlayerResponse...captionTracks[].baseUrl` (ưu tiên track manual `kind != 'asr'`), song ngữ, click-jump, Copy TXT + Export SRT/VTT; PoToken mitigation: fetch fail → capture mode từ MutationObserver (chỉ TXT)

### Stretch (v1.7+)

- B5. Chrome side panel | B8. AI tóm tắt video (cần B2+B3)

---

## Lợi Thế Kiến Trúc (giữ nguyên)

Extension scrape caption qua DOM (MutationObserver Light + Shadow), **không** fetch timedtext → **miễn nhiễm PoToken** (2025-2026 YouTube chặn timedtext không có PoToken, trả body rỗng). Chỉ dùng timedtext khi làm Transcript Panel (B3) và có capture-mode fallback.

## Risk Assessment

| Risk | Mức Độ | Mitigation |
|------|--------|------------|
| Google Translate gtx chết / 429 | Cao | Không cache lỗi (A4); cache persistent (B1) giảm tải; roadmap B2 fallback chain |
| SW bị kill giữa retry | Trung | Timeout 8s < idle 30s; watchdog 12s resend (A3); kênh message giữ SW sống ≤5 phút |
| storage.sync quota (8KB/item) | Trung | Chỉ settings nhỏ vào sync; cache dịch bắt buộc storage.local |
| YouTube đổi class caption | Trung | Selector gom constants; Light+Shadow fallback; feature-detect |
| API key BYOK lưu plaintext | Thấp | storage.local, cảnh báo UI + README, zero server trung gian |
