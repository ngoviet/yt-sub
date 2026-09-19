# YouTube Bilingual Subtitles

<div align="center">

![](https://img.shields.io/badge/Manifest-V3-blue) ![](https://img.shields.io/badge/Chrome-Extension-green) ![](https://img.shields.io/badge/License-MIT-orange)

**Dịch phụ đề YouTube sang song ngữ realtime**

[Chrome Web Store](#) • [Báo cáo lỗi](https://github.com/ngoviet/yt-sub/issues)

</div>

## ✨ Tính Năng

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

## 📸 Screenshots

| Bilingual Mode | Translated Mode |
|----------------|-----------------|
| Hiển thị cả 2 ngôn ngữ | Chỉ hiển thị bản dịch |

## 🚀 Cài Đặt

### Từ Chrome Web Store (sắp ra mắt)

### Từ Source Code

1. Tải extension về
2. Mở Chrome → `chrome://extensions/`
3. Bật **Developer mode** (góc phải trên)
4. Click **Load unpacked**
5. Chọn folder extension

## 📖 Cách Sử Dụng

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

### Transcript

Trên trang watch, mở panel bằng `Alt+B` và chọn **Translate All** để dịch các dòng chưa có bản dịch thành công.
Nếu một dòng gặp timeout hoặc fallback, nhấn **Translate All** lại sau khi mạng phục hồi để thử lại.
Đổi ngôn ngữ đích sẽ dừng lượt dịch hiện tại và xóa bản dịch cũ trong panel; nhấn **Translate All** để dịch sang ngôn ngữ mới.
Chuyển video sẽ xóa transcript cũ và bỏ qua kết quả đang chờ của video trước.

## ⚙️ Cấu Hình

| Setting | Mô Tả | Mặc Định |
|---------|--------|----------|
| Enable Extension | Bật/tắt extension | ✅ On |
| Display Mode | Chế độ hiển thị phụ đề | Bilingual |
| Target Language | Ngôn ngữ dịch | Vietnamese |
| Debug Mode | Bật logging | ❌ Off |

### Phím Tắt

- `Alt+T` bật/tắt dịch
- `Alt+Shift+T` xoay chế độ hiển thị (bilingual / translated / original)
- `Alt+B` bật/tắt transcript

## 🛠️ Công Nghệ

- **Manifest V3** - Chrome Extension API mới nhất
- **Google Translate API** - Dịch thuật realtime (gtx endpoint)
- **MutationObserver** - Theo dõi phụ đề YouTube
- **PerformanceObserver** - Intercept timedtext (po-token) cho transcript
- **LRU Cache** - Tối ưu bộ nhớ
- **Exponential Backoff** - Retry mechanism

## 📁 Cấu Trúc Project

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

## 🔧 Development

```bash
# Clone repository
git clone https://github.com/ngoviet/yt-sub.git
cd yt-sub

# Load vào Chrome
# chrome://extensions/ → Load unpacked → chọn folder này
```

## Kiểm tra hồi quy

Chạy test bằng Node.js, không cần cài dependency:

```bash
node --test tests/regression.test.cjs
```

Test dùng Chrome/DOM stub và đồng hồ giả để kiểm tra cache, rate limiter, watchdog và race condition khi chuyển video/ngôn ngữ.
Test này không thay thế kiểm tra extension trên YouTube thật.
Xem [báo cáo rà soát và bài học](docs/codebase-review-2026-09-17.md) để biết phạm vi thay đổi và các giới hạn còn lại.

## 📝 License

MIT License

## 🤝 Đóng Góp

Mọi đóng góp đều được chào đón. Hãy tạo pull request hoặc báo cáo issue.

---

Made with ❤️ by [ngoviet](https://github.com/ngoviet)
