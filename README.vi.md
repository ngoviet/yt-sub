# YouTube Bilingual Subtitles

<!-- readme-axi type=tool -->

![](https://img.shields.io/badge/Manifest-V3-blue) ![](https://img.shields.io/badge/Chrome-Extension-green) ![](https://img.shields.io/badge/License-MIT-orange)

[English](README.md) · **Tiếng Việt**

**Dịch phụ đề YouTube sang song ngữ realtime.** Chrome extension (Manifest V3) hiện phụ đề gốc và bản dịch cùng
lúc ngay khi video phát, kèm bảng transcript trong trang có thể xuất ra SRT/VTT/TXT. Dịch bằng Google Translate,
không cần API key, chạy được cả trên YouTube Shorts.

[Chrome Web Store](#) • [Báo cáo lỗi](https://github.com/ngoviet/yt-sub/issues)

> 🇻🇳 Dự án do một người Việt tự xây dựng và duy trì — nếu nó giúp ích cho bạn, hãy
> [ủng hộ dự án](#ủng-hộ-dự-án).

## Mục lục

- [Tính năng](#tính-năng)
- [Cài đặt](#cài-đặt)
- [Cách dùng](#cách-dùng)
- [Cấu hình](#cấu-hình)
- [Cách hoạt động](#cách-hoạt-động)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Phát triển](#phát-triển)

## Tính năng

| Tính Năng | Mô Tả |
|-----------|--------|
| 🌐 **Dịch realtime** | Dịch phụ đề YouTube ngay khi phát |
| 🔤 **Chế độ song ngữ** | Hiển thị cả phụ đề gốc và bản dịch |
| 📜 **Transcript panel** | Bảng transcript trong trang (Alt+B), click-jump, Translate All, export SRT/VTT/TXT |
| 🔄 **LRU Cache** | Tối ưu hiệu suất với cache giới hạn |
| ⚡ **Rate Limiting** | Giới hạn request để tránh bị block |
| 🔄 **Auto Retry** | Tự động thử lại khi lỗi với exponential backoff |
| 🎨 **UI hiện đại** | Giao diện dark theme với glassmorphism |
| 🐛 **Debug Mode** | Chế độ debug để troubleshooting |
| 📱 **Shorts Support** | Hỗ trợ cả YouTube Shorts |

## Cài đặt

### Từ Chrome Web Store (sắp ra mắt)

### Từ source code

1. Tải extension về
2. Mở Chrome → `chrome://extensions/`
3. Bật **Developer mode** (góc phải trên)
4. Click **Load unpacked**
5. Chọn folder extension

## Cách dùng

1. Mở YouTube và xem video có phụ đề
2. Click vào icon extension trên toolbar
3. Bật/tắt extension với toggle **Enable Extension**
4. Chọn chế độ hiển thị:
   - **Bilingual**: Hiện cả phụ đề gốc và bản dịch
   - **Translated**: Chỉ hiện bản dịch
   - **Original**: Chỉ hiện phụ đề gốc
5. Chọn ngôn ngữ đích

Extension chỉ dùng Google Translate (gtx); không cần API key và không còn lựa chọn DeepSeek.
Khi nâng cấp, cấu hình/API key DeepSeek đã lưu không còn được đọc hoặc sử dụng; phiên bản này không tự xóa chúng khỏi storage.

### Chế độ hiển thị

| Bilingual Mode | Translated Mode |
|----------------|-----------------|
| Hiển thị cả 2 ngôn ngữ | Chỉ hiển thị bản dịch |

### Transcript

Trên trang watch, mở panel bằng `Alt+B` và chọn **Translate All** để dịch các dòng chưa có bản dịch thành công.
Nếu một dòng gặp timeout hoặc fallback, nhấn **Translate All** lại sau khi mạng phục hồi để thử lại.
Đổi ngôn ngữ đích sẽ dừng lượt dịch hiện tại và xóa bản dịch cũ trong panel; nhấn **Translate All** để dịch sang ngôn ngữ mới.
Chuyển video sẽ xóa transcript cũ và bỏ qua kết quả đang chờ của video trước.

## Cấu hình

| Setting | Mô Tả | Mặc Định |
|---------|--------|----------|
| Enable Extension | Bật/tắt extension | ✅ On |
| Display Mode | Chế độ hiển thị phụ đề | Bilingual |
| Target Language | Ngôn ngữ dịch | Vietnamese |
| Debug Mode | Bật logging | ❌ Off |

### Phím tắt

- `Alt+T` bật/tắt dịch
- `Alt+Shift+T` xoay chế độ hiển thị (bilingual / translated / original)
- `Alt+B` bật/tắt transcript

## Cách hoạt động

- **Manifest V3** - Chrome Extension API mới nhất
- **Google Translate API** - Dịch thuật realtime (gtx endpoint)
- **MutationObserver** - Theo dõi phụ đề YouTube
- **PerformanceObserver** - Intercept timedtext (po-token) cho transcript
- **LRU Cache** - Tối ưu bộ nhớ
- **Exponential Backoff** - Retry mechanism

## Cấu trúc dự án

```
yt-sub/
├── manifest.json              # Cấu hình extension
├── background/
│   └── background.js          # Service worker (translation, cache, rate limit)
├── content/
│   ├── content.js             # Content script (UI, overlay, caption events)
│   ├── overlay.css            # Overlay styling
│   ├── transcript.js          # Transcript panel (drawer)
│   ├── transcript.css         # Panel styling
│   └── yt-player-data.js      # MAIN-world bridge (player response → event)
├── popup/
│   ├── popup.html             # Settings UI
│   ├── popup.css              # UI styling
│   └── popup.js               # Settings logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── plans/
    └── improvement-plan.md    # Kế hoạch và lịch sử trước đợt hardening
```

## Phát triển

```bash
# Clone repository
git clone https://github.com/ngoviet/yt-sub.git
cd yt-sub

# Load vào Chrome
# chrome://extensions/ → Load unpacked → chọn folder này
```

### Kiểm tra hồi quy

Chạy test bằng Node.js, không cần cài dependency:

```bash
node --test tests/regression.test.cjs
```

Test dùng Chrome/DOM stub và đồng hồ giả để kiểm tra cache, rate limiter, watchdog và race condition khi chuyển video/ngôn ngữ.
Test này không thay thế kiểm tra extension trên YouTube thật.
Xem [báo cáo rà soát và bài học](docs/codebase-review-2026-09-17.md) để biết phạm vi thay đổi và các giới hạn còn lại.

### Đóng góp

Mọi đóng góp đều được chào đón. Hãy tạo pull request hoặc báo cáo issue.

<!-- support:start -->
## Ủng hộ dự án

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/banner.svg" width="720" alt="Built and maintained by one person in Việt Nam">
</p>

<p align="center">
  <a href="https://buymeacoffee.com/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-coffee.svg" height="56" alt="Buy me a coffee"></a>
  &nbsp;
  <a href="https://github.com/sponsors/ngoviet"><img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/btn-sponsors.svg" height="56" alt="GitHub Sponsors"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/ngoviet/.github/main/assets/support/vietqr-card.svg" width="300" alt="VietQR — MB Bank — NGO DUC VIET — 911051212">
</p>

<p align="center"><sub>🇻🇳 VietQR: quét bằng app ngân hàng bất kỳ, nội dung <code>Ung ho yt-sub</code>. Cảm ơn bạn đã giúp dự án tiếp tục phát triển!</sub></p>
<p align="center"><sub>Tiền mã hoá (mạng BEP20): <code>0xcbf0402b232cb24b4d998f09a4884f87b5f74750</code> · USDT · USDC · BNB · ETH · BTC</sub></p>
<!-- support:end -->

## Giấy phép

[MIT](LICENSE) © Ngô Đức Việt.
