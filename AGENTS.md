# AGENTS.md — yt-sub

Chrome extension Manifest V3 dịch phụ đề YouTube sang song ngữ realtime.
Hướng dẫn chính (cấu trúc, luồng dịch, quy ước): [CLAUDE.md](CLAUDE.md) — áp dụng chung cho mọi agent.

- Cài: không có bước cài hay build (không có phụ thuộc).
- Test: `node --test tests/regression.test.cjs` (stub Chrome/DOM, không gọi mạng thật).
- Lint: chưa cấu hình.
- CI: GitHub Actions `.github/workflows/ci.yml` (repo public).
- Không được đụng: `plans/improvement-plan.md` (lịch sử); không commit profile trình duyệt hay tệp kiểm thử live
  (`.live-profile/`, `live-check.cjs`, `live-content.cjs`).
