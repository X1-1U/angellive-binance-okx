const _ok_platformId = "okx";
const _ok_liveType = "okx";
const _ok_baseURL = "https://www.okx.com";
const _ok_pageSize = 20;
const _ok_probePageSizes = [10, 7, 5, 3, 2, 1];
const _ok_roomPageSize = 50;
const _ok_ua =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const _ok_cacheTTL = 30 * 1000;
const _ok_discoveryTTL = 6 * 60 * 60 * 1000;
const _ok_staleValidationLimit = 20;
const _ok_danmakuHeartbeatMs = 5000;
const _ok_runtime = {
  rooms: {},
  roomSeenAt: {},
  liveRooms: [],
  liveRoomsFetchedAt: 0,
  deviceId: "",
  anonymousToken: "",
  anonymousUid: "",
  anonymousTokenFetchedAt: 0,
  danmakuSessions: {}
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

async function _ok_requestJSON(request) {
  if (!globalThis.Host || !Host.http || typeof Host.http.request !== "function") {
    _ok_throw("UNKNOWN", "Host.http.request is unavailable", {});
  }
  const req = typeof request === "string" ? { url: request } : _ok_object(request);
  const response = await Host.http.request({
    platformId: _ok_platformId,
    authMode: "none",
    request: {
      url: _ok_str(req.url),
      method: _ok_str(req.method || "GET").toUpperCase(),
      headers: Object.assign(
        {
          Accept: "application/json, text/plain, */*",
          "User-Agent": _ok_ua,
          Referer: "https://www.okx.com/orbit/livestreams",
          Origin: "https://www.okx.com"
        },
        _ok_object(req.headers)
      ),
      body: req.body === undefined ? null : _ok_str(req.body),
      timeout: 20
    }
  });
  const status = _ok_num(response && response.status, 0);
  if (status < 200 || status >= 300) {
    const code = status === 429 ? "RATE_LIMITED" : status === 401 ? "AUTH_REQUIRED" : status === 403 ? "BLOCKED" : "NETWORK";
    _ok_throw(code, `OKX HTTP ${status || "error"}`, {
      status: status,
      url: _ok_str(response && response.url) || _ok_str(req.url)
    });
  }

  const parsed = _ok_parseJSON(response && response.bodyText);
  if (!parsed || typeof parsed !== "object") {
    _ok_throw("INVALID_RESPONSE", "OKX returned an invalid JSON response", { url: _ok_str(req.url) });
  }
  if (_ok_str(parsed.code) !== "0") {
    const apiCode = _ok_str(parsed.code);
    _ok_throw(apiCode === "401" ? "AUTH_REQUIRED" : apiCode === "429" ? "RATE_LIMITED" : "UPSTREAM", _ok_str(parsed.msg || parsed.message || "OKX API error"), {
      code: _ok_str(parsed.code)
    });
  }
  return parsed;
}

function _ok_parseShareCode(input) {
  const source = _ok_decode(_ok_str(input).trim());
  if (/^[A-Za-z0-9_-]{8,80}-\d+$/.test(source)) return source;
  const match = source.match(/[?&]shareCode=([^&#]+)/i);
  if (!match || !match[1]) return "";
  const code = _ok_decode(match[1]);
  return /^[A-Za-z0-9_-]{8,80}-\d+$/.test(code) ? code : "";
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
    liveWatchedCount: _ok_str(_ok_viewers(live.viewerCount, object.viewerCount)),
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

function _ok_roomFromStatus(shareCode, status) {
  const room = _ok_fallbackRoom(shareCode, _ok_statusLiveState(status));
  const object = _ok_object(status);
  room.biz = _ok_str(object.channelId);
  return room;
}

function _ok_applyFreshStatus(room, shareCode, status) {
  const output = Object.assign(
    {},
    room || _ok_fallbackRoom(shareCode, _ok_statusLiveState(status))
  );
  output.roomId = _ok_str(shareCode);
  output.liveState = _ok_statusLiveState(status);
  const channelId = _ok_str(_ok_object(status).channelId);
  if (channelId) output.biz = channelId;
  return _ok_rememberOne(output);
}

function _ok_statusLiveState(status) {
  const object = _ok_object(status);
  const code = _ok_num(object.status, -1);
  if (code === 1) return "1";
  if (code === 0 || code === 2) return "3";
  if (code === 3 && (object.allowRecording === true || _ok_num(object.allowRecording, 0) === 1)) {
    return "2";
  }
  return "0";
}

function _ok_remember(rooms, seenAt) {
  const timestamp = seenAt || Date.now();
  for (const room of rooms) {
    if (room && room.roomId) {
      _ok_runtime.rooms[room.roomId] = room;
      _ok_runtime.roomSeenAt[room.roomId] = timestamp;
    }
  }
  return rooms;
}

function _ok_rememberOne(room) {
  _ok_remember(room ? [room] : []);
  return room;
}

async function _ok_fetchDirectoryPage(index, pageSize) {
  const result = await _ok_requestJSON(
    `${_ok_baseURL}/priapi/v5/content/public/livestream/users-all?pageIndex=${Math.max(0, _ok_num(index, 0))}&pageSize=${Math.max(1, _ok_num(pageSize, _ok_pageSize))}`
  );
  const data = _ok_object(result.data);
  return {
    total: Math.max(0, _ok_num(data.total, 0)),
    users: Array.isArray(data.users) ? data.users : []
  };
}

function _ok_viewers() {
  for (const count of arguments) {
    if (count === null || count === undefined || count === "") continue;
    const number = Number(String(count).replace(/,/g, ""));
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

function _ok_dedupeRooms(users) {
  const seen = {};
  const rooms = [];
  for (const user of users) {
    const room = _ok_room(user);
    if (!room.roomId || seen[room.roomId]) continue;
    seen[room.roomId] = true;
    rooms.push(room);
  }
  rooms.sort(function (left, right) {
    return _ok_num(right.liveWatchedCount, 0) - _ok_num(left.liveWatchedCount, 0);
  });
  return rooms;
}

let _ok_liveRoomsPending = null;
async function _ok_fetchAllRooms() {
  if (_ok_liveRoomsPending) return (await _ok_liveRoomsPending).slice();
  _ok_liveRoomsPending = _ok_loadAllRooms();
  try { return (await _ok_liveRoomsPending).slice(); }
  finally { _ok_liveRoomsPending = null; }
}

async function _ok_loadAllRooms() {
  if (
    _ok_runtime.liveRoomsFetchedAt > 0 &&
    Date.now() - _ok_runtime.liveRoomsFetchedAt < _ok_cacheTTL
  ) {
    return _ok_runtime.liveRooms.slice();
  }

  const primary = await _ok_fetchDirectoryPage(0, _ok_pageSize);
  const users = primary.users.slice();
  if (primary.total > 0) {
    const probes = [];
    // 補齊主目錄後續頁，再交叉取樣。
    const primaryPages = Math.min(30, Math.ceil(primary.total / _ok_pageSize));
    for (let index = 1; index < primaryPages; index += 1) {
      probes.push({ index: index, pageSize: _ok_pageSize });
    }
    // 此接口的 total 會包含重複位置，而且不同 pageSize 的切片不完全一致；交叉取樣後再以 shareCode 合併。
    for (const pageSize of _ok_probePageSizes) {
      const probePages = Math.min(20, Math.ceil(primary.total / pageSize));
      for (let index = 0; index < probePages; index += 1) {
        probes.push({ index: index, pageSize: pageSize });
      }
    }
    // 限制同時請求數，避免大量收藏刷新時觸發上游限流。
    for (let offset = 0; offset < probes.length; offset += 4) {
      const batches = await Promise.all(probes.slice(offset, offset + 4).map(function (probe) {
        return _ok_fetchDirectoryPage(probe.index, probe.pageSize).catch(function () {
          return { users: [] };
        });
      }));
      for (const batch of batches) users.push.apply(users, batch.users);
    }
  }

  const now = Date.now();
  const rooms = _ok_dedupeRooms(users);
  const currentIds = {};
  for (const room of rooms) currentIds[room.roomId] = true;
  _ok_remember(rooms, now);

  // 保留最近從目錄或分享地址發現的房間，但逐一向官方狀態接口確認仍在直播。
  const candidates = Object.keys(_ok_runtime.rooms).filter(function (shareCode) {
    const age = now - _ok_num(_ok_runtime.roomSeenAt[shareCode], 0);
    if (age > _ok_discoveryTTL) {
      delete _ok_runtime.rooms[shareCode];
      delete _ok_runtime.roomSeenAt[shareCode];
      return false;
    }
    return !currentIds[shareCode];
  }).slice(0, _ok_staleValidationLimit);
  const statuses = await Promise.all(candidates.map(async function (shareCode) {
    try {
      return await _ok_fetchStatus(shareCode);
    } catch (_) {
      return null;
    }
  }));
  for (let index = 0; index < candidates.length; index += 1) {
    const shareCode = candidates[index];
    const status = statuses[index];
    if (status && _ok_statusLiveState(status) === "1") {
      const room = Object.assign({}, _ok_runtime.rooms[shareCode], { liveState: "1" });
      rooms.push(room);
      _ok_rememberOne(room);
    } else {
      delete _ok_runtime.rooms[shareCode];
      delete _ok_runtime.roomSeenAt[shareCode];
    }
  }
  rooms.sort(function (left, right) {
    return _ok_num(right.liveWatchedCount, 0) - _ok_num(left.liveWatchedCount, 0);
  });
  _ok_runtime.liveRooms = rooms.slice();
  _ok_runtime.liveRoomsFetchedAt = Date.now();
  return rooms;
}

function _ok_makeDeviceId() {
  if (_ok_runtime.deviceId) return _ok_runtime.deviceId;
  const segment = function (length) {
    let value = "";
    while (value.length < length) value += Math.floor(Math.random() * 0x100000000).toString(16);
    return value.slice(0, length);
  };
  _ok_runtime.deviceId = [segment(8), segment(4), "4" + segment(3), "a" + segment(3), segment(12)].join("-");
  return _ok_runtime.deviceId;
}

async function _ok_fetchAnonymousAuth(forceRefresh) {
  if (
    !forceRefresh &&
    _ok_runtime.anonymousToken &&
    Date.now() - _ok_runtime.anonymousTokenFetchedAt < 10 * 60 * 1000
  ) {
    return { token: _ok_runtime.anonymousToken, userUid: _ok_runtime.anonymousUid };
  }
  const result = await _ok_requestJSON({
    url: `${_ok_baseURL}/priapi/v1/im/auth/v1/token/anonymous-token`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: `${_ok_baseURL}/livestream/stream-room`
    },
    body: JSON.stringify({ deviceId: _ok_makeDeviceId(), platform: 2 })
  });
  const data = _ok_object(result.data);
  const token = _ok_str(data.token);
  if (!token) _ok_throw("INVALID_RESPONSE", "OKX anonymous IM token is missing", {});
  _ok_runtime.anonymousToken = token;
  _ok_runtime.anonymousUid = _ok_str(data.userUid);
  _ok_runtime.anonymousTokenFetchedAt = Date.now();
  return { token: token, userUid: _ok_runtime.anonymousUid };
}

async function _ok_fetchStatus(shareCode, forceRefresh) {
  const code = _ok_parseShareCode(shareCode);
  if (!code) _ok_throw("INVALID_ARGS", "A valid OKX livestream shareCode is required", {});
  let auth = await _ok_fetchAnonymousAuth(!!forceRefresh);
  try {
    const result = await _ok_requestJSON({
      url: `${_ok_baseURL}/priapi/v1/im/livestream/stream/v1/status?shareCode=${encodeURIComponent(code)}`,
      headers: {
        "im-token": auth.token,
        Referer: _ok_externalURL(code)
      }
    });
    return _ok_object(result.data);
  } catch (error) {
    if (forceRefresh || !error || error.code !== "AUTH_REQUIRED") throw error;
    auth = await _ok_fetchAnonymousAuth(true);
    const retry = await _ok_requestJSON({
      url: `${_ok_baseURL}/priapi/v1/im/livestream/stream/v1/status?shareCode=${encodeURIComponent(code)}`,
      headers: {
        "im-token": auth.token,
        Referer: _ok_externalURL(code)
      }
    });
    return _ok_object(retry.data);
  }
}

async function _ok_fetchPlaybackInfo(shareCode) {
  const status = await _ok_fetchStatus(shareCode);
  const channelId = _ok_str(status.channelId);
  if (_ok_statusLiveState(status) !== "1" || !channelId) {
    _ok_throw("NOT_FOUND", "這個 OKX 直播房間目前未開播", {
      roomId: shareCode,
      liveState: _ok_statusLiveState(status)
    });
  }
  const auth = await _ok_fetchAnonymousAuth(false);
  const result = await _ok_requestJSON({
    url: `${_ok_baseURL}/priapi/v1/im/livestream/v1/info?channelId=${encodeURIComponent(channelId)}&ipRegion=`,
    headers: {
      "im-token": auth.token,
      Platform: "web",
      Referer: _ok_externalURL(shareCode)
    }
  });
  return {
    channelId: channelId,
    data: _ok_object(result.data)
  };
}

function _ok_streamHost(url) {
  const match = _ok_str(url).match(/^https?:\/\/([^/?#]+)/i);
  return match && match[1] ? match[1].toLowerCase() : "okx-cdn";
}

function _ok_qualityMeta(protocol, quality) {
  const format = _ok_str(protocol).toLowerCase();
  const level = _ok_str(quality).toLowerCase();
  const names = {
    auto: "自動",
    uhd: "超清",
    hd: "高清",
    sd: "標清",
    ld: "流暢"
  };
  const hlsRanks = { auto: 10000, uhd: 9000, hd: 8000, sd: 7000, ld: 6000 };
  const flvRanks = { uhd: 5900, hd: 5800, sd: 5700, ld: 5600, auto: 5500 };
  return {
    title: `${format === "flv" ? "FLV" : "HLS"} ${names[level] || level.toUpperCase() || "原畫"}`,
    qn: _ok_num((format === "flv" ? flvRanks : hlsRanks)[level], format === "flv" ? 5000 : 6500)
  };
}

function _ok_playbackGroups(roomId, playbackInfo) {
  const data = _ok_object(playbackInfo);
  const entries = [];
  if (Array.isArray(data.pullUrlListV2)) entries.push.apply(entries, data.pullUrlListV2);
  if (Array.isArray(data.pullUrlList)) entries.push.apply(entries, data.pullUrlList);
  const groups = {};
  const groupOrder = [];

  for (const raw of entries) {
    const item = _ok_object(raw);
    const protocol = _ok_str(item.protocol).toLowerCase();
    const quality = _ok_str(item.quality).toLowerCase();
    const url = _ok_str(item.url).trim();
    if ((protocol !== "hls" && protocol !== "flv") || !/^https:\/\//i.test(url)) continue;
    const host = _ok_streamHost(url);
    if (!groups[host]) {
      groups[host] = { host: host, qualitys: [], seen: {} };
      groupOrder.push(host);
    }
    const group = groups[host];
    const logicalKey = `${protocol}:${quality || url}`;
    if (group.seen[logicalKey]) continue;
    group.seen[logicalKey] = true;
    const meta = _ok_qualityMeta(protocol, quality);
    group.qualitys.push({
      roomId: roomId,
      title: meta.title,
      qn: meta.qn,
      url: url,
      liveCodeType: protocol === "flv" ? "flv" : "m3u8",
      liveType: _ok_liveType,
      userAgent: _ok_ua,
      headers: {
        "User-Agent": _ok_ua,
        Referer: `${_ok_baseURL}/`,
        Origin: _ok_baseURL
      },
      playbackHints: {
        streamFormat: protocol === "flv" ? "flv" : "hlsLive",
        latencyMode: "normal",
        preferredEngines: protocol === "flv" ? ["ijk", "mpv"] : ["avplayer", "mpv"],
        isLive: true,
        requiresCustomSegmentLoader: false,
        selectionBehavior: "direct",
        startPositionSeconds: 0
      }
    });
  }

  return groupOrder.map(function (host, index) {
    const group = groups[host];
    group.qualitys.sort(function (left, right) { return right.qn - left.qn; });
    return {
      cdn: host,
      displayName: `OKX CDN ${index + 1}`,
      requestContext: { roomId: roomId },
      qualitys: group.qualitys
    };
  }).filter(function (group) {
    return group.qualitys.length > 0;
  });
}

async function _ok_findCurrentRoom(shareCode) {
  const code = _ok_parseShareCode(shareCode);
  if (!code) _ok_throw("INVALID_ARGS", "A valid OKX livestream shareCode is required", {});
  const rooms = await _ok_fetchAllRooms();
  for (const room of rooms) {
    if (room.roomId === code) return room;
  }
  return null;
}

async function _ok_findCurrentRoomByUser(userId) {
  const target = _ok_str(userId).trim();
  if (!target || target === "0") return null;
  const rooms = await _ok_fetchAllRooms();
  for (const room of rooms) {
    if (_ok_str(room.userId).trim() === target) return room;
  }
  return null;
}

async function _ok_resolveCurrentTarget(roomId, userId) {
  const originalShareCode = _ok_parseShareCode(roomId);
  try {
    const current = await _ok_findCurrentRoomByUser(userId);
    if (current && current.roomId) {
      const status = await _ok_fetchStatus(current.roomId);
      if (_ok_statusLiveState(status) === "1") {
        return {
          shareCode: current.roomId,
          room: _ok_applyFreshStatus(current, current.roomId, status),
          verifiedLive: true
        };
      }
    }
  } catch (_) {}
  if (!originalShareCode) {
    _ok_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
  }
  return {
    shareCode: originalShareCode,
    room: _ok_runtime.rooms[originalShareCode] || null,
    verifiedLive: false
  };
}

function _ok_externalURL(shareCode) {
  return `${_ok_baseURL}/livestream/stream-room?shareCode=${encodeURIComponent(shareCode)}`;
}

function _ok_danmakuSession(payload) {
  const runtimePayload = _ok_payload(payload);
  return _ok_runtime.danmakuSessions[_ok_str(runtimePayload.connectionId)] || null;
}

function _ok_wsRequest(command, data) {
  const random = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return JSON.stringify({
    websocketCommand: command,
    requestId: `${Date.now()}-${random}`,
    data: _ok_object(data)
  });
}

function _ok_textWrite(command, data) {
  return { kind: "text", text: _ok_wsRequest(command, data) };
}

function _ok_wsData(value) {
  if (typeof value === "string") return _ok_object(_ok_parseJSON(value));
  return _ok_object(value);
}

function _ok_trimSeen(session) {
  const keys = Object.keys(session.seen);
  if (keys.length <= 600) return;
  const keep = {};
  for (let index = Math.max(0, keys.length - 400); index < keys.length; index += 1) {
    keep[keys[index]] = true;
  }
  session.seen = keep;
}

function _ok_seqGreater(left, right) {
  const leftText = _ok_str(left);
  const rightText = _ok_str(right);
  if (!leftText) return false;
  if (!rightText) return true;
  if (/^\d+$/.test(leftText) && /^\d+$/.test(rightText)) {
    if (leftText.length !== rightText.length) return leftText.length > rightText.length;
    return leftText > rightText;
  }
  return leftText > rightText;
}

function _ok_danmakuMessages(session, list, isHistory) {
  const source = Array.isArray(list) ? list.slice() : [];
  source.sort(function (left, right) {
    return _ok_num(left && left.seq, 0) - _ok_num(right && right.seq, 0);
  });
  const start = isHistory ? Math.max(0, source.length - 30) : 0;
  const messages = [];

  for (let index = start; index < source.length; index += 1) {
    const item = _ok_object(source[index]);
    const seq = _ok_str(item.seq);
    if (_ok_seqGreater(seq, session.lastSeq)) session.lastSeq = seq;
    const textMessage = _ok_object(item.textMessage);
    const text = _ok_str(textMessage.text || item.text).trim();
    if (!text) continue;
    const key = seq
      ? `${_ok_str(item.channelId || session.channelId)}:${seq}`
      : _ok_str(item.clientMsgId || item.serverMsgId || `${text}:${index}`);
    if (session.seen[key]) continue;
    session.seen[key] = true;
    const sender = _ok_object(item.senderName);
    messages.push({
      text: text,
      nickname: _ok_str(sender.nickname || sender.enNickname || item.nickname || "OKX User")
    });
  }

  _ok_trimSeen(session);
  return messages;
}

function _ok_parseDanmakuFrame(session, text) {
  const parsed = _ok_parseJSON(text);
  const timer = { mode: "heartbeat", intervalMs: _ok_danmakuHeartbeatMs };
  if (!parsed || typeof parsed !== "object") return { ok: true, messages: [], timer: timer };
  const command = _ok_str(parsed.websocketCommand || parsed.command);
  const data = _ok_wsData(parsed.data);
  const writes = [];

  if (command === "WSAuth" && _ok_num(parsed.code, -1) === 0 && !session.authenticated) {
    session.authenticated = true;
    writes.push(
      _ok_textWrite("WSSubscribeToLivestream", { channelId: session.channelId }),
      _ok_textWrite("WSGetNewestSeq", { channelIdList: [session.channelId] })
    );
  }

  const seqList = Array.isArray(data.seqDtoList) ? data.seqDtoList : [];
  if (seqList.length && !session.historyInFlight) {
    for (const entry of seqList) {
      const sequence = _ok_str(entry && entry.seq);
      const channelId = _ok_str(entry && entry.channelId);
      if (channelId !== session.channelId || !sequence) continue;
      if (session.historyLoaded && !_ok_seqGreater(sequence, session.lastSeq)) continue;
      session.historyRequested = true;
      session.historyInFlight = true;
      writes.push(
        _ok_textWrite("WSGetMsgByPage", {
          channelId: session.channelId,
          lastSeq: sequence,
          limit: 100
        })
      );
      break;
    }
  }

  let list = Array.isArray(data.messageList) ? data.messageList : [];
  if (!list.length && Array.isArray(data.messages)) list = data.messages;
  if (!list.length) {
    const nested = _ok_wsData(data.messageListResponse || data.messages);
    if (Array.isArray(nested.messageList)) list = nested.messageList;
  }
  if (!list.length && (data.textMessage || data.text || data.customMessage)) list = [data];
  const isHistory = command === "WSGetMsgByPage" || (session.historyRequested && !session.historyLoaded && !!data.channelId);
  if (command === "WSGetMsgByPage") session.historyInFlight = false;
  if (isHistory && list.length) session.historyLoaded = true;

  return {
    ok: true,
    messages: _ok_danmakuMessages(session, list, isHistory),
    writes: writes,
    timer: timer
  };
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
    const rooms = await _ok_fetchAllRooms();
    const start = (page - 1) * _ok_roomPageSize;
    return rooms.slice(start, start + _ok_roomPageSize);
  },

  async getPlayback(payload) {
    const runtimePayload = _ok_payload(payload);
    const target = await _ok_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    const shareCode = target.shareCode;
    const info = await _ok_fetchPlaybackInfo(shareCode);
    const groups = _ok_playbackGroups(shareCode, info.data);
    if (!groups.length) {
      _ok_throw("NOT_FOUND", "OKX 沒有返回可播放的 HLS 或 FLV 串流", {
        roomId: shareCode,
        channelId: info.channelId
      });
    }
    return groups;
  },

  async search(payload) {
    const runtimePayload = _ok_payload(payload);
    const keyword = _ok_str(runtimePayload.keyword).trim();
    const page = Math.max(1, _ok_num(runtimePayload.page, 1));
    if (!keyword) _ok_throw("INVALID_ARGS", "keyword is required", { field: "keyword" });

    const shareCode = _ok_parseShareCode(keyword);
    if (shareCode) {
      if (page > 1) return [];
      const found = await _ok_findCurrentRoom(shareCode);
      try {
        return [_ok_applyFreshStatus(found, shareCode, await _ok_fetchStatus(shareCode))];
      } catch (_) {
        return [found || _ok_fallbackRoom(shareCode, "0")];
      }
    }

    const lower = keyword.toLowerCase();
    const rooms = await _ok_fetchAllRooms();
    const matches = rooms.filter(function (room) {
      return (
        room.roomTitle.toLowerCase().indexOf(lower) >= 0 ||
        room.userName.toLowerCase().indexOf(lower) >= 0
      );
    });
    const start = (page - 1) * _ok_roomPageSize;
    return matches.slice(start, start + _ok_roomPageSize);
  },

  async getRoomDetail(payload) {
    const runtimePayload = _ok_payload(payload);
    const target = await _ok_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    const shareCode = target.shareCode;
    if (target.verifiedLive) return target.room;
    const cached = target.room || _ok_runtime.rooms[shareCode] || null;
    try {
      return _ok_applyFreshStatus(cached, shareCode, await _ok_fetchStatus(shareCode));
    } catch (_) {
      return cached || _ok_fallbackRoom(shareCode, "0");
    }
  },

  async getLiveState(payload) {
    const runtimePayload = _ok_payload(payload);
    const target = await _ok_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    const shareCode = target.shareCode;
    if (target.verifiedLive) return { liveState: "1" };
    try {
      return { liveState: _ok_statusLiveState(await _ok_fetchStatus(shareCode)) };
    } catch (_) {
      return { liveState: "0" };
    }
  },

  async resolveShare(payload) {
    const runtimePayload = _ok_payload(payload);
    const shareCode = _ok_parseShareCode(runtimePayload.shareCode);
    if (!shareCode) {
      _ok_throw("PARSE", "Cannot parse this OKX livestream link", {
        shareCode: _ok_str(runtimePayload.shareCode)
      });
    }
    const found = await _ok_findCurrentRoom(shareCode);
    try {
      return _ok_applyFreshStatus(found, shareCode, await _ok_fetchStatus(shareCode));
    } catch (_) {
      return found || _ok_fallbackRoom(shareCode, "0");
    }
  },

  async getDanmaku(payload) {
    const runtimePayload = _ok_payload(payload);
    const target = await _ok_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    const shareCode = target.shareCode;
    const status = await _ok_fetchStatus(shareCode);
    const channelId = _ok_str(status.channelId);
    if (_ok_statusLiveState(status) !== "1" || !channelId) {
      _ok_throw("NOT_FOUND", "這個 OKX 直播房間目前未開播或沒有聊天頻道", {
        roomId: shareCode
      });
    }
    const auth = await _ok_fetchAnonymousAuth(false);
    return {
      args: {
        roomId: shareCode,
        channelId: channelId,
        _danmu_type: "websocket"
      },
      headers: {
        "im-token": auth.token,
        Origin: _ok_baseURL,
        "User-Agent": _ok_ua
      },
      transport: {
        kind: "websocket",
        url: "wss://wspri.okx.com/ws/v1/im/an",
        frameType: "text"
      },
      runtime: {
        driver: "plugin_js_v1",
        protocolId: "okx_livestream_im",
        protocolVersion: "1"
      }
    };
  },

  async createDanmakuSession(payload) {
    const runtimePayload = _ok_payload(payload);
    const connectionId = _ok_str(runtimePayload.connectionId);
    const args = _ok_object(runtimePayload.args);
    const headers = _ok_object(runtimePayload.headers);
    const shareCode = _ok_parseShareCode(runtimePayload.roomId || args.roomId);
    const channelId = _ok_str(args.channelId);
    const token = _ok_str(args.token || headers["im-token"] || headers["IM-Token"]);
    if (!connectionId || !shareCode || !channelId || !token) {
      _ok_throw("INVALID_ARGS", "connectionId, roomId, channelId and IM token are required", {});
    }
    _ok_runtime.danmakuSessions[connectionId] = {
      shareCode: shareCode,
      channelId: channelId,
      token: token,
      authenticated: false,
      seen: {},
      historyRequested: false,
      historyLoaded: false,
      historyInFlight: false,
      lastSeq: ""
    };
    return { ok: true };
  },

  async onDanmakuOpen(payload) {
    const session = _ok_danmakuSession(payload);
    if (!session) _ok_throw("INVALID_ARGS", "Unknown danmaku session", {});
    return {
      ok: true,
      writes: [_ok_textWrite("WSAuth", { token: session.token })],
      timer: { mode: "heartbeat", intervalMs: _ok_danmakuHeartbeatMs }
    };
  },

  async onDanmakuTick(payload) {
    const session = _ok_danmakuSession(payload);
    if (!session) _ok_throw("INVALID_ARGS", "Unknown danmaku session", {});
    return {
      ok: true,
      writes: [
        { kind: "text", text: "ping" },
        _ok_textWrite("WSGetNewestSeq", { channelIdList: [session.channelId] })
      ],
      timer: { mode: "heartbeat", intervalMs: _ok_danmakuHeartbeatMs }
    };
  },

  async onDanmakuFrame(payload) {
    const runtimePayload = _ok_payload(payload);
    const session = _ok_danmakuSession(runtimePayload);
    if (!session) _ok_throw("INVALID_ARGS", "Unknown danmaku session", {});
    if (_ok_str(runtimePayload.frameType) !== "text") {
      return {
        ok: true,
        messages: [],
        timer: { mode: "heartbeat", intervalMs: _ok_danmakuHeartbeatMs }
      };
    }
    return _ok_parseDanmakuFrame(session, _ok_str(runtimePayload.text));
  },

  async destroyDanmakuSession(payload) {
    const runtimePayload = _ok_payload(payload);
    const connectionId = _ok_str(runtimePayload.connectionId);
    if (connectionId) delete _ok_runtime.danmakuSessions[connectionId];
    return { ok: true };
  }
};
