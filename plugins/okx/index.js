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

// ---- OKX 回應解密 ----
// OKX 網頁接口（例如 /livestream/v1/info）改為回傳 base64 加密內容；金鑰材料在同一回應的
// x-response-authorization 與 x-response-time 標頭裡，與 OKX 網頁端的解法相同：
// key = 由 SHA-256(authorization) 的十六進位字串依時間挑出 32 個字元，AES-256-CBC、IV 全 0。
// JavaScriptCore 沒有 crypto.subtle，以下為純 JS 實作（只需要解密）。
function _ok_sha256Hex(text) {
  const bytes = _ok_utf8Encode(text);
  const K = [];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (let n = 2, found = 0; found < 64; n += 1) {
    let prime = true;
    for (let d = 2; d * d <= n; d += 1) if (n % d === 0) { prime = false; break; }
    if (prime) { K.push((Math.pow(n, 1 / 3) % 1) * 0x100000000 | 0); found += 1; }
  }
  const length = bytes.length;
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const bits = length * 8;
  for (let i = 7; i >= 0; i -= 1) padded.push(i >= 4 ? Math.floor(bits / Math.pow(2, 8 * i)) & 0xff : (bits >>> (8 * i)) & 0xff);
  const W = new Array(64);
  const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      W[t] = (padded[offset + t * 4] << 24) | (padded[offset + t * 4 + 1] << 16) | (padded[offset + t * 4 + 2] << 8) | padded[offset + t * 4 + 3];
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map(function (value) { return ("00000000" + (value >>> 0).toString(16)).slice(-8); }).join("");
}

function _ok_utf8Encode(text) {
  const output = [];
  const value = _ok_str(text);
  for (let i = 0; i < value.length; i += 1) {
    let code = value.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) { code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00); i += 1; }
    }
    if (code < 0x80) output.push(code);
    else if (code < 0x800) output.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) output.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else output.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return output;
}

function _ok_utf8Decode(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i];
    let code, size;
    if (b0 < 0x80) { code = b0; size = 1; }
    else if (b0 >= 0xf0) { code = ((b0 & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); size = 4; }
    else if (b0 >= 0xe0) { code = ((b0 & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); size = 3; }
    else { code = ((b0 & 31) << 6) | (bytes[i + 1] & 63); size = 2; }
    if (code >= 0x10000) { code -= 0x10000; output += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 1023)); }
    else output += String.fromCharCode(code);
    i += size;
  }
  return output;
}

function _ok_base64Bytes(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = _ok_str(text).replace(/[^A-Za-z0-9+/]/g, "");
  const output = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    buffer = (buffer << 6) | alphabet.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; output.push((buffer >> bits) & 0xff); }
  }
  return output;
}

let _ok_aesTables = null;
function _ok_aesInit() {
  if (_ok_aesTables) return _ok_aesTables;
  const sbox = new Array(256), inv = new Array(256), exp = new Array(256), log = new Array(256);
  for (let i = 0, x = 1; i < 256; i += 1) { exp[i] = x; log[x] = i; x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0); x &= 0xff; }
  const mul = function (a, b) { return a && b ? exp[(log[a] + log[b]) % 255] : 0; };
  for (let i = 0; i < 256; i += 1) {
    let x = i ? exp[255 - log[i]] : 0;
    let y = x;
    for (let r = 0; r < 4; r += 1) { x = ((x << 1) | (x >> 7)) & 0xff; y ^= x; }
    y ^= 0x63;
    sbox[i] = y; inv[y] = i;
  }
  _ok_aesTables = { sbox: sbox, inv: inv, mul: mul };
  return _ok_aesTables;
}

// AES-256-CBC 解密並移除 PKCS#7 填充。
function _ok_aes256CbcDecrypt(keyBytes, ivBytes, data) {
  const T = _ok_aesInit(), sbox = T.sbox, inv = T.inv, mul = T.mul;
  const Nk = 8, Nr = 14, w = [];
  for (let i = 0; i < Nk; i += 1) w.push([keyBytes[4 * i], keyBytes[4 * i + 1], keyBytes[4 * i + 2], keyBytes[4 * i + 3]]);
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i += 1) {
    let t = w[i - 1].slice();
    if (i % Nk === 0) { t = [sbox[t[1]] ^ rcon, sbox[t[2]], sbox[t[3]], sbox[t[0]]]; rcon = mul(rcon, 2); }
    else if (i % Nk === 4) t = t.map(function (b) { return sbox[b]; });
    w.push([w[i - Nk][0] ^ t[0], w[i - Nk][1] ^ t[1], w[i - Nk][2] ^ t[2], w[i - Nk][3] ^ t[3]]);
  }
  if (data.length === 0 || data.length % 16 !== 0) throw new Error("AES data length");
  const output = [];
  let previous = ivBytes.slice();
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = data.slice(offset, offset + 16);
    const s = block.slice();
    const addKey = function (round) { for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) s[c * 4 + r] ^= w[round * 4 + c][r]; };
    addKey(Nr);
    for (let round = Nr - 1; round >= 0; round -= 1) {
      // InvShiftRows + InvSubBytes
      const copy = s.slice();
      for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) s[c * 4 + r] = inv[copy[((c - r + 4) % 4) * 4 + r]];
      addKey(round);
      if (round > 0) {
        for (let c = 0; c < 4; c += 1) {
          const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
          s[c * 4] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
          s[c * 4 + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
          s[c * 4 + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
          s[c * 4 + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
        }
      }
    }
    for (let i = 0; i < 16; i += 1) output.push(s[i] ^ previous[i]);
    previous = block;
  }
  const pad = output[output.length - 1];
  if (pad < 1 || pad > 16) throw new Error("AES padding");
  return output.slice(0, output.length - pad);
}

function _ok_header(headers, name) {
  const object = _ok_object(headers), lower = name.toLowerCase();
  for (const key of Object.keys(object)) if (key.toLowerCase() === lower) return _ok_str(object[key]);
  return "";
}

// 回傳解密後的文字；不是加密回應或解密失敗時回傳空字串。
function _ok_decryptBody(response) {
  const body = _ok_str(response && response.bodyText).trim();
  const authorization = _ok_header(response && response.headers, "x-response-authorization");
  const seconds = Math.floor(_ok_num(_ok_header(response && response.headers, "x-response-time"), 0) / 1000);
  if (!body || !authorization || !(seconds > 0) || !/^[A-Za-z0-9+/=\s]+$/.test(body)) return "";
  try {
    const digest = _ok_sha256Hex(authorization);
    const start = Math.floor((seconds / 600) % 32), step = Math.floor((seconds / 3600) % 32);
    const chars = new Array(32);
    for (let c = 0; c < 32; c += 1) chars[31 - c] = digest[(start + (step + c) * c) % 32];
    const key = _ok_utf8Encode(chars.join("").substring(0, 32));
    while (key.length < 32) key.push(48);
    const zeroIV = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return _ok_utf8Decode(_ok_aes256CbcDecrypt(key, zeroIV, _ok_base64Bytes(body)));
  } catch (_) {
    return "";
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
          "Accept-Language": "zh-TW,zh-CN;q=0.9,zh;q=0.8",
          "User-Agent": _ok_ua,
          Referer: "https://www.okx.com/orbit/livestreams",
          Origin: "https://www.okx.com"
        },
        _ok_object(req.headers)
      ),
      body: req.body === undefined ? null : _ok_str(req.body),
      timeout: _ok_num(req.timeout, 20)
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

  let parsed = _ok_parseJSON(response && response.bodyText);
  if (!parsed || typeof parsed !== "object") parsed = _ok_parseJSON(_ok_decryptBody(response));
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
  if (code < 0) return "3";
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

async function _ok_fetchDirectoryPage(index, pageSize, timeout) {
  const result = await _ok_requestJSON({
    url: `${_ok_baseURL}/priapi/v5/content/public/livestream/users-all?pageIndex=${Math.max(0, _ok_num(index, 0))}&pageSize=${Math.max(1, _ok_num(pageSize, _ok_pageSize))}`,
    timeout: timeout
  });
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

function _ok_isRateLimited(error) {
  const object = _ok_object(error);
  const text = _ok_str(object.message) + " " + _ok_str(object.code) + " " + _ok_str(error);
  return object.code === "RATE_LIMITED" || /RATE_LIMITED|HTTP 429/.test(text);
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
    // 限制同時請求數，避免大量收藏刷新時觸發上游限流；一旦被限流（429）就停止取樣，
    // 保留已取得的房間，避免繼續消耗額度而連帶讓播放、狀態請求也被擋。
    let rateLimited = false;
    for (let offset = 0; offset < probes.length && !rateLimited; offset += 4) {
      const batches = await Promise.all(probes.slice(offset, offset + 4).map(function (probe) {
        return _ok_fetchDirectoryPage(probe.index, probe.pageSize).catch(function (error) {
          if (_ok_isRateLimited(error)) rateLimited = true;
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

let _ok_authPending = null;
async function _ok_fetchAnonymousAuth(forceRefresh, deadline) {
  if (!forceRefresh && _ok_runtime.anonymousToken && Date.now() - _ok_runtime.anonymousTokenFetchedAt < 10 * 60 * 1000) {
    return {token:_ok_runtime.anonymousToken, userUid:_ok_runtime.anonymousUid};
  }
  if (_ok_authPending && (!deadline || _ok_authPending.deadline <= deadline)) return _ok_authPending.promise;
  const flight = {deadline:deadline || Date.now() + 20000};
  flight.promise = _ok_loadAnonymousAuth(forceRefresh, deadline);
  _ok_authPending = flight;
  try { return await flight.promise; }
  finally { if (_ok_authPending === flight) _ok_authPending = null; }
}

async function _ok_loadAnonymousAuth(forceRefresh, deadline) {
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
    timeout: deadline ? _ok_statusTimeout(deadline) : undefined,
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

async function _ok_fetchStatus(shareCode, forceRefresh, deadline) {
  const code = _ok_parseShareCode(shareCode);
  if (!code) _ok_throw("INVALID_ARGS", "A valid OKX livestream shareCode is required", {});
  let auth = await _ok_fetchAnonymousAuth(!!forceRefresh, deadline);
  try {
    const result = await _ok_requestJSON({
      url: `${_ok_baseURL}/priapi/v1/im/livestream/stream/v1/status?shareCode=${encodeURIComponent(code)}`,
      timeout: deadline ? _ok_statusTimeout(deadline) : undefined,
      headers: {
        "im-token": auth.token,
        Referer: _ok_externalURL(code)
      }
    });
    return _ok_object(result.data);
  } catch (error) {
    if (forceRefresh || !error || error.code !== "AUTH_REQUIRED") throw error;
    auth = await _ok_fetchAnonymousAuth(true, deadline);
    const retry = await _ok_requestJSON({
      url: `${_ok_baseURL}/priapi/v1/im/livestream/stream/v1/status?shareCode=${encodeURIComponent(code)}`,
      timeout: deadline ? _ok_statusTimeout(deadline) : undefined,
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
        latencyMode: "standard",
        preferredEngines: protocol === "flv" ? ["mePlayer"] : ["avPlayer", "mePlayer"],
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

function _ok_statusTimeout(deadline) {
  const remaining = (deadline - Date.now()) / 1000;
  if (remaining <= 0) _ok_throw("NETWORK", "直播狀態查詢逾時", {});
  return Math.min(8, remaining);
}

const _ok_favoritePages = Object.create(null), _ok_favoritePagesPending = Object.create(null);
async function _ok_favoriteDirectoryPage(page, deadline) {
  const cached = _ok_favoritePages[page], pending = _ok_favoritePagesPending[page];
  if (cached && Date.now() - cached.at < 15000) return cached.data;
  if (pending && pending.deadline <= deadline) return pending.promise;
  const flight = {deadline:deadline};
  flight.promise = (async function() {
    const data = await _ok_fetchDirectoryPage(page, _ok_pageSize, _ok_statusTimeout(deadline));
    _ok_favoritePages[page] = {at:Date.now(),data:data};
    _ok_remember(_ok_dedupeRooms(data.users), Date.now());
    return data;
  })();
  _ok_favoritePagesPending[page] = flight;
  try { return await flight.promise; }
  finally { if (_ok_favoritePagesPending[page] === flight) delete _ok_favoritePagesPending[page]; }
}

async function _ok_refreshFavorite(roomId, userId) {
  const code = _ok_parseShareCode(roomId), uid = _ok_str(userId).trim(), deadline = Date.now() + 16000;
  if (!code) _ok_throw("INVALID_ARGS", "roomId is required", {field:"roomId"});
  const unknown = Object.assign({}, _ok_runtime.rooms[code] || _ok_fallbackRoom(code, "3"), {liveState:"3"});
  if (uid) unknown.userId = uid;
  let original;
  try {
    const status = await _ok_fetchStatus(code, false, deadline);
    original = _ok_applyFreshStatus(_ok_runtime.rooms[code], code, status);
    if (uid) original.userId = uid;
  } catch (_) {}
  if (original && original.liveState === "1") return original;
  if (!uid || uid === "0") return original || unknown;
  const seen = Object.create(null); seen[code] = true;
  async function verify(rooms) {
    for (const room of rooms) {
      if (!room.roomId || seen[room.roomId] || _ok_str(room.userId) !== uid) continue;
      seen[room.roomId] = true;
      const status = await _ok_fetchStatus(room.roomId, false, deadline);
      if (_ok_statusLiveState(status) === "1") return _ok_applyFreshStatus(room, room.roomId, status);
    }
    return null;
  }
  try {
    const remembered = await verify(Object.keys(_ok_runtime.rooms).map(function(key){return _ok_runtime.rooms[key];}));
    if (remembered) return remembered;
    _ok_statusTimeout(deadline);
    const first = await _ok_favoriteDirectoryPage(0, deadline);
    let current = await verify(_ok_dedupeRooms(first.users));
    if (current) return current;
    const pages = Math.min(30, Math.ceil(first.total / _ok_pageSize));
    for (let page = 1; page < pages; page++) {
      _ok_statusTimeout(deadline);
      const batch = await _ok_favoriteDirectoryPage(page, deadline);
      current = await verify(_ok_dedupeRooms(batch.users));
      if (current) return current;
    }
  } catch (_) { return original || unknown; }
  return original || unknown;
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
    return _ok_refreshFavorite(runtimePayload.roomId, runtimePayload.userId);
  },

  async getLiveState(payload) {
    const runtimePayload = _ok_payload(payload);
    const room = await _ok_refreshFavorite(runtimePayload.roomId, runtimePayload.userId);
    return {liveState:room.liveState};
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
