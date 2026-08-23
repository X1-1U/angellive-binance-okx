const _bn_platformId = "binance";
const _bn_liveType = "binance";
const _bn_baseURL = "https://www.binance.com";
const _bn_ua =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const _bn_pageSize = 20;

function _bn_throw(code, message, context) {
  if (globalThis.Host && typeof Host.raise === "function") {
    Host.raise(code, message, context || {});
  }
  if (globalThis.Host && typeof Host.makeError === "function") {
    throw Host.makeError(code || "UNKNOWN", message || "", context || {});
  }
  throw new Error(
    "LP_PLUGIN_ERROR:" +
      JSON.stringify({
        code: String(code || "UNKNOWN"),
        message: String(message || ""),
        context: context || {}
      })
  );
}

function _bn_str(value) {
  return value === undefined || value === null ? "" : String(value);
}

function _bn_num(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _bn_object(value) {
  return value && typeof value === "object" ? value : {};
}

function _bn_payload(value) {
  return value && typeof value === "object" ? Object.assign({}, value) : {};
}

function _bn_parseJSON(text) {
  try {
    return JSON.parse(_bn_str(text));
  } catch (_) {
    return null;
  }
}

function _bn_message(data) {
  const object = _bn_object(data);
  return _bn_str(object.message || object.messageDetail || object.msg || "Binance API error");
}

async function _bn_http(request) {
  if (!globalThis.Host || !Host.http || typeof Host.http.request !== "function") {
    _bn_throw("RUNTIME", "Host.http.request is unavailable", {});
  }

  const req = _bn_object(request);
  const response = await Host.http.request({
    platformId: _bn_platformId,
    authMode: "none",
    request: {
      url: _bn_str(req.url),
      method: _bn_str(req.method || "GET").toUpperCase(),
      headers: Object.assign(
        {
          Accept: "application/json, text/plain, */*",
          "User-Agent": _bn_ua,
          clienttype: "web",
          lang: "en",
          Referer: "https://www.binance.com/en/square",
          Origin: "https://www.binance.com"
        },
        _bn_object(req.headers)
      ),
      body: req.body === undefined ? null : _bn_str(req.body),
      timeout: _bn_num(req.timeout, 20)
    }
  });

  const status = _bn_num(response && response.status, 0);
  if (status < 200 || status >= 300) {
    _bn_throw("HTTP", `Binance HTTP ${status || "error"}`, {
      status: status,
      url: _bn_str(response && response.url) || _bn_str(req.url)
    });
  }
  return response || {};
}

async function _bn_requestJSON(request) {
  const response = await _bn_http(request);
  const parsed = _bn_parseJSON(response.bodyText);
  if (!parsed || typeof parsed !== "object") {
    _bn_throw("INVALID_RESPONSE", "Binance returned an invalid JSON response", {
      url: _bn_str(response.url)
    });
  }

  const code = _bn_str(parsed.code);
  if (parsed.success === false || (code && code !== "000000" && code !== "0")) {
    _bn_throw("API", _bn_message(parsed), { code: code });
  }
  return parsed;
}

function _bn_decode(value) {
  try {
    return decodeURIComponent(_bn_str(value));
  } catch (_) {
    return _bn_str(value);
  }
}

function _bn_parseRoomId(input) {
  const source = _bn_decode(_bn_str(input).trim());
  if (/^\d{6,}$/.test(source)) return source;

  const patterns = [
    /(?:square\/audio(?:\/replay)?[^#]*[?&]id=)(\d{6,})/i,
    /(?:content\/audiospace[^#]*[?&]id=)(\d{6,})/i,
    /(?:uni-qr\/(?:cspa|cspr)\/)(\d{6,})/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}

function _bn_parsePostId(input) {
  const source = _bn_decode(_bn_str(input));
  const match = source.match(/(?:binance\.com\/[^/]+\/square\/post\/|binance\.com\/square\/post\/)(\d{6,})/i);
  return match && match[1] ? match[1] : "";
}

function _bn_pickId(item) {
  const object = _bn_object(item);
  return _bn_str(object.contentId || object.id || object.liveId || object.roomId);
}

function _bn_pickAuthor(item) {
  const object = _bn_object(item);
  return _bn_object(object.userInfo || object.contentAuthor || object.author || object.hostInfo);
}

function _bn_pickReplayURL(item) {
  const object = _bn_object(item);
  return _bn_str(
    object.replayUrl ||
      object.spaceLiveReplayLink ||
      object.liveReplayUrl ||
      object.replayURL
  ).trim();
}

function _bn_pickPlayURLs(item) {
  const object = _bn_object(item);
  const play = _bn_object(object.playUrls || object.livePullUrls || object.pullUrls);
  return {
    hls: _bn_str(
      play.hlsPlayUrl || play.hlsUrl || play.hls || object.hlsPlayUrl || object.hlsUrl
    ).trim(),
    flv: _bn_str(
      play.flvPlayUrl || play.flvUrl || play.flv || object.flvPlayUrl || object.flvUrl
    ).trim()
  };
}

function _bn_liveState(item, forceLive) {
  if (forceLive) return "1";
  const object = _bn_object(item);
  const raw = _bn_num(
    object.liveStatus !== undefined ? object.liveStatus : object.status,
    -1
  );
  if (raw === 1) return "1";
  if (raw === 2 && _bn_pickReplayURL(object)) return "2";
  if (raw === 2) return "0";
  if (raw === 0 || raw === 4) return "3";
  if (raw === 3) return "0";
  if (_bn_num(object.streamStatus, 0) === 1) return "1";
  if (_bn_num(object.liveScheduledTime, 0) > Date.now()) return "3";
  return raw < 0 ? "3" : "0";
}

function _bn_room(item, forceLive) {
  const object = _bn_object(item);
  const nested = _bn_object(object.liveVO || object.spaceLive || object.liveInfo);
  const value = Object.keys(nested).length ? Object.assign({}, object, nested) : object;
  const author = _bn_pickAuthor(value);
  const roomId = _bn_pickId(value);
  const userName = _bn_str(
    author.displayName ||
      author.nickName ||
      author.nickname ||
      value.displayName ||
      value.authorName ||
      author.userName ||
      value.username ||
      "Binance Square"
  );
  return {
    userName: userName,
    roomTitle: _bn_str(value.title || value.liveTitle || value.roomTitle || "Binance Square Live"),
    roomCover: _bn_str(value.cover || value.coverUrl || value.thumbnail || value.roomCover),
    userHeadImg: _bn_str(author.avatar || author.portrait || value.avatar || value.userHeadImg),
    liveType: _bn_liveType,
    liveState: _bn_liveState(value, forceLive),
    userId: _bn_str(author.squareUid || author.userId || value.squareUid || value.userId),
    roomId: roomId,
    liveWatchedCount: _bn_str(
      value.onlineCount || value.viewCount || value.viewerCount || value.liveWatchedCount || 0
    ),
    biz: _bn_str(value.liveType || value.contentType)
  };
}

async function _bn_fetchLiveList() {
  const result = await _bn_requestJSON({
    url: `${_bn_baseURL}/bapi/composite/v1/friendly/pgc/feed/audio-live-recommend/list`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene: "web-homepage" })
  });
  const data = _bn_object(result.data);
  const list = data.spaceLiveList || data.liveList || data.list || [];
  return Array.isArray(list) ? list : [];
}

async function _bn_fetchRoomDetail(roomId) {
  const id = _bn_parseRoomId(roomId);
  if (!id) _bn_throw("INVALID_ARGS", "A Binance Square content ID is required", { roomId: roomId });

  const result = await _bn_requestJSON({
    url: `${_bn_baseURL}/bapi/square/v2/friendly/square-live/space/room-detail?contentId=${encodeURIComponent(id)}`
  });
  const data = _bn_object(result.data);
  if (!_bn_pickId(data)) data.contentId = id;
  return data;
}

async function _bn_fetchContentDetail(contentId) {
  const id = _bn_str(contentId);
  const result = await _bn_requestJSON({
    url: `${_bn_baseURL}/bapi/composite/v3/friendly/pgc/content/${encodeURIComponent(id)}`
  });
  const data = _bn_object(result.data);
  if (!_bn_pickId(data)) data.id = id;
  return data;
}

async function _bn_detailWithFallback(roomId) {
  try {
    return await _bn_fetchRoomDetail(roomId);
  } catch (error) {
    return await _bn_fetchContentDetail(_bn_parseRoomId(roomId));
  }
}

function _bn_quality(url, title, qn, format, isLive) {
  return {
    roomId: "",
    title: title,
    qn: qn,
    url: url,
    liveCodeType: format,
    liveType: _bn_liveType,
    userAgent: _bn_ua,
    headers: {
      "User-Agent": _bn_ua,
      Referer: "https://www.binance.com/",
      Origin: "https://www.binance.com"
    },
    playbackHints: {
      streamFormat: format === "flv" ? "flv" : isLive ? "hlsLive" : "hlsVod",
      latencyMode: isLive ? "normal" : "vod",
      preferredEngines: format === "flv" ? ["ijk", "mpv"] : ["avplayer", "mpv"],
      isLive: !!isLive,
      requiresCustomSegmentLoader: false,
      selectionBehavior: "direct",
      startPositionSeconds: 0
    }
  };
}

function _bn_addQuality(list, seen, url, title, qn, format, isLive, roomId) {
  const normalized = _bn_str(url).trim();
  if (!normalized || seen[normalized]) return;
  seen[normalized] = true;
  const item = _bn_quality(normalized, title, qn, format, isLive);
  item.roomId = _bn_str(roomId);
  list.push(item);
}

async function _bn_resolveRoomFromShare(shareCode) {
  const directId = _bn_parseRoomId(shareCode);
  if (directId) return await _bn_detailWithFallback(directId);

  const postId = _bn_parsePostId(shareCode);
  if (postId) {
    const post = await _bn_fetchContentDetail(postId);
    const quoted = _bn_object(post.quoteContent || post.referencedContent);
    const targetId = _bn_pickId(quoted) || (post.extraFeature === "SPACE_LIVE" ? _bn_pickId(post) : "");
    if (targetId) return await _bn_detailWithFallback(targetId);
  }

  const source = _bn_str(shareCode).trim();
  if (/^https?:\/\//i.test(source) && /binance\.com/i.test(source)) {
    const response = await _bn_http({
      url: source,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const redirectedId = _bn_parseRoomId(response.url);
    if (redirectedId) return await _bn_detailWithFallback(redirectedId);
    const html = _bn_str(response.bodyText);
    const match = html.match(/(?:contentId|\"id\")\D{0,24}(\d{6,})/i);
    if (match && match[1]) return await _bn_detailWithFallback(match[1]);
  }

  _bn_throw("PARSE", "Cannot parse this Binance Square live link", { shareCode: source });
}

globalThis.LiveParsePlugin = {
  apiVersion: 1,

  async getCategories() {
    return [
      {
        id: "root",
        title: "Binance Square Live",
        icon: "",
        biz: "",
        subList: [
          {
            id: "all",
            parentId: "root",
            title: "全部直播",
            icon: "",
            biz: ""
          }
        ]
      }
    ];
  },

  async getRooms(payload) {
    const runtimePayload = _bn_payload(payload);
    const page = Math.max(1, _bn_num(runtimePayload.page, 1));
    if (page > 1) return [];
    const list = await _bn_fetchLiveList();
    return list.map(function (item) {
      return _bn_room(item, true);
    }).filter(function (item) {
      return !!item.roomId;
    });
  },

  async getPlayback(payload) {
    const runtimePayload = _bn_payload(payload);
    const roomId = _bn_parseRoomId(runtimePayload.roomId || runtimePayload.userId);
    if (!roomId) _bn_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });

    const detail = await _bn_detailWithFallback(roomId);
    const state = _bn_liveState(detail, false);
    const qualities = [];
    const seen = {};

    if (state === "1") {
      const play = _bn_pickPlayURLs(detail);
      _bn_addQuality(qualities, seen, play.hls, "HLS 原畫", 10000, "m3u8", true, roomId);
      _bn_addQuality(qualities, seen, play.flv, "FLV 原畫", 9000, "flv", true, roomId);
    } else if (state === "2") {
      const replayURL = _bn_pickReplayURL(detail);
      if (/\.m3u8(?:[?#]|$)/i.test(replayURL)) {
        _bn_addQuality(qualities, seen, replayURL, "HLS 回放", 10000, "m3u8", false, roomId);
      } else if (replayURL) {
        _bn_throw("UNSUPPORTED", "This Binance replay is not available as HLS", {
          roomId: roomId,
          replayURL: replayURL
        });
      }
    }

    if (!qualities.length) {
      _bn_throw("OFFLINE", "This Binance Square live room is offline or has no playable stream", {
        roomId: roomId,
        liveState: state
      });
    }

    return [
      {
        cdn: "Binance",
        displayName: "Binance CDN",
        requestContext: { roomId: roomId },
        qualitys: qualities
      }
    ];
  },

  async search(payload) {
    const runtimePayload = _bn_payload(payload);
    const keyword = _bn_str(runtimePayload.keyword).trim();
    const page = Math.max(1, _bn_num(runtimePayload.page, 1));
    if (!keyword) _bn_throw("INVALID_ARGS", "keyword is required", { field: "keyword" });
    if (page > 1) return [];

    const roomId = _bn_parseRoomId(keyword);
    if (roomId) return [_bn_room(await _bn_detailWithFallback(roomId), false)];

    const lower = keyword.toLowerCase();
    const list = await _bn_fetchLiveList();
    return list.map(function (item) {
      return _bn_room(item, true);
    }).filter(function (item) {
      return (
        item.roomTitle.toLowerCase().indexOf(lower) >= 0 ||
        item.userName.toLowerCase().indexOf(lower) >= 0
      );
    });
  },

  async getRoomDetail(payload) {
    const runtimePayload = _bn_payload(payload);
    const roomId = _bn_parseRoomId(runtimePayload.roomId || runtimePayload.userId);
    if (!roomId) _bn_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
    return _bn_room(await _bn_detailWithFallback(roomId), false);
  },

  async getLiveState(payload) {
    const runtimePayload = _bn_payload(payload);
    const roomId = _bn_parseRoomId(runtimePayload.roomId || runtimePayload.userId);
    if (!roomId) _bn_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
    const detail = await _bn_detailWithFallback(roomId);
    return { liveState: _bn_liveState(detail, false) };
  },

  async resolveShare(payload) {
    const runtimePayload = _bn_payload(payload);
    const shareCode = _bn_str(runtimePayload.shareCode).trim();
    if (!shareCode) _bn_throw("INVALID_ARGS", "shareCode is required", { field: "shareCode" });
    return _bn_room(await _bn_resolveRoomFromShare(shareCode), false);
  }
};
