// Anonymous, read-only Twitch adapter. Public website client ID is not an account secret.
const _tw_id = "twitch-live-test";
const _tw_client = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const _tw_ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const _tw_streamFields = "id title viewersCount previewImageURL(width:640,height:360) game{name}";
const _tw_userFields = "id login displayName profileImageURL(width:150)";
const _tw_cache = Object.create(null), _tw_pending = Object.create(null), _tw_sessions = Object.create(null);
function _tw_str(v) { return v == null ? "" : String(v); }
function _tw_fail(code, message) {
  if (typeof Host.raise === "function") Host.raise(code, message, {});
  throw new Error("LP_PLUGIN_ERROR:" + JSON.stringify({code: code, message: message, context: {}}));
}
function _tw_login(value) {
  const s = _tw_str(value).trim().toLowerCase();
  const match = s.match(/^https?:\/\/(?:(?:www|m)\.)?twitch\.tv\/([a-z0-9_]{1,25})(?:\/?(?:[?#].*)?)?$/);
  const login = match ? match[1] : /^[a-z0-9_]{1,25}$/.test(s) ? s : "";
  return ["directory", "videos", "downloads", "settings", "search", "subscriptions", "login", "signup", "p", "jobs"].indexOf(login) >= 0 ? "" : login;
}
function _tw_requireLogin(value) { const login = _tw_login(value); if (!login) _tw_fail("INVALID_ARGS", "請輸入 Twitch 頻道連結或英文頻道帳號，不支援影片回放／剪輯連結"); return login; }
async function _tw_http(url, body) {
  const r = await Host.http.request({platformId: _tw_id, authMode: "none", request: {
    url: url, method: body === undefined ? "GET" : "POST", timeout: 20,
    headers: Object.assign({"User-Agent": _tw_ua, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8"}, body === undefined ? {} : {"Client-ID": _tw_client, "Content-Type": "application/json", Origin: "https://www.twitch.tv", Referer: "https://www.twitch.tv/"}),
    body: body === undefined ? null : JSON.stringify(body)
  }});
  if (!r || r.status < 200 || r.status >= 300) _tw_fail(r && r.status === 429 ? "RATE_LIMITED" : r && (r.status === 401 || r.status === 403) ? "BLOCKED" : "NETWORK", "Twitch 請求失敗（HTTP " + (r && r.status) + "），可能受地區或匿名存取限制");
  return _tw_str(r.bodyText);
}
async function _tw_gql(query, variables) {
  const raw = await _tw_http("https://gql.twitch.tv/gql", {query: query, variables: variables || {}});
  let result; try { result = JSON.parse(raw); } catch (_) { _tw_fail("UPSTREAM", "Twitch 返回非 JSON 資料"); }
  if (result && Array.isArray(result.errors) && result.errors.some(function(e){return (e.extensions||{}).code === "IntegrityCheckFailed";})) _tw_fail("BLOCKED", "Twitch 拒絕匿名接口請求，可能需要官方客戶端驗證");
  if (!result || result.errors || !result.data) _tw_fail("UPSTREAM", "Twitch 公開接口暫時不可用或已變更");
  return result.data;
}
function _tw_room(user) {
  const s = user.stream || {};
  return {roomId: _tw_str(user.login), userId: _tw_str(user.id), userName: _tw_str(user.displayName || user.login), roomTitle: _tw_str(s.title || (user.lastBroadcast || {}).title || user.displayName), roomCover: _tw_str(s.previewImageURL || user.profileImageURL), userHeadImg: _tw_str(user.profileImageURL), liveState: user.stream ? "1" : "0", liveType: _tw_id, liveWatchedCount: String(Math.max(0, Number(s.viewersCount) || 0)), biz: _tw_str((s.game || {}).name)};
}
function _tw_sort(rooms) { return rooms.sort(function (a,b) { return Number(b.liveWatchedCount) - Number(a.liveWatchedCount) || a.roomId.localeCompare(b.roomId); }); }
async function _tw_user(login) {
  const data = await _tw_gql("query($login:String!){user(login:$login){" + _tw_userFields + " lastBroadcast{title} stream{" + _tw_streamFields + "}}}", {login: login});
  if (!data.user) _tw_fail("NOT_FOUND", "找不到這個 Twitch 頻道");
  return data.user;
}
let _tw_categoriesCache = null, _tw_categoriesPending = null;
async function _tw_categories() {
  if (_tw_categoriesCache && Date.now() - _tw_categoriesCache.at < 300000) return _tw_categoriesCache.items;
  if (_tw_categoriesPending) return _tw_categoriesPending;
  _tw_categoriesPending = (async function () {
    const items = [], seen = Object.create(null), cursors = Object.create(null);
    let after = "";
    for (let page = 0; page < 3; page++) {
      let data;
      try { data = await _tw_gql("{games(first:100" + (after ? ",after:" + JSON.stringify(after) : "") + "){edges{cursor node{id name displayName boxArtURL(width:144,height:192)}} pageInfo{hasNextPage}}}"); }
      catch (error) { if (!items.length) throw error; break; }
      const connection = data.games;
      if (!connection || !Array.isArray(connection.edges)) _tw_fail("UPSTREAM", "Twitch 分類格式已變更");
      for (const edge of connection.edges) {
        const game = edge.node;
        if (!game || !/^\d+$/.test(_tw_str(game.id)) || seen[game.id]) continue;
        seen[game.id] = true;
        items.push({id:_tw_str(game.id),parentId:"root",title:_tw_str(game.displayName||game.name),icon:_tw_str(game.boxArtURL),biz:""});
      }
      const last = connection.edges[connection.edges.length - 1];
      if (!(connection.pageInfo || {}).hasNextPage || !last || !last.cursor || cursors[last.cursor]) break;
      after = last.cursor; cursors[after] = true;
    }
    if (!items.length) _tw_fail("UPSTREAM", "Twitch 未返回可用分類");
    _tw_categoriesCache = {at:Date.now(),items:items}; return items;
  })();
  try { return await _tw_categoriesPending; } finally { _tw_categoriesPending = null; }
}
async function _tw_directory(category) {
  // Old saved global/zh selections resolve to the first official category, never a language filter.
  const key = !category || category === "global" || category === "zh" ? (await _tw_categories())[0].id : _tw_str(category);
  if (!/^\d+$/.test(key)) _tw_fail("INVALID_ARGS", "無效的 Twitch 分類 ID");
  if (_tw_cache[key] && Date.now() - _tw_cache[key].at < 60000) return _tw_cache[key].rooms.slice();
  if (_tw_pending[key]) return (await _tw_pending[key]).slice();
  _tw_pending[key] = (async function () {
    const rooms = [], seen = Object.create(null), cursors = Object.create(null);
    let after = "";
    for (let page = 0; page < 4; page++) {
      let data;
      try { data = await _tw_gql("{game(id:" + JSON.stringify(key) + "){streams(first:30" + (after ? ",after:" + JSON.stringify(after) : "") + "){edges{cursor node{" + _tw_streamFields + " broadcaster{" + _tw_userFields + "}}} pageInfo{hasNextPage}}}}"); }
      catch (error) { if (!rooms.length) throw error; break; }
      if (!data.game) return [];
      const connection = data.game.streams;
      if (!connection || !Array.isArray(connection.edges)) _tw_fail("UPSTREAM", "Twitch 直播目錄格式已變更");
      let added = 0;
      for (const edge of connection.edges) {
        const s = edge.node || {}, user = s.broadcaster;
        if (!user || !user.login || seen[user.login]) continue;
        seen[user.login] = true; added++;
        rooms.push(_tw_room(Object.assign({},user,{stream:s})));
      }
      const last = connection.edges[connection.edges.length - 1];
      if (!added || !(connection.pageInfo || {}).hasNextPage || !last || !last.cursor || cursors[last.cursor]) break;
      after = last.cursor; cursors[after] = true;
    }
    _tw_sort(rooms); _tw_cache[key] = {at: Date.now(), rooms: rooms}; return rooms;
  })();
  try { return (await _tw_pending[key]).slice(); } finally { delete _tw_pending[key]; }
}
function _tw_media(url) { return /^https:\/\/[a-z0-9.-]+\.(?:ttvnw\.net|twitchcdn\.net|live-video\.net|cloudfront\.net)\//i.test(_tw_str(url)); }
function _tw_quality(login,url,title,qn,engines) { return {roomId:login,title:title,qn:qn,url:url,liveCodeType:"m3u8",liveType:_tw_id,userAgent:_tw_ua,headers:{"User-Agent":_tw_ua},playbackHints:{streamFormat:"hlsLive",latencyMode:"standard",preferredEngines:engines||["avPlayer","mePlayer"],isLive:true,requiresCustomSegmentLoader:false,selectionBehavior:"direct",startPositionSeconds:0}}; }
function _tw_tag(value) { return _tw_str(value).replace(/\\([s:nr\\])/g,function (_,c) { return {s:" ", ":":";", n:"\n", r:"\r", "\\":"\\"}[c]; }); }
function _tw_parse(line) {
  const tags = Object.create(null);
  if (line[0] === "@") {
    const end = line.indexOf(" "); if (end < 0) return null;
    for (const pair of line.slice(1,end).split(";")) { const index=pair.indexOf("="); if(index>=0) tags[pair.slice(0,index)] = _tw_tag(pair.slice(index+1)); }
    line=line.slice(end+1);
  }
  let prefix="";
  if(line[0]===":"){const end=line.indexOf(" "); if(end<0)return null;prefix=line.slice(1,end);line=line.slice(end+1);}
  const trailingIndex=line.indexOf(" :"), trailing=trailingIndex<0?"":line.slice(trailingIndex+2);
  const parts=(trailingIndex<0?line:line.slice(0,trailingIndex)).split(" ");
  return {tags:tags,prefix:prefix,command:parts[0],params:parts.slice(1),trailing:trailing};
}
function _tw_write(text) { return {kind:"text",text:text+"\r\n"}; }
function _tw_timer() { return {mode:"heartbeat",intervalMs:15000}; }
function _tw_session(p) { const s=_tw_sessions[_tw_str(p.connectionId)];if(!s)_tw_fail("INVALID_ARGS","Twitch 彈幕連線已失效");return s; }
globalThis.LiveParsePlugin = {
  apiVersion:1,
  async getCategories(){return [{id:"root",title:"Twitch 分類",icon:"",biz:"",subList:(await _tw_categories()).map(function(item){return Object.assign({},item);})}];},
  async getRooms(payload){const p=payload||{},rooms=await _tw_directory(p.id),start=(Math.max(1,Number(p.page)||1)-1)*30;return rooms.slice(start,start+30);},
  async getRoomDetail(payload){return _tw_room(await _tw_user(_tw_requireLogin(payload.roomId)));},
  async getLiveState(payload){return (await _tw_user(_tw_requireLogin(payload.roomId))).stream?"1":"0";},
  async resolveShare(payload){return _tw_room(await _tw_user(_tw_requireLogin(payload.shareCode)));},
  async search(payload){
    const p=payload||{},q=_tw_str(p.keyword).trim();if(!q)_tw_fail("INVALID_ARGS","請輸入頻道名稱或分享地址");if(Number(p.page)>1)return [];
    if(/^https?:\/\//i.test(q))return [_tw_room(await _tw_user(_tw_requireLogin(q)))];
    const data=await _tw_gql("query($q:String!){searchFor(userQuery:$q,platform:\"web\"){channels{edges{item{... on User {"+_tw_userFields+" stream{"+_tw_streamFields+"}}}}}}}",{q:q});
    const edges=(((data.searchFor||{}).channels||{}).edges||[]),rooms=[],seen=Object.create(null);
    for(const edge of edges){const user=edge.item;if(user&&user.login&&user.stream&&!seen[user.login]){seen[user.login]=true;rooms.push(_tw_room(user));}}
    // Exact account lookup also permits adding an offline channel to favorites.
    const login=_tw_login(q);if(login&&!seen[login]){try{rooms.push(_tw_room(await _tw_user(login)));}catch(_){}}
    return _tw_sort(rooms);
  },
  async getPlayback(payload){
    const login=_tw_requireLogin(payload.roomId),user=await _tw_user(login);if(!user.stream)_tw_fail("NOT_FOUND","這個 Twitch 頻道目前未開播");
    const type=payload._testPlayerType === "embed" ? "embed" : "site";
    const data=await _tw_gql("query($login:String!,$type:String!){streamPlaybackAccessToken(channelName:$login,params:{platform:\"web\",playerBackend:\"mediaplayer\",playerType:$type}){value signature}}",{login:login,type:type});
    const token=data.streamPlaybackAccessToken;if(!token||!token.value||!token.signature)_tw_fail("BLOCKED","Twitch 未提供匿名播放授權，可能需要登入或有地區限制");
    const url="https://usher.ttvnw.net/api/channel/hls/"+login+".m3u8?allow_source=true&allow_audio_only=true&sig="+encodeURIComponent(token.signature)+"&token="+encodeURIComponent(token.value);
    const manifest=await _tw_http(url);if(!manifest.trim().startsWith("#EXTM3U"))_tw_fail("UPSTREAM","Twitch HLS 清單無效");
    const qualities=[_tw_quality(login,url,"HLS 自動畫質（不支援即時字幕）",1)],lines=manifest.split(/\r?\n/),seen=Object.create(null);
    for(let i=0;i<lines.length-1;i++){
      if(!lines[i].startsWith("#EXT-X-STREAM-INF:"))continue;
      const media=lines[i+1].trim();if(!_tw_media(media)||seen[media])continue;seen[media]=true;
      const res=lines[i].match(/RESOLUTION=\d+x(\d+)/),fps=lines[i].match(/FRAME-RATE=([\d.]+)/),height=res?Number(res[1]):0;
      const title=height?"HLS "+height+"p"+(fps&&Number(fps[1])>30?"60":""):"僅音訊";
      // 宿主的即時語音字幕只接在 KSME（mePlayer）內核上；單一畫質清單用 FFmpeg 起播也不會逐檔探測。
      qualities.push(_tw_quality(login,media,title,height?height*10+(fps?Math.round(Number(fps[1])):0):0,["mePlayer","avPlayer"]));
    }
    qualities.sort(function(a,b){return b.qn-a.qn;});return [{cdn:"Twitch",displayName:"Twitch 官方 HLS（含官方廣告）",requestContext:{roomId:login},qualitys:qualities}];
  },
  async getDanmaku(payload){const login=_tw_requireLogin(payload.roomId);return {args:{roomId:login,_danmu_type:"websocket"},headers:{Origin:"https://www.twitch.tv","User-Agent":_tw_ua},transport:{kind:"websocket",url:"wss://irc-ws.chat.twitch.tv:443",frameType:"text"},runtime:{driver:"plugin_js_v1",protocolId:"twitch_anonymous_irc",protocolVersion:"1",webSocketHeaderMode:"minimal_no_cookie"}};},
  async createDanmakuSession(payload){const id=_tw_str(payload.connectionId);if(!id)_tw_fail("INVALID_ARGS","缺少 connectionId");_tw_sessions[id]={login:_tw_requireLogin(payload.roomId||(payload.args||{}).roomId),buffer:"",joined:false,ready:false,opened:Date.now(),lastReceived:Date.now(),seen:Object.create(null),order:[]};return {ok:true};},
  // SCHMOOPIIE is the public anonymous IRC placeholder, not a user password/token.
  async onDanmakuOpen(payload){const s=_tw_session(payload);s.opened=Date.now();s.lastReceived=Date.now();return {ok:true,writes:[_tw_write("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership"),_tw_write("PASS SCHMOOPIIE"),_tw_write("NICK justinfan"+Math.floor(10000000+Math.random()*90000000))],timer:_tw_timer()};},
  async onDanmakuTick(payload){const s=_tw_session(payload);if(!s.ready&&Date.now()-s.opened>45000)_tw_fail("NETWORK","Twitch 匿名聊天室加入逾時，等待宿主重連");if(Date.now()-s.lastReceived>90000)_tw_fail("NETWORK","Twitch 聊天室保活逾時，等待宿主重連");return {ok:true,writes:[_tw_write("PING :angellive")],timer:_tw_timer()};},
  async onDanmakuFrame(payload){
    const s=_tw_session(payload);if(payload.frameType!=="text")return {ok:true,messages:[],timer:_tw_timer()};
    s.lastReceived=Date.now();s.buffer+=_tw_str(payload.text);if(s.buffer.length>262144)_tw_fail("UPSTREAM","Twitch IRC 訊息超出大小限制");
    const lines=s.buffer.split("\r\n");s.buffer=lines.pop();const writes=[],messages=[];
    for(const line of lines){const m=_tw_parse(line);if(!m)continue;
      if(m.command==="PING")writes.push(_tw_write("PONG :"+(m.trailing||m.params[0]||"tmi.twitch.tv")));
      if(m.command==="RECONNECT")_tw_fail("NETWORK","Twitch 要求重新連線");
      if(m.command==="001"&&!s.joined){s.joined=true;writes.push(_tw_write("JOIN #"+s.login));}
      if((m.command==="ROOMSTATE"||m.command==="366")&&m.params.indexOf("#"+s.login)>=0)s.ready=true;
      if(m.command==="NOTICE"&&(/authentication failed|improperly formatted auth/i.test(m.trailing)||["msg_channel_suspended","msg_banned","msg_room_not_found"].indexOf(m.tags["msg-id"])>=0))_tw_fail("BLOCKED","Twitch 拒絕匿名聊天室連線");
      if(m.command!=="PRIVMSG"||m.params[0]!=="#"+s.login)continue;s.ready=true;
      const id=m.tags.id;if(id&&s.seen[id])continue;if(id){s.seen[id]=true;s.order.push(id);}
      while(s.order.length>2000)delete s.seen[s.order.shift()];
      const text=m.trailing.replace(/^\x01ACTION (.*)\x01$/, "$1");if(text)messages.push({text:text,nickname:m.tags["display-name"]||m.prefix.split("!")[0]||"Twitch"});
    }
    return {ok:true,messages:messages,writes:writes,timer:_tw_timer()};
  },
  async destroyDanmakuSession(payload){delete _tw_sessions[_tw_str(payload.connectionId)];return {ok:true};}
};

// Experimental, start-time selection only. Never strip segments or proxy media.
const _tw_basePlayback = LiveParsePlugin.getPlayback;
async function _tw_probeCandidate(payload, type) {
  const groups = await _tw_basePlayback(Object.assign({}, payload, {_testPlayerType:type}));
  const group = groups[0];
  const sample = group.qualitys.find(function(q){return q.title.indexOf("480p") >= 0;}) || group.qualitys.find(function(q){return q.url.indexOf("https://usher.ttvnw.net/") !== 0;});
  let status = "unknown";
  if (sample) {
    try {
      const text = await _tw_http(sample.url);
      if (text.trim().indexOf("#EXTM3U") === 0 && text.indexOf("#EXTINF:") >= 0 && text.indexOf("#EXT-X-ENDLIST") < 0) {
        status = /stitched-ad|X-TV-TWITCH-AD-|SCTE35/i.test(text) ? "ad" : "unmarked";
      }
    } catch (_) { /* Keep usable official playback if probing fails. */ }
  }
  group.cdn = "Twitch-" + type;
  const label = status === "ad" ? "偵測到廣告" : status === "unmarked" ? "抽樣未見廣告標記" : "廣告狀態未確認";
  group.displayName = (type === "embed" ? "嵌入入口" : "標準入口") + " · " + label;
  return {group:group,status:status,type:type};
}
LiveParsePlugin.getPlayback = async function(payload) {
  _tw_requireLogin(payload.roomId);
  const errors = [];
  // Independently settle both entries; one failed token must not break the other.
  const results = await Promise.all(["site","embed"].map(async function(type){
    try { return await _tw_probeCandidate(payload,type); } catch (error) { errors.push(error); return null; }
  }));
  const available = results.filter(Boolean);
  if (!available.length) throw errors[0];
  const rank = {unmarked:0,unknown:1,ad:2};
  available.sort(function(a,b){return rank[a.status]-rank[b.status] || (a.type === "site" ? -1 : 1);});
  return available.map(function(item){return item.group;});
};

// ---- zh-TW 翻譯（測試功能）----
// 使用 Google 翻譯的公開網頁端點，不需金鑰；會把待翻譯的標題／聊天文字（不含暱稱）送到 Google。
// 端點非官方承諾，失敗或被限流時一律退回原文並暫停翻譯一段時間。
const _tw_trURL = "https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=zh-TW";
const _tw_trCache = Object.create(null), _tw_trOrder = [];
let _tw_trPausedUntil = 0, _tw_trFailures = 0;
function _tw_trRemember(text, value) {
  if (!(text in _tw_trCache)) _tw_trOrder.push(text);
  _tw_trCache[text] = value;
  while (_tw_trOrder.length > 600) delete _tw_trCache[_tw_trOrder.shift()];
}
function _tw_unescape(text) {
  return _tw_str(text).replace(/&(amp|lt|gt|quot|#39|#x27);/g, function (_, name) { return {amp:"&",lt:"<",gt:">",quot:"\"","#39":"'","#x27":"'"}[name]; });
}
// 只翻譯看起來是自然語句的文字：略過指令、純表情／全大寫洗版、過短內容。
function _tw_translatable(text) {
  const plain = _tw_str(text).replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ").trim();
  if (!plain || plain[0] === "!" || plain.length > 300) return false;
  if (/[\u3040-\u30ff\uac00-\ud7af]/.test(plain)) return true;
  if (/[\u4e00-\u9fff]/.test(plain)) return (plain.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
  const words = plain.split(/\s+/).filter(function (word) { return /[a-z\u00df-\u024f\u0400-\u04ff]{2,}/.test(word); });
  return words.length >= 3;
}
// 批次翻譯；每則文字由服務各自判斷來源語言。回傳與輸入等長的陣列，無法翻譯者為原文。
async function _tw_translateBatch(texts) {
  const output = texts.slice(), need = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] in _tw_trCache) output[i] = _tw_trCache[texts[i]];
    else if (_tw_translatable(texts[i]) && need.indexOf(texts[i]) < 0) need.push(texts[i]);
  }
  if (!need.length || Date.now() < _tw_trPausedUntil) return output;
  try {
    const r = await Host.http.request({platformId: _tw_id, authMode: "none", request: {
      url: _tw_trURL, method: "POST", timeout: 5,
      headers: {"User-Agent": _tw_ua, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"},
      body: need.map(function (text) { return "q=" + encodeURIComponent(text); }).join("&")
    }});
    if (!r || r.status !== 200) throw new Error("translate http " + (r && r.status));
    const rows = JSON.parse(_tw_str(r.bodyText));
    if (!Array.isArray(rows) || rows.length !== need.length) throw new Error("translate shape");
    for (let i = 0; i < need.length; i++) {
      const row = rows[i], translated = _tw_unescape(Array.isArray(row) ? row[0] : row).trim();
      _tw_trRemember(need[i], translated || need[i]);
    }
    _tw_trFailures = 0;
  } catch (_) {
    // 連續失敗時拉長暫停時間（30 秒起，最長 10 分鐘），期間直接顯示原文。
    _tw_trFailures += 1;
    _tw_trPausedUntil = Date.now() + Math.min(30000 * Math.pow(2, _tw_trFailures - 1), 600000);
  }
  for (let i = 0; i < texts.length; i++) if (texts[i] in _tw_trCache) output[i] = _tw_trCache[texts[i]];
  return output;
}
async function _tw_translateRooms(rooms) {
  const titles = await _tw_translateBatch(rooms.map(function (room) { return room.roomTitle; }));
  return rooms.map(function (room, index) { return Object.assign({}, room, {roomTitle: titles[index] || room.roomTitle}); });
}
for (const name of ["getRooms", "search"]) {
  const base = LiveParsePlugin[name];
  LiveParsePlugin[name] = async function (payload) { return _tw_translateRooms(await base.call(LiveParsePlugin, payload)); };
}
for (const name of ["getRoomDetail", "resolveShare"]) {
  const base = LiveParsePlugin[name];
  LiveParsePlugin[name] = async function (payload) { return (await _tw_translateRooms([await base.call(LiveParsePlugin, payload)]))[0]; };
}

// 聊天翻譯：frame 回調不等待網路，待翻譯訊息先排隊，由每秒一次的 tick 批次翻譯後送出（延遲約 1–2 秒）。
const _tw_trBatchSize = 12, _tw_trQueueLimit = 36;
function _tw_trTimer() { return {mode:"heartbeat",intervalMs:1000}; }
const _tw_baseFrame = LiveParsePlugin.onDanmakuFrame, _tw_baseTick = LiveParsePlugin.onDanmakuTick, _tw_baseOpen = LiveParsePlugin.onDanmakuOpen;
LiveParsePlugin.onDanmakuOpen = async function (payload) {
  const result = await _tw_baseOpen.call(LiveParsePlugin, payload), s = _tw_session(payload);
  s.queue = []; s.lastPing = Date.now(); result.timer = _tw_trTimer(); return result;
};
LiveParsePlugin.onDanmakuFrame = async function (payload) {
  const result = await _tw_baseFrame.call(LiveParsePlugin, payload), s = _tw_session(payload), now = [];
  if (!s.queue) s.queue = [];
  const paused = Date.now() < _tw_trPausedUntil;
  for (const message of result.messages || []) {
    if (message.text in _tw_trCache) now.push(Object.assign({}, message, {text: _tw_trCache[message.text]}));
    else if (!paused && _tw_translatable(message.text)) s.queue.push(message);
    else now.push(message);
  }
  // 聊天過快時，超出上限的最舊訊息直接以原文送出，不讓佇列無限延遲。
  while (s.queue.length > _tw_trQueueLimit) now.push(s.queue.shift());
  result.messages = now; result.timer = _tw_trTimer(); return result;
};
LiveParsePlugin.onDanmakuTick = async function (payload) {
  const s = _tw_session(payload);
  if (!s.queue) s.queue = [];
  let result = {ok:true,writes:[]};
  // 原本每 15 秒一次的保活與逾時檢查維持不變，只是改由 1 秒 tick 計數觸發。
  if (Date.now() - (s.lastPing || 0) >= 15000) { result = await _tw_baseTick.call(LiveParsePlugin, payload); s.lastPing = Date.now(); }
  const batch = s.queue.splice(0, _tw_trBatchSize);
  const texts = batch.length ? await _tw_translateBatch(batch.map(function (message) { return message.text; })) : [];
  result.messages = batch.map(function (message, index) { return Object.assign({}, message, {text: texts[index] || message.text}); });
  result.timer = _tw_trTimer(); return result;
};
