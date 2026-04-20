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

## ⚙️ Cấu Hình

| Setting | Mô Tả | Mặc Định |
|---------|--------|----------|
| Enable Extension | Bật/tắt extension | ✅ On |
| Display Mode | Chế độ hiển thị phụ đề | Bilingual |
| Target Language | Ngôn ngữ dịch | Vietnamese |
| Debug Mode | Bật logging | ❌ Off |

## 🛠️ Công Nghệ

- **Manifest V3** - Chrome Extension API mới nhất
- **Google Translate API** - Dịch thuật realtime
- **MutationObserver** - Theo dõi phụ đề YouTube
- **LRU Cache** - Tối ưu bộ nhớ
- **Exponential Backoff** - Retry mechanism

## 📁 Cấu Trúc Project

```
yt-sub/
├── manifest.json              # Cấu hình extension
├── background/
│   └── background.js          # Service worker (translation, cache, rate limit)
├── content/
│   ├── content.js             # Content script (UI, overlay)
│   └── overlay.css            # Overlay styling
├── popup/
│   ├── popup.html             # Settings UI
│   ├── popup.css              # UI styling
│   └── popup.js               # Settings logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── plans/
    └── improvement-plan.md    # Development roadmap
```

## 🔧 Development

```bash
# Clone repository
git clone https://github.com/ngoviet/yt-sub.git
cd yt-sub

# Load vào Chrome
# chrome://extensions/ → Load unpacked → chọn folder này
```

## 📝 License

MIT License

## 🤝 Đóng Góp

Mọi đóng góp đều được chào đón. Hãy tạo pull request hoặc báo cáo issue.

---

Made with ❤️ by [ngoviet](https://github.com/ngoviet)
