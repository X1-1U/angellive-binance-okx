import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(name) {
  return JSON.parse(await fs.readFile(path.join(root, "fixtures", name), "utf8"));
}

async function loadPlugin(pluginId, responder) {
  const requests = [];
  const Host = {
    raise(code, message, context) {
      const error = new Error(message);
      error.code = code;
      error.context = context;
      throw error;
    },
    makeError(code, message, context) {
      const error = new Error(message);
      error.code = code;
      error.context = context;
      return error;
    },
    http: {
      async request(input) {
        requests.push(input);
        const body = await responder(input);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          url: input.request.url,
          bodyText: JSON.stringify(body),
          bodyBase64: null
        };
      }
    }
  };
  const context = vm.createContext({
    Host,
    console,
    JSON,
    Math,
    Number,
    Object,
    String,
    Array,
    Date,
    Error,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout
  });
  context.globalThis = context;
  const source = await fs.readFile(path.join(root, "plugins", pluginId, "index.js"), "utf8");
  new vm.Script(source, { filename: `${pluginId}/index.js` }).runInContext(context);
  return { plugin: context.LiveParsePlugin, requests };
}

function assertRoom(room, expectedType) {
  for (const key of [
    "userName",
    "roomTitle",
    "roomCover",
    "userHeadImg",
    "liveState",
    "userId",
    "roomId",
    "liveWatchedCount"
  ]) assert.equal(typeof room[key], "string", `${expectedType}.${key}`);
  assert.equal(room.liveType, expectedType);
}

const binanceList = await fixture("binance-live-list.json");
const binanceDetail = await fixture("binance-room-detail.json");
const binanceMP4Detail = await fixture("binance-room-detail-mp4.json");
const binanceLiveItem = binanceList.data.vos[0];
const binanceLiveDetail = {
  code: "000000",
  message: "ok",
  success: true,
  data: binanceLiveItem
};
const binanceChat = await fixture("binance-chat.json");
const nextBinanceChat = { code: "000000", success: true, data: { liveRoomChatMessage: [
  { seqId: 103, content: "第三條測試彈幕", displayName: "觀眾丙" },
  { seqId: 104, content: "第四條測試彈幕", displayName: "觀眾丁" }
] } };
const largeSequenceChat = { code: "000000", success: true, data: { liveRoomChatMessage: [
  { seqId: "90071992547409921", content: "大序號一", displayName: "甲" },
  { seqId: "90071992547409922", content: "大序號二", displayName: "乙" }
] } };
let binanceChatCalls = 0;
const binance = await loadPlugin("binance", async (input) => {
  const url = input.request.url;
  if (url.includes("feed/live/list")) {
    const body = JSON.parse(input.request.body);
    return body.pageIndex === 1
      ? binanceList
      : { code: "000000", success: true, data: { vos: [] } };
  }
  if (url.includes("feed-recommend/list")) return binanceList;
  if (url.includes("audio-live-recommend/list")) {
    return { code: "000000", success: true, data: { spaceLiveList: [] } };
  }
  if (url.includes("get-live-room-chat-message")) {
    binanceChatCalls += 1;
    if (binanceChatCalls === 1) return binanceChat;
    if (binanceChatCalls <= 3) return nextBinanceChat;
    return largeSequenceChat;
  }
  if (url.includes("room-detail")) {
    if (url.includes("44853539475241")) return binanceMP4Detail;
    if (url.includes("49990000123456")) return binanceLiveDetail;
    return binanceDetail;
  }
  throw new Error(`Unexpected Binance URL: ${url}`);
});
assert.equal(binance.plugin.apiVersion, 1);
assert.equal((await binance.plugin.getCategories({}))[0].subList[0].id, "all");
const binanceRooms = await binance.plugin.getRooms({ id: "all", page: 1 });
assert.equal(binanceRooms.length, 1);
assertRoom(binanceRooms[0], "binance");
assert.equal((await binance.plugin.getRooms({ id: "all", page: 2 })).length, 0);
const binanceResolved = await binance.plugin.resolveShare({
  shareCode: "https://www.binance.com/en/square/audio/replay?id=39715484101961"
});
assertRoom(binanceResolved, "binance");
assert.equal(binanceResolved.liveState, "2");
const binancePlayback = await binance.plugin.getPlayback({ roomId: "39715484101961" });
assert.equal(binancePlayback[0].qualitys[0].liveCodeType, "m3u8");
assert.equal(binancePlayback[0].qualitys[0].playbackHints.streamFormat, "hlsVod");
assert.equal(binancePlayback[0].qualitys[0].playbackHints.latencyMode, "standard");
assert.deepEqual(Array.from(binancePlayback[0].qualitys[0].playbackHints.preferredEngines), ["mePlayer"]);
const binanceMP4Playback = await binance.plugin.getPlayback({ roomId: "44853539475241" });
assert.equal(binanceMP4Playback[0].qualitys[0].title, "MP4 回放");
assert.equal(binanceMP4Playback[0].qualitys[0].liveCodeType, "m3u8");
assert.equal(binanceMP4Playback[0].qualitys[0].url.endsWith(".mp4"), true);
assert.equal(binanceMP4Playback[0].qualitys[0].playbackHints.streamFormat, "hlsVod");
assert.equal(binanceMP4Playback[0].qualitys[0].playbackHints.isLive, false);
const binanceFavoriteRoom = await binance.plugin.getRoomDetail({
  roomId: "39715484101961",
  userId: "fixture-square-uid"
});
assert.equal(binanceFavoriteRoom.roomId, "49990000123456");
assert.equal(binanceFavoriteRoom.liveState, "1");
assert.equal(
  (await binance.plugin.getLiveState({
    roomId: "39715484101961",
    userId: "fixture-square-uid"
  })).liveState,
  "1"
);
const binanceFavoritePlayback = await binance.plugin.getPlayback({
  roomId: "39715484101961",
  userId: "fixture-square-uid"
});
assert.equal(binanceFavoritePlayback[0].qualitys[0].roomId, "49990000123456");
assert.equal(binanceFavoritePlayback[0].qualitys[0].playbackHints.isLive, true);
const binanceFavoriteDanmaku = await binance.plugin.getDanmaku({
  roomId: "39715484101961",
  userId: "fixture-square-uid"
});
assert.equal(binanceFavoriteDanmaku.args.roomId, "49990000123456");
assert.equal((await binance.plugin.getLiveState({ roomId: "39715484101961" })).liveState, "2");
assert.equal(binance.requests[0].platformId, "binance");
assert.equal(binance.requests[0].authMode, "none");
assert.equal(binance.requests[0].request.headers.clienttype, "web");
assert.equal(binance.requests[0].request.headers.versioncode, "web");
assert.deepEqual(JSON.parse(binance.requests[0].request.body), { pageIndex: 1, pageSize: 20 });
assert.equal(binance.requests.some((item) => item.request.url.includes("feed-recommend/list")), true);
const binanceDanmaku = await binance.plugin.getDanmaku({ roomId: "49990000123456" });
assert.equal(binanceDanmaku.transport.kind, "websocket");
assert.equal(binanceDanmaku.transport.url, "wss://stream.binance.com:9443/ws");
assert.equal(binanceDanmaku.transport.frameType, "text");
assert.equal(binanceDanmaku.runtime.driver, "plugin_js_v1");
assert.equal(binanceDanmaku.runtime.webSocketHeaderMode, "minimal_no_cookie");
const danmakuSession = await binance.plugin.createDanmakuSession({
  connectionId: "fixture-connection",
  roomId: "49990000123456",
  args: binanceDanmaku.args
});
assert.equal(danmakuSession.timer, undefined);
assert.equal(danmakuSession.messages.length, 2);
const binanceOpen = await binance.plugin.onDanmakuOpen({
  connectionId: "fixture-connection"
});
assert.equal(binanceOpen.timer.mode, "heartbeat");
assert.equal(binanceOpen.timer.intervalMs, 3000);
const ignoredBinanceFrame = await binance.plugin.onDanmakuFrame({
  connectionId: "fixture-connection",
  frameType: "text",
  text: JSON.stringify({ result: null, id: 1 })
});
assert.equal(ignoredBinanceFrame.messages.length, 0);
assert.equal(ignoredBinanceFrame.timer.mode, "heartbeat");
const firstBinanceTick = await binance.plugin.onDanmakuTick({ connectionId: "fixture-connection" });
assert.equal(firstBinanceTick.messages.length, 2);
assert.equal(firstBinanceTick.messages[0].nickname, "觀眾丙");
assert.equal(firstBinanceTick.timer.mode, "heartbeat");
assert.equal(firstBinanceTick.timer.intervalMs, 3000);
const duplicateBinanceTick = await binance.plugin.onDanmakuTick({ connectionId: "fixture-connection" });
assert.equal(duplicateBinanceTick.messages.length, 0);
const largeSequenceTick = await binance.plugin.onDanmakuTick({ connectionId: "fixture-connection" });
assert.equal(largeSequenceTick.messages.length, 2);
assert.equal(
  binance.requests.some((item) => item.request.url.includes("get-live-room-chat-message") && item.request.url.includes("&_=")),
  true
);
assert.equal((await binance.plugin.destroyDanmakuSession({ connectionId: "fixture-connection" })).ok, true);

const okxList = await fixture("okx-live-list.json");
const okxToken = await fixture("okx-anonymous-token.json");
const okxStatus = await fixture("okx-live-status.json");
const okxPlaybackInfo = await fixture("okx-playback-info.json");
const okxNewest = await fixture("okx-danmaku-newest.json");
const okxHistory = await fixture("okx-danmaku-history.json");
const okxPush = await fixture("okx-danmaku-push.json");
const okx = await loadPlugin("okx", async (input) => {
  const url = input.request.url;
  if (url.includes("users-all")) return okxList;
  if (url.includes("anonymous-token")) return okxToken;
  if (url.includes("/status?")) return okxStatus;
  if (url.includes("/livestream/v1/info?")) return okxPlaybackInfo;
  throw new Error(`Unexpected OKX URL: ${url}`);
});
assert.equal(okx.plugin.apiVersion, 1);
assert.equal((await okx.plugin.getCategories({}))[0].subList[0].id, "all");
const okxRooms = await okx.plugin.getRooms({ id: "all", page: 1 });
assert.equal(okxRooms.length, 1);
assertRoom(okxRooms[0], "okx");
const okxFavoriteRoom = await okx.plugin.getRoomDetail({
  roomId: "oldFixtureShare-1",
  userId: "872836765600919552"
});
assert.equal(okxFavoriteRoom.roomId, "fixtureShareCode-1");
assert.equal(okxFavoriteRoom.liveState, "1");
assert.equal(
  (await okx.plugin.getLiveState({
    roomId: "oldFixtureShare-1",
    userId: "872836765600919552"
  })).liveState,
  "1"
);
const okxFavoritePlayback = await okx.plugin.getPlayback({
  roomId: "oldFixtureShare-1",
  userId: "872836765600919552"
});
assert.equal(okxFavoritePlayback[0].qualitys[0].roomId, "fixtureShareCode-1");
const okxFavoriteDanmaku = await okx.plugin.getDanmaku({
  roomId: "oldFixtureShare-1",
  userId: "872836765600919552"
});
assert.equal(okxFavoriteDanmaku.args.roomId, "fixtureShareCode-1");
const okxSearch = await okx.plugin.search({ keyword: "測試主播", page: 1 });
assert.equal(okxSearch[0].roomId, "fixtureShareCode-1");
const okxResolved = await okx.plugin.resolveShare({
  shareCode: "https://www.okx.com/livestream/stream-room?shareCode=fixtureShareCode-1"
});
assertRoom(okxResolved, "okx");
assert.equal((await okx.plugin.getLiveState({ roomId: "fixtureShareCode-1" })).liveState, "1");
const okxPlayback = await okx.plugin.getPlayback({ roomId: "fixtureShareCode-1" });
assert.equal(okxPlayback.length, 2);
assert.equal(okxPlayback[0].qualitys[0].liveCodeType, "m3u8");
assert.equal(okxPlayback[0].qualitys.some((item) => item.liveCodeType === "flv"), true);
const okxInfoRequest = okx.requests.find((item) => item.request.url.includes("/livestream/v1/info?"));
assert.equal(okxInfoRequest.request.headers.Platform, "web");
assert.equal(okxInfoRequest.request.headers["im-token"], "fixture-im-token");
const okxDanmaku = await okx.plugin.getDanmaku({ roomId: "fixtureShareCode-1" });
assert.equal(okxDanmaku.transport.kind, "websocket");
assert.equal(okxDanmaku.transport.frameType, "text");
assert.equal(okxDanmaku.headers["im-token"], "fixture-im-token");
const okxDanmakuSession = await okx.plugin.createDanmakuSession({
  connectionId: "okx-fixture-connection",
  roomId: "fixtureShareCode-1",
  args: okxDanmaku.args,
  headers: okxDanmaku.headers
});
assert.equal(okxDanmakuSession.ok, true);
const okxOpen = await okx.plugin.onDanmakuOpen({ connectionId: "okx-fixture-connection" });
assert.equal(
  Array.from(okxOpen.writes, (item) => JSON.parse(item.text).websocketCommand).join(","),
  "WSAuth"
);
const okxAuthFrame = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify({ websocketCommand: "WSAuth", code: 0, data: {} })
});
assert.equal(
  Array.from(okxAuthFrame.writes, (item) => JSON.parse(item.text).websocketCommand).join(","),
  "WSSubscribeToLivestream,WSGetNewestSeq"
);
const newestFrame = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify(okxNewest)
});
assert.equal(JSON.parse(newestFrame.writes[0].text).websocketCommand, "WSGetMsgByPage");
const historyFrame = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify(okxHistory)
});
assert.equal(historyFrame.messages.length, 2);
assert.equal(historyFrame.messages[0].nickname, "OKX 觀眾甲");
const pushFrame = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify(okxPush)
});
assert.equal(pushFrame.messages.length, 1);

const okxEndedStatus = {
  code: "0",
  msg: "",
  data: {
    status: 3,
    allowRecording: 1,
    channelId: "fixture-ended-channel"
  }
};
const okxEnded = await loadPlugin("okx", async (input) => {
  const url = input.request.url;
  if (url.includes("users-all")) return okxList;
  if (url.includes("anonymous-token")) return okxToken;
  if (url.includes("/status?")) return okxEndedStatus;
  throw new Error(`Unexpected ended OKX URL: ${url}`);
});
const okxStaleDirectoryRooms = await okxEnded.plugin.getRooms({ id: "all", page: 1 });
assert.equal(okxStaleDirectoryRooms[0].liveState, "1");
assert.equal(
  (await okxEnded.plugin.getLiveState({ roomId: "fixtureShareCode-1" })).liveState,
  "2"
);
assert.equal(
  (await okxEnded.plugin.getRoomDetail({ roomId: "fixtureShareCode-1" })).liveState,
  "2"
);
await assert.rejects(
  () => okxEnded.plugin.getPlayback({ roomId: "fixtureShareCode-1" }),
  (error) => error && error.code === "NOT_FOUND"
);
assert.equal(pushFrame.messages[0].text, "即時訊息");
assert.equal(pushFrame.timer.mode, "heartbeat");
assert.equal(pushFrame.timer.intervalMs, 5000);
const singlePushFrame = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify({ websocketCommand: "WSPushMsg", code: 0, data: {
    channelId: "fixture-channel-1",
    seq: "90071992547409923",
    textMessage: { text: "單條即時訊息" },
    senderName: { nickname: "OKX 觀眾丁" }
  } })
});
assert.equal(singlePushFrame.messages[0].text, "單條即時訊息");
const newestAfterMiss = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify({ websocketCommand: "WSGetNewestSeq", code: 0, data: {
    seqDtoList: [{ channelId: "fixture-channel-1", seq: "90071992547409924" }]
  } })
});
assert.equal(JSON.parse(newestAfterMiss.writes[0].text).websocketCommand, "WSGetMsgByPage");
const duplicatePush = await okx.plugin.onDanmakuFrame({
  connectionId: "okx-fixture-connection",
  frameType: "text",
  text: JSON.stringify(okxPush)
});
assert.equal(duplicatePush.messages.length, 0);
assert.equal(
  (await okx.plugin.onDanmakuTick({ connectionId: "okx-fixture-connection" })).writes[0].text,
  "ping"
);
assert.equal(
  (await okx.plugin.destroyDanmakuSession({ connectionId: "okx-fixture-connection" })).ok,
  true
);
assert.equal(okx.requests[0].platformId, "okx");
assert.equal(okx.requests[0].authMode, "none");

console.log("contract: OK (binance, okx)");
