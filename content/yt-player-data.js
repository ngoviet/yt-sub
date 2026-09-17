// ================================================================
// yt-player-data.js — MAIN world (watch pages, document_start)
// Isolated world KHÔNG thấy window.ytInitialPlayerResponse → script
// này chạy trong MAIN world, đọc player response và dispatch
// CustomEvent 'ybs-player-data' (DOM events xuyên qua các world).
// KHÔNG dùng chrome.* APIs (MAIN world không có).
// ================================================================
(() => {
  const EVENT = 'ybs-player-data';
  const REQUEST_EVENT = 'ybs-player-data-request';
  let sent = false;
  let lastPayload = null;
  let pollTimer = null;

  function dispatch(payload) {
    lastPayload = payload;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
    sent = true;
  }

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
    const videoId = new URL(location.href).searchParams.get('v');
    if (!videoId || data.videoDetails?.videoId !== videoId) return;
    const captionTracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks || data.captionTracks;
    const tracks = Array.isArray(captionTracks)
      ? captionTracks.map(t => ({
          langCode: t.languageCode,
          kind: t.kind,
          name: t.name && t.name.simpleText ? t.name.simpleText : t.name,
          baseUrl: t.baseUrl
        }))
      : [];
    const title = data.videoDetails && data.videoDetails.title ? data.videoDetails.title : '';
    if (tracks.length > 0 || title) {
      dispatch({ title, tracks, videoId });
    }
  }

  // transcript panel (isolated world) chạy muộn hơn — nếu đã miss event ban đầu
  // thì request lại, ta re-dispatch payload đã cache.
  window.addEventListener(REQUEST_EVENT, () => {
    if (lastPayload?.videoId === new URL(location.href).searchParams.get('v')) {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: lastPayload }));
    } else {
      extract();
    }
  });

  extract();

  // Player response có thể tới muộn → poll tối đa 10 lần × 500ms
  let remaining = 10;
  function poll() {
    clearTimeout(pollTimer);
    if (sent || remaining <= 0) return;
    remaining--;
    pollTimer = setTimeout(() => {
      extract();
      if (!sent) poll();
    }, 500);
  }
  poll();

  // SPA navigation — reset trạng thái, chờ dữ liệu mới
  document.addEventListener('yt-navigate-finish', () => {
    clearTimeout(pollTimer);
    sent = false;
    lastPayload = null; // tránh re-dispatch title/tracks của video cũ
    remaining = 10;
    pollTimer = setTimeout(() => { extract(); poll(); }, 0);
  });
})();
