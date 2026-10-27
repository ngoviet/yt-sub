# YouTube Bilingual Subtitles

<!-- readme-axi type=tool -->

![](https://img.shields.io/badge/Manifest-V3-blue) ![](https://img.shields.io/badge/Chrome-Extension-green) ![](https://img.shields.io/badge/License-MIT-orange)

**English** · [Tiếng Việt](README.vi.md)

**Real-time bilingual YouTube subtitles.** A Chrome extension (Manifest V3) that shows the original caption and
its translation together while the video plays, plus an in-page transcript panel you can export to SRT/VTT/TXT.
It translates with Google Translate, needs no API key, and also works on YouTube Shorts.

[Chrome Web Store](#) • [Report a bug](https://github.com/ngoviet/yt-sub/issues)

> 🇻🇳 Built and maintained by one person in Việt Nam — if it saves you time, please
> [support the project](#support-the-project).

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Development](#development)

## Features

| Feature | Description |
|-----------|--------|
| 🌐 **Real-time translation** | Translates YouTube subtitles as the video plays |
| 🔤 **Bilingual mode** | Shows both the original subtitle and the translation |
| 📜 **Transcript panel** | In-page transcript panel (Alt+B), click-jump, Translate All, export SRT/VTT/TXT |
| 🔄 **LRU Cache** | Better performance with a size-limited cache |
| ⚡ **Rate Limiting** | Limits requests to avoid getting blocked |
| 🔄 **Auto Retry** | Retries automatically on errors with exponential backoff |
| 🎨 **Modern UI** | Dark theme interface with glassmorphism |
| 🐛 **Debug Mode** | Debug mode for troubleshooting |
| 📱 **Shorts Support** | Works on YouTube Shorts too |

## Installation

### From the Chrome Web Store (coming soon)

### From source

1. Download the extension
2. Open Chrome → `chrome://extensions/`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the extension folder

## Usage

1. Open YouTube and play a video that has subtitles
2. Click the extension icon in the toolbar
3. Turn the extension on/off with the **Enable Extension** toggle
4. Pick a display mode:
   - **Bilingual**: shows both the original subtitle and the translation
   - **Translated**: shows only the translation
   - **Original**: shows only the original subtitle
5. Pick the target language

The extension uses only Google Translate (gtx); it needs no API key and no longer offers DeepSeek.
After an upgrade, saved DeepSeek settings/API keys are no longer read or used; this version does not delete them from storage.

### Display modes

| Bilingual Mode | Translated Mode |
|----------------|-----------------|
| Shows both languages | Shows only the translation |

### Transcript

On a watch page, open the panel with `Alt+B` and choose **Translate All** to translate the lines that do not yet have a successful translation.
If a line hits a timeout or a fallback, press **Translate All** again once the network recovers to retry.
Changing the target language stops the current translation run and clears the old translations in the panel; press **Translate All** to translate into the new language.
Switching videos clears the old transcript and discards pending results from the previous video.

## Configuration

| Setting | Description | Default |
|---------|--------|----------|
| Enable Extension | Turn the extension on/off | ✅ On |
| Display Mode | Subtitle display mode | Bilingual |
| Target Language | Translation language | Vietnamese |
| Debug Mode | Enable logging | ❌ Off |

### Keyboard shortcuts

- `Alt+T` toggles translation
- `Alt+Shift+T` cycles the display mode (bilingual / translated / original)
- `Alt+B` toggles the transcript

## How it works

- **Manifest V3** - the latest Chrome Extension API
- **Google Translate API** - real-time translation (gtx endpoint)
- **MutationObserver** - watches YouTube's subtitles
- **PerformanceObserver** - intercepts timedtext (po-token) for the transcript
- **LRU Cache** - keeps memory use in check
- **Exponential Backoff** - retry mechanism

## Project layout

```
yt-sub/
├── manifest.json              # Extension configuration
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
    └── improvement-plan.md    # Plan and history before the hardening pass
```

## Development

```bash
# Clone repository
git clone https://github.com/ngoviet/yt-sub.git
cd yt-sub

# Load into Chrome
# chrome://extensions/ → Load unpacked → select this folder
```

### Regression tests

Run the tests with Node.js; no dependencies to install:

```bash
node --test tests/regression.test.cjs
```

The tests use Chrome/DOM stubs and a fake clock to check the cache, rate limiter, watchdog and race conditions when switching videos/languages.
They do not replace testing the extension on real YouTube.
See the [review report and lessons learned](docs/codebase-review-2026-09-17.md) (in Vietnamese) for the scope of the changes and the remaining limitations.

### Contributing

Contributions are welcome. Open a pull request or report an issue.

<!-- support:start -->
## Support the project

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

<p align="center"><sub>🇻🇳 VietQR: scan with any Vietnamese banking app, transfer note <code>Ung ho yt-sub</code>. Thank you for keeping this project alive!</sub></p>
<p align="center"><sub>Crypto (BEP20 network): <code>0x57f07d44fb581cddc028a0c67d63a8cc05aa6caa</code> · USDT · USDC · BNB · ETH · BTC</sub></p>
<!-- support:end -->

## License

[MIT](LICENSE) © Ngô Đức Việt.
