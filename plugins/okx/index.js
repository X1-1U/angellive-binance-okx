const _ok_platformId = "okx";
const _ok_liveType = "okx";
const _ok_baseURL = "https://www.okx.com";
const _ok_pageSize = 20;
const _ok_ua =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const _ok_cacheTTL = 30 * 1000;
const _ok_runtime = {
  rooms: {},
  firstPage: [],
  firstPageFetchedAt: 0
};

function _ok_throw(code, message, context) {
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

function _ok_str(value) {
  return value === undefined || value === null ? "" : String(value);
}

function _ok_num(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function _ok_object(value) {
  return value && typeof value === "object" ? value : {};
}

function _ok_payload(value) {
  return value && typeof value === "object" ? Object.assign({}, value) : {};
}

function _ok_parseJSON(text) {
  try {
    return JSON.parse(_ok_str(text));
  } catch (_) {
    return null;
  }
}

function _ok_decode(value) {
  try {
    return decodeURIComponent(_ok_str(value));
  } catch (_) {
    return _ok_str(value);
  }
}

async function _ok_requestJSON(url) {
  if (!globalThis.Host || !Host.http || typeof Host.http.request !== "function") {
    _ok_throw("RUNTIME", "Host.http.request is unavailable", {});
  }
  const response = await Host.http.request({
    platformId: _ok_platformId,
    authMode: "none",
    request: {
      url: url,
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": _ok_ua,
        Referer: "https://www.okx.com/orbit/livestreams"
      },
      timeout: 20
    }
  });
  const status = _ok_num(response && response.status, 0);
  if (status < 200 || status >= 300) {
    _ok_throw("HTTP", `OKX HTTP ${status || "error"}`, {
      status: status,
      url: _ok_str(response && response.url) || url
    });
  }

  const parsed = _ok_parseJSON(response && response.bodyText);
  if (!parsed || typeof parsed !== "object") {
    _ok_throw("INVALID_RESPONSE", "OKX returned an invalid JSON response", { url: url });
  }
  if (_ok_str(parsed.code) !== "0") {
    _ok_throw("API", _ok_str(parsed.msg || parsed.message || "OKX API error"), {
      code: _ok_str(parsed.code)
    });
  }
  return parsed;
}

function _ok_parseShareCode(input) {
  const source = _ok_decode(_ok_str(input).trim());
  if (/^[A-Za-z0-9_-]{6,100}$/.test(source)) return source;
  const match = source.match(/[?&]shareCode=([^&#]+)/i);
  if (!match || !match[1]) return "";
  const code = _ok_decode(match[1]);
  return /^[A-Za-z0-9_-]{6,100}$/.test(code) ? code : "";
}

function _ok_room(item) {
  const object = _ok_object(item);
  const live = _ok_object(object.livestream || object.liveStream || object.live);
  const shareCode = _ok_str(live.shareCode || object.shareCode);
  return {
    userName: _ok_str(object.nickname || object.nickName || object.displayName || "OKX Orbit"),
    roomTitle: _ok_str(live.title || object.title || "OKX Orbit Live"),
    roomCover: _ok_str(live.thumbnail || object.thumbnail || object.cover),
    userHeadImg: _ok_str(object.portrait || object.avatar),
    liveType: _ok_liveType,
    liveState: "1",
    userId: _ok_str(object.authorId || object.userUid || object.userId),
    roomId: shareCode,
    liveWatchedCount: _ok_str(live.viewerCount || object.viewerCount || 0),
    biz: _ok_str(object.officialStatus)
  };
}

function _ok_fallbackRoom(shareCode, state) {
  return {
    userName: "OKX Orbit",
    roomTitle: "OKX Orbit 直播",
    roomCover: "",
    userHeadImg: "",
    liveType: _ok_liveType,
    liveState: state || "0",
    userId: "",
    roomId: _ok_str(shareCode),
    liveWatchedCount: "0",
    biz: ""
  };
}

function _ok_remember(rooms) {
  for (const room of rooms) {
    if (room && room.roomId) _ok_runtime.rooms[room.roomId] = room;
  }
  return rooms;
}

async function _ok_fetchRooms(page) {
  const index = Math.max(0, _ok_num(page, 1) - 1);
  if (
    index === 0 &&
    _ok_runtime.firstPageFetchedAt > 0 &&
    Date.now() - _ok_runtime.firstPageFetchedAt < _ok_cacheTTL
  ) {
    return _ok_runtime.firstPage.slice();
  }
  const result = await _ok_requestJSON(
    `${_ok_baseURL}/priapi/v5/content/public/livestream/users-all?pageIndex=${index}&pageSize=${_ok_pageSize}`
  );
  const data = _ok_object(result.data);
  const users = Array.isArray(data.users) ? data.users : [];
  const rooms = users.map(_ok_room).filter(function (room) {
    return !!room.roomId;
  });
  if (index === 0) {
    _ok_runtime.rooms = {};
    _ok_runtime.firstPage = rooms.slice();
    _ok_runtime.firstPageFetchedAt = Date.now();
  }
  return _ok_remember(rooms);
}

async function _ok_findCurrentRoom(shareCode) {
  const code = _ok_parseShareCode(shareCode);
  if (!code) _ok_throw("INVALID_ARGS", "A valid OKX livestream shareCode is required", {});
  const rooms = await _ok_fetchRooms(1);
  for (const room of rooms) {
    if (room.roomId === code) return room;
  }
  return null;
}

function _ok_externalURL(shareCode) {
  return `${_ok_baseURL}/livestream/stream-room?shareCode=${encodeURIComponent(shareCode)}`;
}

globalThis.LiveParsePlugin = {
  apiVersion: 1,

  async getCategories() {
    return [
      {
        id: "root",
        title: "OKX Orbit Live",
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
    const runtimePayload = _ok_payload(payload);
    const page = Math.max(1, _ok_num(runtimePayload.page, 1));
    return await _ok_fetchRooms(page);
  },

  async getPlayback(payload) {
    const runtimePayload = _ok_payload(payload);
    const shareCode = _ok_parseShareCode(runtimePayload.roomId || runtimePayload.userId);
    if (!shareCode) _ok_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
    _ok_throw(
      "UNSUPPORTED",
      "OKX currently requires an authenticated official Stream Room and exposes no stable public media URL",
      {
        roomId: shareCode,
        externalURL: _ok_externalURL(shareCode)
      }
    );
  },

  async search(payload) {
    const runtimePayload = _ok_payload(payload);
    const keyword = _ok_str(runtimePayload.keyword).trim();
    const page = Math.max(1, _ok_num(runtimePayload.page, 1));
    if (!keyword) _ok_throw("INVALID_ARGS", "keyword is required", { field: "keyword" });
    if (page > 1) return [];

    const shareCode = _ok_parseShareCode(keyword);
    if (shareCode) {
      const found = await _ok_findCurrentRoom(shareCode);
      return [found || _ok_fallbackRoom(shareCode, "0")];
    }

    const lower = keyword.toLowerCase();
    const rooms = await _ok_fetchRooms(1);
    return rooms.filter(function (room) {
      return (
        room.roomTitle.toLowerCase().indexOf(lower) >= 0 ||
        room.userName.toLowerCase().indexOf(lower) >= 0
      );
    });
  },

  async getRoomDetail(payload) {
    const runtimePayload = _ok_payload(payload);
    const shareCode = _ok_parseShareCode(runtimePayload.roomId || runtimePayload.userId);
    if (!shareCode) _ok_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
    return (await _ok_findCurrentRoom(shareCode)) || _ok_fallbackRoom(shareCode, "0");
  },

  async getLiveState(payload) {
    const runtimePayload = _ok_payload(payload);
    const shareCode = _ok_parseShareCode(runtimePayload.roomId || runtimePayload.userId);
    if (!shareCode) _ok_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
    return { liveState: (await _ok_findCurrentRoom(shareCode)) ? "1" : "0" };
  },

  async resolveShare(payload) {
    const runtimePayload = _ok_payload(payload);
    const shareCode = _ok_parseShareCode(runtimePayload.shareCode);
    if (!shareCode) {
      _ok_throw("PARSE", "Cannot parse this OKX livestream link", {
        shareCode: _ok_str(runtimePayload.shareCode)
      });
    }
    return (await _ok_findCurrentRoom(shareCode)) || _ok_fallbackRoom(shareCode, "0");
  }
};
