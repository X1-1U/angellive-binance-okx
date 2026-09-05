const _bn_platformId = "binance";
const _bn_liveType = "binance";
const _bn_baseURL = "https://www.binance.com";
const _bn_ua =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const _bn_pageSize = 20;
const _bn_liveDirectoryScanPages = 30;
const _bn_feedScanPages = 10;
const _bn_roomPageSize = 50;
const _bn_cacheTTL = 30 * 1000;
const _bn_discoveryTTL = 6 * 60 * 60 * 1000;
const _bn_staleValidationLimit = 20;
const _bn_danmakuIntervalMs = 3000;
const _bn_danmakuClockURL = "wss://stream.binance.com:9443/ws";
const _bn_runtime = {
  liveList: [],
  liveListFetchedAt: 0,
  discovered: {},
  discoveredAt: {},
  danmakuSessions: {}
};

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
    _bn_throw("UNKNOWN", "Host.http.request is unavailable", {});
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
    const code = status === 429 ? "RATE_LIMITED" : status === 401 || status === 403 ? "BLOCKED" : "NETWORK";
    _bn_throw(code, `Binance HTTP ${status || "error"}`, {
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
    _bn_throw(code === "000429" ? "RATE_LIMITED" : "UPSTREAM", _bn_message(parsed), { code: code });
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

function _bn_userIds(item) {
  const object = _bn_object(item);
  const author = _bn_pickAuthor(object);
  const values = [
    author.squareUid,
    author.userId,
    author.uid,
    object.squareAuthorId,
    object.squareUid,
    object.userId,
    object.authorId
  ];
  const seen = {};
  return values.map(function (value) {
    return _bn_str(value).trim();
  }).filter(function (value) {
    if (!value || value === "0" || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function _bn_liveCard(item) {
  const object = _bn_object(item);
  const cardType = _bn_str(object.cardType).toUpperCase();
  if (cardType && cardType.indexOf("SPACE_LIVE") !== 0) return false;
  return _bn_liveState(object, false) === "1";
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
    userHeadImg: _bn_str(
      author.avatar || author.portrait || value.authorAvatar || value.avatar || value.userHeadImg
    ),
    liveType: _bn_liveType,
    liveState: _bn_liveState(value, forceLive),
    userId: _bn_str(
      author.squareUid ||
        author.userId ||
        value.squareAuthorId ||
        value.squareUid ||
        value.userId
    ),
    roomId: roomId,
    liveWatchedCount: _bn_str(
      _bn_heat(value)
    ),
    biz: _bn_str(value.liveType || value.contentType)
  };
}

async function _bn_fetchLegacyLiveList() {
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

async function _bn_fetchLiveDirectoryPage(pageIndex) {
  const result = await _bn_requestJSON({
    url: `${_bn_baseURL}/bapi/composite/v1/friendly/pgc/feed/live/list`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      versioncode: "web"
    },
    body: JSON.stringify({
      pageIndex: Math.max(1, _bn_num(pageIndex, 1)),
      pageSize: _bn_pageSize
    })
  });
  const data = _bn_object(result.data);
  const list = data.vos || data.list || [];
  return Array.isArray(list) ? list : [];
}

async function _bn_fetchFeedPage(pageIndex, contentIds) {
  const result = await _bn_requestJSON({
    url: `${_bn_baseURL}/bapi/composite/v9/friendly/pgc/feed/feed-recommend/list`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      versioncode: "web"
    },
    body: JSON.stringify({
      pageIndex: Math.max(1, _bn_num(pageIndex, 1)),
      pageSize: _bn_pageSize,
      scene: "web-homepage",
      contentIds: Array.isArray(contentIds) ? contentIds.slice(-50) : []
    })
  });
  const data = _bn_object(result.data);
  const list = data.vos || data.list || [];
  return Array.isArray(list) ? list : [];
}

function _bn_heat(item) {
  const value = Object.assign({}, item, item.liveVO || item.spaceLive || item.liveInfo || {});
  const status = _bn_object(value.liveStatusVO);
  for (const count of [value.onlineCount, value.viewerCount, status.onlineCount, value.liveWatchedCount, value.viewCount]) {
    if (count === null || count === undefined || count === "") continue;
    const number = Number(String(count).replace(/,/g, ""));
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return 0;
}

function _bn_dedupeLiveList(items) {
  const seen = {};
  const output = [];
  for (const item of items) {
    if (!_bn_liveCard(item)) continue;
    const id = _bn_pickId(item);
    if (!id || seen[id]) continue;
    seen[id] = true;
    output.push(item);
  }
  output.sort(function (left, right) {
    return _bn_heat(right) - _bn_heat(left) || _bn_pickId(left).localeCompare(_bn_pickId(right));
  });
  return output;
}

function _bn_rememberLiveItems(items, seenAt) {
  const timestamp = seenAt || Date.now();
  for (const item of items) {
    if (!_bn_liveCard(item)) continue;
    const id = _bn_pickId(item);
    if (!id) continue;
    _bn_runtime.discovered[id] = item;
    _bn_runtime.discoveredAt[id] = timestamp;
  }
}

async function _bn_revalidateRemembered(currentItems, now) {
  const currentIds = {};
  for (const item of currentItems) currentIds[_bn_pickId(item)] = true;
  const candidates = Object.keys(_bn_runtime.discovered).filter(function (id) {
    const age = now - _bn_num(_bn_runtime.discoveredAt[id], 0);
    if (age > _bn_discoveryTTL) {
      delete _bn_runtime.discovered[id];
      delete _bn_runtime.discoveredAt[id];
      return false;
    }
    return !currentIds[id];
  }).slice(0, _bn_staleValidationLimit);

  const checked = await Promise.all(candidates.map(async function (id) {
    try {
      const detail = await _bn_fetchRoomDetail(id);
      return _bn_liveState(detail, false) === "1" ? detail : null;
    } catch (_) {
      return null;
    }
  }));
  for (let index = 0; index < candidates.length; index += 1) {
    const id = candidates[index];
    const detail = checked[index];
    if (detail) {
      _bn_runtime.discovered[id] = detail;
      _bn_runtime.discoveredAt[id] = now;
      currentItems.push(detail);
    } else {
      delete _bn_runtime.discovered[id];
      delete _bn_runtime.discoveredAt[id];
    }
  }
  return currentItems;
}

async function _bn_fetchRecommendedLiveList() {
  const collected = [];
  const feedHistory = [];
  const feedSeen = {};
  let successCount = 0;
  let firstError = null;
  let stalePages = 0;

  for (let page = 1; page <= _bn_feedScanPages; page += 1) {
    let items = [];
    try {
      const recentIds = feedHistory.slice(-50).map(function (item) {
        return _bn_pickId(item);
      }).filter(function (id) {
        return !!id;
      });
      items = await _bn_fetchFeedPage(page, recentIds);
      successCount += 1;
    } catch (error) {
      if (!firstError) firstError = error;
      stalePages += 1;
      if (stalePages >= 3) break;
      continue;
    }
    if (!items.length) {
      stalePages += 1;
      if (stalePages >= 3) break;
      continue;
    }
    collected.push.apply(collected, items);
    let newIds = 0;
    for (const item of items) {
      const id = _bn_pickId(item);
      if (!id || feedSeen[id]) continue;
      feedSeen[id] = true;
      feedHistory.push(item);
      newIds += 1;
    }
    stalePages = newIds > 0 ? 0 : stalePages + 1;
    if (stalePages >= 3) break;
  }

  if (successCount === 0 && firstError) throw firstError;
  return collected;
}

let _bn_liveListPending = null;
async function _bn_fetchLiveList() {
  if (_bn_liveListPending) return (await _bn_liveListPending).slice();
  _bn_liveListPending = _bn_loadLiveList();
  try { return (await _bn_liveListPending).slice(); }
  finally { _bn_liveListPending = null; }
}

async function _bn_loadLiveList() {
  if (
    _bn_runtime.liveListFetchedAt > 0 &&
    Date.now() - _bn_runtime.liveListFetchedAt < _bn_cacheTTL
  ) {
    return _bn_runtime.liveList.slice();
  }

  const collected = [];
  let directorySucceeded = false;
  let directoryError = null;
  let emptyLivePages = 0;
  const directorySeen = {};

  // Binance Square 的專用直播目錄會把直播卡排在最前面；連續兩個空頁才停止，以避開短暫快取抖動。
  for (let page = 1; page <= _bn_liveDirectoryScanPages; page += 1) {
    try {
      const items = await _bn_fetchLiveDirectoryPage(page);
      directorySucceeded = true;
      collected.push.apply(collected, items);
      let newLiveRooms = 0;
      for (const item of items) {
        const id = _bn_pickId(item);
        if (_bn_liveCard(item) && id && !directorySeen[id]) {
          directorySeen[id] = true;
          newLiveRooms += 1;
        }
      }
      if (newLiveRooms > 0) {
        emptyLivePages = 0;
      } else {
        emptyLivePages += 1;
        if (emptyLivePages >= 2) break;
      }
    } catch (error) {
      directoryError = directoryError || error;
      break;
    }
  }

  // 專用目錄與首頁推薦流的內容並不完全相同；每輪都合併，避免只看到官方首頁的一小批。
  try {
    const recommended = await _bn_fetchRecommendedLiveList();
    collected.push.apply(collected, recommended);
  } catch (error) {
    if (!directorySucceeded && directoryError) throw directoryError;
    if (!directorySucceeded) throw error;
  }
  try {
    const legacy = await _bn_fetchLegacyLiveList();
    collected.push.apply(collected, legacy);
  } catch (_) {}

  const now = Date.now();
  let liveList = _bn_dedupeLiveList(collected);
  _bn_rememberLiveItems(liveList, now);
  liveList = _bn_dedupeLiveList(await _bn_revalidateRemembered(liveList, now));

  _bn_runtime.liveList = liveList.slice();
  _bn_runtime.liveListFetchedAt = Date.now();
  return liveList;
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
  const id = _bn_parseRoomId(roomId);
  let cached = null;
  for (const item of _bn_runtime.liveList) {
    if (_bn_pickId(item) === id) {
      cached = item;
      break;
    }
  }
  try {
    return Object.assign({}, cached || {}, await _bn_fetchRoomDetail(id));
  } catch (_) {
    try {
      return Object.assign({}, cached || {}, await _bn_fetchContentDetail(id));
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }
}

async function _bn_findCurrentLiveByUser(userId) {
  const target = _bn_str(userId).trim();
  if (!target || target === "0") return null;
  const list = await _bn_fetchLiveList();
  for (const item of list) {
    if (_bn_userIds(item).indexOf(target) >= 0) return item;
  }
  return null;
}

async function _bn_resolveCurrentTarget(roomId, userId) {
  const originalRoomId = _bn_parseRoomId(roomId);
  try {
    const current = await _bn_findCurrentLiveByUser(userId);
    const currentRoomId = _bn_pickId(current);
    if (current && currentRoomId) {
      try {
        const detail = Object.assign({}, current, await _bn_fetchRoomDetail(currentRoomId));
        if (_bn_liveState(detail, false) === "1") {
          return { roomId: currentRoomId, detail: detail };
        }
      } catch (_) {
        if (_bn_liveState(current, false) === "1") {
          return { roomId: currentRoomId, detail: current };
        }
      }
    }
  } catch (_) {}

  if (!originalRoomId) {
    _bn_throw("INVALID_ARGS", "roomId is required", { field: "roomId" });
  }
  return {
    roomId: originalRoomId,
    detail: await _bn_detailWithFallback(originalRoomId)
  };
}

function _bn_quality(url, title, qn, format, isLive) {
  const isFLV = format === "flv";
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
      streamFormat: isFLV ? "flv" : isLive ? "hlsLive" : "hlsVod",
      latencyMode: "standard",
      preferredEngines: isFLV ? ["mePlayer"] : isLive ? ["mePlayer", "avPlayer"] : ["mePlayer"],
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

function _bn_chatURL(roomId) {
  return `${_bn_baseURL}/bapi/square/v1/friendly/square-live/get-live-room-chat-message?contentId=${encodeURIComponent(roomId)}&withAffinityCoin=true`;
}

function _bn_chatHeaders(roomId) {
  return {
    Accept: "application/json, text/plain, */*",
    clienttype: "web",
    lang: "en",
    Referer: `${_bn_baseURL}/en/square/audio?id=${encodeURIComponent(roomId)}`
  };
}

function _bn_chatPoll(roomId) {
  return {
    url: `${_bn_chatURL(roomId)}&_=${Date.now()}`,
    method: "GET",
    headers: _bn_chatHeaders(roomId)
  };
}

async function _bn_fetchChatMessages(session) {
  const parsed = await _bn_requestJSON({
    url: `${_bn_chatURL(session.roomId)}&_=${Date.now()}`,
    method: "GET",
    headers: _bn_chatHeaders(session.roomId)
  });
  return _bn_chatMessages(session, JSON.stringify(parsed));
}

function _bn_danmakuSession(payload) {
  const runtimePayload = _bn_payload(payload);
  return _bn_runtime.danmakuSessions[_bn_str(runtimePayload.connectionId)] || null;
}

function _bn_chatMessages(session, response) {
  const parsed = _bn_parseJSON(response);
  if (!parsed || typeof parsed !== "object") {
    _bn_throw("INVALID_RESPONSE", "Binance chat returned invalid JSON", {});
  }
  if (parsed.success === false || (_bn_str(parsed.code) && _bn_str(parsed.code) !== "000000")) {
    _bn_throw("UPSTREAM", _bn_message(parsed), { code: _bn_str(parsed.code) });
  }

  const data = _bn_object(parsed.data);
  const list = Array.isArray(data.liveRoomChatMessage) ? data.liveRoomChatMessage.slice() : [];
  list.sort(function (left, right) {
    const leftSeq = _bn_str(left && left.seqId);
    const rightSeq = _bn_str(right && right.seqId);
    if (/^\d+$/.test(leftSeq) && /^\d+$/.test(rightSeq) && leftSeq.length !== rightSeq.length) {
      return leftSeq.length - rightSeq.length;
    }
    return leftSeq < rightSeq ? -1 : leftSeq > rightSeq ? 1 : 0;
  });

  const firstFrame = !session.initialized;
  const startIndex = firstFrame ? Math.max(0, list.length - 20) : 0;
  const messages = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = _bn_object(list[index]);
    const seq = _bn_str(item.seqId);
    const key = seq
      ? seq
      : [_bn_str(item.squareUid), _bn_str(item.content), _bn_str(index)].join(":");
    if (index < startIndex || session.seen[key]) {
      continue;
    }
    const text = _bn_str(item.translatedContent || item.content).trim();
    if (!text) continue;
    session.seen[key] = true;
    messages.push({
      text: text,
      nickname: _bn_str(item.displayName || item.username || "Binance User")
    });
  }

  session.initialized = true;
  const keys = Object.keys(session.seen);
  if (keys.length > 500) {
    const keep = {};
    for (let index = Math.max(0, keys.length - 300); index < keys.length; index += 1) {
      keep[keys[index]] = true;
    }
    session.seen = keep;
  }
  return messages;
}

async function _bn_resolveRoomFromShare(shareCode) {
  const directId = _bn_parseRoomId(shareCode);
  if (directId) {
    const detail = await _bn_detailWithFallback(directId);
    _bn_rememberLiveItems([detail]);
    return detail;
  }

  const postId = _bn_parsePostId(shareCode);
  if (postId) {
    const post = await _bn_fetchContentDetail(postId);
    const quoted = _bn_object(post.quoteContent || post.referencedContent);
    const targetId = _bn_pickId(quoted) || (post.extraFeature === "SPACE_LIVE" ? _bn_pickId(post) : "");
    if (targetId) {
      const detail = await _bn_detailWithFallback(targetId);
      _bn_rememberLiveItems([detail]);
      return detail;
    }
  }

  const source = _bn_str(shareCode).trim();
  if (/^https?:\/\//i.test(source) && /binance\.com/i.test(source)) {
    const response = await _bn_http({
      url: source,
      headers: { Accept: "text/html,application/xhtml+xml" }
    });
    const redirectedId = _bn_parseRoomId(response.url);
    if (redirectedId) {
      const detail = await _bn_detailWithFallback(redirectedId);
      _bn_rememberLiveItems([detail]);
      return detail;
    }
    const html = _bn_str(response.bodyText);
    const match = html.match(/(?:contentId|\"id\")\D{0,24}(\d{6,})/i);
    if (match && match[1]) {
      const detail = await _bn_detailWithFallback(match[1]);
      _bn_rememberLiveItems([detail]);
      return detail;
    }
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
    const list = await _bn_fetchLiveList();
    const rooms = list.map(function (item) {
      return _bn_room(item, true);
    }).filter(function (item) {
      return !!item.roomId;
    });
    const start = (page - 1) * _bn_roomPageSize;
    return rooms.slice(start, start + _bn_roomPageSize);
  },

  async getPlayback(payload) {
    const runtimePayload = _bn_payload(payload);
    const target = await _bn_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    const roomId = target.roomId;
    const detail = target.detail;
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
      } else if (/\.m(?:p4|4v)(?:[?#]|$)/i.test(replayURL)) {
        // AngelLive 的 LiveCodeType 目前只有 m3u8/flv；點播語義由 hlsVod hint
        // 決定，KSMEPlayer 可以直接播放支援 byte-range 的 MP4/M4V 回放。
        _bn_addQuality(qualities, seen, replayURL, "MP4 回放", 10000, "m3u8", false, roomId);
      }
    }

    if (!qualities.length) {
      _bn_throw("NOT_FOUND", "This Binance Square live room is offline or has no playable stream", {
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
    const roomId = _bn_parseRoomId(keyword);
    if (roomId) return page === 1 ? [_bn_room(await _bn_detailWithFallback(roomId), false)] : [];

    const lower = keyword.toLowerCase();
    const list = await _bn_fetchLiveList();
    const matches = list.map(function (item) {
      return _bn_room(item, true);
    }).filter(function (item) {
      return (
        item.roomTitle.toLowerCase().indexOf(lower) >= 0 ||
        item.userName.toLowerCase().indexOf(lower) >= 0
      );
    });
    const start = (page - 1) * _bn_roomPageSize;
    return matches.slice(start, start + _bn_roomPageSize);
  },

  async getRoomDetail(payload) {
    const runtimePayload = _bn_payload(payload);
    const target = await _bn_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    return _bn_room(target.detail, false);
  },

  async getLiveState(payload) {
    const runtimePayload = _bn_payload(payload);
    const target = await _bn_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    return { liveState: _bn_liveState(target.detail, false) };
  },

  async resolveShare(payload) {
    const runtimePayload = _bn_payload(payload);
    const shareCode = _bn_str(runtimePayload.shareCode).trim();
    if (!shareCode) _bn_throw("INVALID_ARGS", "shareCode is required", { field: "shareCode" });
    return _bn_room(await _bn_resolveRoomFromShare(shareCode), false);
  },

  async getDanmaku(payload) {
    const runtimePayload = _bn_payload(payload);
    const target = await _bn_resolveCurrentTarget(runtimePayload.roomId, runtimePayload.userId);
    const roomId = target.roomId;
    return {
      args: {
        roomId: roomId,
        _danmu_type: "websocket"
      },
      headers: {
        Origin: _bn_baseURL,
        "User-Agent": _bn_ua
      },
      transport: {
        kind: "websocket",
        url: _bn_danmakuClockURL,
        frameType: "text"
      },
      runtime: {
        driver: "plugin_js_v1",
        protocolId: "binance_square_chat_ws_clock",
        protocolVersion: "2",
        webSocketHeaderMode: "minimal_no_cookie"
      }
    };
  },

  async createDanmakuSession(payload) {
    const runtimePayload = _bn_payload(payload);
    const connectionId = _bn_str(runtimePayload.connectionId);
    const args = _bn_object(runtimePayload.args);
    const roomId = _bn_parseRoomId(runtimePayload.roomId || args.roomId);
    if (!connectionId || !roomId) {
      _bn_throw("INVALID_ARGS", "connectionId and roomId are required", {});
    }
    const session = {
      roomId: roomId,
      initialized: false,
      seen: {}
    };
    _bn_runtime.danmakuSessions[connectionId] = session;
    return {
      ok: true,
      messages: await _bn_fetchChatMessages(session)
    };
  },

  async onDanmakuOpen(payload) {
    const session = _bn_danmakuSession(payload);
    if (!session) _bn_throw("INVALID_ARGS", "Unknown danmaku session", {});
    return {
      ok: true,
      timer: { mode: "heartbeat", intervalMs: _bn_danmakuIntervalMs }
    };
  },

  async onDanmakuTick(payload) {
    const session = _bn_danmakuSession(payload);
    if (!session) _bn_throw("INVALID_ARGS", "Unknown danmaku session", {});
    return {
      ok: true,
      messages: await _bn_fetchChatMessages(session),
      timer: { mode: "heartbeat", intervalMs: _bn_danmakuIntervalMs }
    };
  },

  async onDanmakuFrame(payload) {
    const runtimePayload = _bn_payload(payload);
    const session = _bn_danmakuSession(runtimePayload);
    if (!session) _bn_throw("INVALID_ARGS", "Unknown danmaku session", {});
    return {
      ok: true,
      messages: [],
      timer: { mode: "heartbeat", intervalMs: _bn_danmakuIntervalMs }
    };
  },

  async destroyDanmakuSession(payload) {
    const runtimePayload = _bn_payload(payload);
    const connectionId = _bn_str(runtimePayload.connectionId);
    if (connectionId) delete _bn_runtime.danmakuSessions[connectionId];
    return { ok: true };
  }
};
