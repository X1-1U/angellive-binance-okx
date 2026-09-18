// Public, anonymous YouTube live adapter. No cookies, login or third-party relay.
const _yt_base = "https://www.youtube.com";
const _yt_ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const _yt_sessions = Object.create(null);
const _yt_lists = Object.create(null);
const _yt_queries = { all: "台灣 直播", news: "台灣 新聞 直播", games: "台灣 遊戲 直播", music: "台灣 音樂 直播", scenery: "台灣 即時影像" };
function _yt_str(v) { return v == null ? "" : String(v); }
function _yt_error(code, message) {
  if (typeof Host.raise === "function") Host.raise(code, message, {});
  throw new Error("LP_PLUGIN_ERROR:" + JSON.stringify({ code: code, message: message, context: {} }));
}
function _yt_json(text) { try { return JSON.parse(text); } catch (_) { return null; } }
function _yt_text(v) {
  if (typeof v === "string") return v;
  return v && (v.simpleText || (v.runs || []).map(function (r) {
    return r.text || (r.emoji && (r.emoji.shortcuts || [])[0]) || "";
  }).join("")) || "";
}
function _yt_thumb(v) { const a = v && v.thumbnails || []; return a.length ? a[a.length - 1].url : ""; }
function _yt_walk(root, key) {
  const found = [], stack = [root];
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (value[key]) found.push(value[key]);
    for (const k of Object.keys(value)) if (value[k] && typeof value[k] === "object") stack.push(value[k]);
  }
  return found;
}
// Parse embedded JSON without evaluating any upstream JavaScript.
function _yt_embedded(html, marker) {
  let offset = html.indexOf(marker);
  if (offset < 0) return null;
  offset = html.indexOf("{", offset + marker.length);
  let depth = 0, quoted = false, escaped = false;
  for (let i = offset; offset >= 0 && i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return _yt_json(html.slice(offset, i + 1));
  }
  return null;
}
function _yt_id(value) {
  const s = _yt_str(value).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  // Only recognize YouTube hosts; never request arbitrary share URLs.
  if (!/^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\//i.test(s)) return "";
  const match = s.match(/[?&]v=([\w-]{11})(?:[&#]|$)/) || s.match(/\/(?:live|embed|shorts)\/([\w-]{11})(?:[/?#]|$)/) || s.match(/youtu\.be\/([\w-]{11})(?:[/?#]|$)/);
  return match ? match[1] : "";
}
function _yt_requireID(value) { const id = _yt_id(value); if (!id) _yt_error("INVALID_ARGS", "請輸入 YouTube 影片直播分享連結或 11 位影片 ID"); return id; }
async function _yt_request(url, body, headers) {
  const response = await Host.http.request({ platformId: "youtube-tw", authMode: "none", request: {
    url: url, method: body === undefined ? "GET" : "POST", timeout: 20,
    headers: Object.assign({ "User-Agent": _yt_ua, "Accept-Language": "zh-TW,zh;q=0.9", Origin: _yt_base, Referer: _yt_base + "/", "Content-Type": "application/json" }, headers || {}),
    body: body === undefined ? null : JSON.stringify(body)
  } });
  if (!response || response.status < 200 || response.status >= 300) _yt_error(response && response.status === 429 ? "RATE_LIMITED" : "NETWORK", "YouTube 請求失敗（HTTP " + (response && response.status) + "）");
  return _yt_str(response.bodyText);
}
function _yt_context(cfg) {
  const context = JSON.parse(JSON.stringify(cfg.INNERTUBE_CONTEXT || { client: { clientName: "WEB", clientVersion: cfg.INNERTUBE_CLIENT_VERSION || "2.20260708.00.00" } }));
  context.client.hl = "zh-TW"; context.client.gl = "TW";
  return context;
}
async function _yt_api(method, cfg, payload) {
  const body = Object.assign({ context: _yt_context(cfg) }, payload);
  const result = _yt_json(await _yt_request(_yt_base + "/youtubei/v1/" + method + "?prettyPrint=false", body));
  if (!result || result.error) _yt_error("UPSTREAM", "YouTube API 暫時無法使用");
  return result;
}
function _yt_count(value) {
  const text = _yt_text(value).replace(/,/g, "");
  const match = text.match(/([\d.]+)\s*(億|万|萬|[KMB])?/i);
  return match ? Math.floor(Number(match[1]) * ({ "億": 1e8, "万": 1e4, "萬": 1e4, K: 1e3, M: 1e6, B: 1e9 }[(_yt_str(match[2])).toUpperCase()] || 1)) : 0;
}
function _yt_card(v) {
  const live = (v.badges || []).some(function (b) { return b.metadataBadgeRenderer && b.metadataBadgeRenderer.style === "BADGE_STYLE_TYPE_LIVE_NOW"; }) || _yt_walk(v.thumbnailOverlays, "thumbnailOverlayTimeStatusRenderer").some(function (t) { return t.style === "LIVE"; });
  if (!live || !_yt_id(v.videoId) || v.upcomingEventData) return null;
  const author = v.ownerText || v.longBylineText || v.shortBylineText;
  const endpoint = _yt_walk(author, "browseEndpoint")[0] || {};
  return { roomId: v.videoId, userId: endpoint.browseId || v.videoId, userName: _yt_text(author), roomTitle: _yt_text(v.title), roomCover: _yt_thumb(v.thumbnail), userHeadImg: _yt_thumb(((v.channelThumbnailSupportedRenderers || {}).channelThumbnailWithLinkRenderer || {}).thumbnail), liveState: "1", liveType: "youtube-tw", liveWatchedCount: String(_yt_count(v.viewCountText)), biz: "" };
}
async function _yt_search(query) {
  const cached = _yt_lists[query];
  if (cached && Date.now() - cached.at < 60000) return cached.rooms;
  const html = await _yt_request(_yt_base + "/results?search_query=" + encodeURIComponent(query) + "&sp=EgJAAQ%253D%253D&hl=zh-TW&gl=TW");
  let data = _yt_embedded(html, "var ytInitialData =") || _yt_embedded(html, 'window["ytInitialData"] =');
  if (!data) _yt_error("UPSTREAM", "YouTube 未返回公開直播列表，可能受地區或流量限制");
  const cfg = _yt_embedded(html, "ytcfg.set(") || {};
  const rooms = [], seen = Object.create(null), continuations = Object.create(null);
  for (let page = 0; page < 3; page++) {
    for (const v of _yt_walk(data, "videoRenderer")) {
      const room = _yt_card(v);
      if (room && !seen[room.roomId]) { seen[room.roomId] = true; rooms.push(room); }
    }
    const c = _yt_walk(data, "continuationCommand")[0];
    if (!c || !c.token || continuations[c.token] || page === 2) break;
    continuations[c.token] = true;
    try { data = await _yt_api("search", cfg, { continuation: c.token }); } catch (_) { break; }
  }
  rooms.sort(function (a, b) { return Number(b.liveWatchedCount) - Number(a.liveWatchedCount) || a.roomId.localeCompare(b.roomId); });
  _yt_lists[query] = { at: Date.now(), rooms: rooms };
  if (Object.keys(_yt_lists).length > 12) delete _yt_lists[Object.keys(_yt_lists)[0]];
  return rooms;
}
async function _yt_player(id) {
  // Public Android client offers muxed live HLS; never decipher DRM or request user credentials.
  const result = _yt_json(await _yt_request(_yt_base + "/youtubei/v1/player?prettyPrint=false", {
    context: { client: { clientName: "ANDROID", clientVersion: "21.26.364", androidSdkVersion: 30, hl: "zh-TW", gl: "TW" } }, videoId: id
  }));
  if (!result || result.error) _yt_error("UPSTREAM", "YouTube 播放接口未返回有效資料");
  const status = result.playabilityStatus || {};
  if (status.status !== "OK" && status.status !== "LIVE_STREAM_OFFLINE") _yt_error(status.status === "LOGIN_REQUIRED" ? "AUTH_REQUIRED" : "NOT_FOUND", _yt_str(status.reason) || "這個直播不支援免登入觀看");
  return result;
}
function _yt_room(id, p) {
  const v = p.videoDetails || {}, m = ((p.microformat || {}).playerMicroformatRenderer || {}).liveBroadcastDetails || {};
  return { roomId: id, userId: v.channelId || id, userName: v.author || "YouTube", roomTitle: v.title || id, roomCover: _yt_thumb(v.thumbnail), userHeadImg: "", liveState: v.isUpcoming ? "3" : (p.playabilityStatus || {}).status === "LIVE_STREAM_OFFLINE" ? "0" : v.isLive === true || m.isLiveNow === true ? "1" : "0", liveType: "youtube-tw", liveWatchedCount: "0", biz: "" };
}
function _yt_mediaURL(url) { return /^https:\/\/[a-z0-9.-]+\.googlevideo\.com\//i.test(_yt_str(url)); }
function _yt_quality(id, url, title, qn) {
  return { roomId: id, title: title, qn: qn, url: url, liveCodeType: "m3u8", liveType: "youtube-tw", userAgent: _yt_ua,
    headers: { "User-Agent": _yt_ua }, playbackHints: { streamFormat: "hlsLive", latencyMode: "standard", preferredEngines: ["avPlayer", "mePlayer"], isLive: true, requiresCustomSegmentLoader: false, selectionBehavior: "direct", startPositionSeconds: 0 } };
}
function _yt_next(root) {
  for (const kind of ["invalidationContinuationData", "timedContinuationData", "reloadContinuationData"]) {
    const data = _yt_walk(root, kind)[0];
    if (data && data.continuation) return { token: data.continuation, interval: Math.max(3000, Math.min(15000, Number(data.timeoutMs) || 5000)) };
  }
  return null;
}
function _yt_messages(session, root, initial) {
  const messages = [];
  for (const action of root.actions || []) {
    const item = (action.addChatItemAction || {}).item || (action.replaceChatItemAction || {}).replacementItem || {};
    const v = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer || item.liveChatMembershipItemRenderer;
    if (!v || !v.id || session.seen[v.id]) continue;
    session.seen[v.id] = true; session.order.push(v.id);
    const text = _yt_text(v.message || v.headerSubtext);
    if (text) messages.push({ text: text, nickname: _yt_text(v.authorName) || "YouTube" });
  }
  while (session.order.length > 2000) delete session.seen[session.order.shift()];
  return initial ? messages.slice(-20) : messages;
}
async function _yt_chatBoot(id) {
  const html = await _yt_request(_yt_base + "/watch?v=" + id + "&hl=zh-TW&gl=TW");
  const data = _yt_embedded(html, "var ytInitialData =") || {};
  const renderer = _yt_walk(data, "liveChatRenderer")[0];
  const reload = renderer && _yt_next(renderer.continuations);
  if (!reload) _yt_error("NOT_FOUND", "這個直播沒有可供匿名讀取的聊天室，或聊天室已關閉");
  const page = await _yt_request(_yt_base + "/live_chat?continuation=" + encodeURIComponent(reload.token));
  const initial = _yt_embedded(page, "var ytInitialData =") || _yt_embedded(page, 'window["ytInitialData"] =') || {};
  const chat = _yt_walk(initial, "liveChatContinuation")[0];
  const next = chat && _yt_next(chat.continuations);
  if (!next) _yt_error("UPSTREAM", "YouTube 聊天室初始化未成功，請稍後重試");
  return { cfg: _yt_embedded(page, "ytcfg.set(") || _yt_embedded(html, "ytcfg.set(") || {}, chat: chat, next: next };
}
function _yt_session(payload) { const s = _yt_sessions[_yt_str(payload.connectionId)]; if (!s) _yt_error("INVALID_ARGS", "聊天室連線已失效"); return s; }
function _yt_timer(session) { return { mode: "polling", intervalMs: session.interval }; }
globalThis.LiveParsePlugin = {
  apiVersion: 1,
  async getCategories() { return [{ id: "root", title: "YouTube 台灣直播", icon: "", biz: "", subList: Object.keys(_yt_queries).map(function (id) { return { id: id, parentId: "root", title: { all: "台灣推薦", news: "新聞", games: "遊戲", music: "音樂", scenery: "即時影像" }[id], icon: "", biz: "" }; }) }]; },
  async getRooms(payload) { const p = payload || {}, rooms = await _yt_search(_yt_queries[p.id] || _yt_queries.all); const start = (Math.max(1, Number(p.page) || 1) - 1) * 20; return rooms.slice(start, start + 20); },
  async search(payload) {
    const p = payload || {}, keyword = _yt_str(p.keyword).trim();
    if (!keyword) _yt_error("INVALID_ARGS", "請輸入搜尋文字或直播連結");
    const id = _yt_id(keyword);
    if (id) return Number(p.page) > 1 ? [] : [_yt_room(id, await _yt_player(id))];
    const rooms = await _yt_search(keyword), start = (Math.max(1, Number(p.page) || 1) - 1) * 20;
    return rooms.slice(start, start + 20);
  },
  async resolveShare(payload) { const id = _yt_requireID(payload.shareCode); return _yt_room(id, await _yt_player(id)); },
  async getRoomDetail(payload) { const id = _yt_requireID(payload.roomId); return _yt_room(id, await _yt_player(id)); },
  async getLiveState(payload) { const id = _yt_requireID(payload.roomId); return _yt_room(id, await _yt_player(id)).liveState; },
  async getPlayback(payload) {
    const id = _yt_requireID(payload.roomId), player = await _yt_player(id);
    if (_yt_room(id, player).liveState !== "1") _yt_error("NOT_FOUND", "直播尚未開始或已結束；本插件不播放回放");
    const url = (player.streamingData || {}).hlsManifestUrl;
    if (!_yt_mediaURL(url)) _yt_error("BLOCKED", "YouTube 未提供免登入 HLS；此直播或目前網路出口暫不支援");
    const manifest = await _yt_request(url);
    if (!manifest.trim().startsWith("#EXTM3U")) _yt_error("UPSTREAM", "YouTube HLS 清單無效");
    const qualities = [_yt_quality(id, url, "HLS 自動畫質", 10000)], seen = Object.create(null), lines = manifest.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
      const resolution = lines[i].match(/RESOLUTION=\d+x(\d+)/), height = resolution ? Number(resolution[1]) : 0;
      const media = lines[i + 1].trim();
      if (!_yt_mediaURL(media) || seen[media]) continue;
      seen[media] = true; qualities.push(_yt_quality(id, media, height ? "HLS " + height + "p" : "HLS", height));
    }
    qualities.sort(function (a, b) { return b.qn - a.qn; });
    return [{ cdn: "YouTube", displayName: "YouTube 公開直播", requestContext: { roomId: id }, qualitys: qualities }];
  },
  async getDanmaku(payload) { const id = _yt_requireID(payload.roomId); return { args: { roomId: id, _danmu_type: "http_polling" }, headers: {}, transport: { kind: "http_polling", url: _yt_base + "/youtubei/v1/live_chat/get_live_chat", polling: { intervalMs: 5000, method: "POST", sendOnConnect: false } }, runtime: { driver: "plugin_js_v1", protocolId: "youtube_live_chat", protocolVersion: "1" } }; },
  async createDanmakuSession(payload) {
    const key = _yt_str(payload.connectionId), id = _yt_requireID(payload.roomId || (payload.args || {}).roomId);
    if (!key) _yt_error("INVALID_ARGS", "缺少聊天室 connectionId");
    const boot = await _yt_chatBoot(id), session = { id: id, cfg: boot.cfg, token: boot.next.token, interval: boot.next.interval, seen: Object.create(null), order: [], busy: false };
    _yt_sessions[key] = session;
    return { ok: true, messages: _yt_messages(session, boot.chat, true), timer: _yt_timer(session) };
  },
  async onDanmakuOpen(payload) { return { ok: true, timer: _yt_timer(_yt_session(payload)) }; },
  async onDanmakuTick(payload) {
    const session = _yt_session(payload);
    if (session.busy) return { ok: true, timer: _yt_timer(session) };
    session.busy = true;
    try {
      const result = await _yt_api("live_chat/get_live_chat", session.cfg, { continuation: session.token });
      const chat = (result.continuationContents || {}).liveChatContinuation;
      const next = chat && _yt_next(chat.continuations);
      if (!chat || !next) _yt_error("UPSTREAM", "YouTube 聊天室已結束或連線失效，請重新進入直播間");
      session.token = next.token; session.interval = next.interval;
      return { ok: true, messages: _yt_messages(session, chat, false), timer: _yt_timer(session) };
    } finally { session.busy = false; }
  },
  async onDanmakuFrame(payload) { return { ok: true, messages: [], timer: _yt_timer(_yt_session(payload)) }; },
  async destroyDanmakuSession(payload) { delete _yt_sessions[_yt_str(payload.connectionId)]; return { ok: true }; }
};
