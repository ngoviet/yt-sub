// ================================================================
// yt-player-data.js — MAIN world (watch pages, document_start)
// Isolated world KHÔNG thấy window.ytInitialPlayerResponse → script
// này chạy trong MAIN world, đọc player response và dispatch
// CustomEvent 'ybs-player-data' (DOM events xuyên qua các world).
// KHÔNG dùng chrome.* APIs (MAIN world không có).
// ================================================================
(() => {
  const EVENT = 'ybs-player-data';
  let sent = false;

  function extract() {
    let data = null;
    try {
      if (window.ytInitialPlayerResponse) {
        data = window.ytInitialPlayerResponse;
      } else if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.raw_player_response) {
        const raw = window.ytplayer.config.args.raw_player_response;
        data = (typeof raw === 'string') ? JSON.parse(raw) : raw;
      }
    } catch (e) {
      return;
    }
    if (!data) return;
    const tracks = Array.isArray(data.captionTracks)
      ? data.captionTracks.map(t => ({
          langCode: t.languageCode,
          kind: t.kind,
          name: t.name && t.name.simpleText ? t.name.simpleText : t.name,
          baseUrl: t.baseUrl
        }))
      : [];
    const title = data.videoDetails && data.videoDetails.title ? data.videoDetails.title : '';
    if (tracks.length > 0 || title) {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { title, tracks } }));
      sent = true;
    }
  }

  extract();

  // Player response có thể tới muộn → poll tối đa 10 lần × 500ms
  let remaining = 10;
  function poll() {
    if (remaining <= 0) return;
    remaining--;
    setTimeout(() => {
      extract();
      if (!sent) poll();
    }, 500);
  }
  poll();

  // SPA navigation — reset trạng thái, chờ dữ liệu mới
  document.addEventListener('yt-navigate-finish', () => {
    sent = false;
    remaining = 10;
    setTimeout(extract, 0);
    poll();
  });
})();
