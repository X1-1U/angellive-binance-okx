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
const binance = await loadPlugin("binance", async (input) => {
  const url = input.request.url;
  if (url.includes("audio-live-recommend/list")) return binanceList;
  if (url.includes("room-detail")) return binanceDetail;
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
assert.equal((await binance.plugin.getLiveState({ roomId: "39715484101961" })).liveState, "2");
assert.equal(binance.requests[0].platformId, "binance");
assert.equal(binance.requests[0].authMode, "none");
assert.equal(binance.requests[0].request.headers.clienttype, "web");

const okxList = await fixture("okx-live-list.json");
const okx = await loadPlugin("okx", async (input) => {
  assert.match(input.request.url, /users-all/);
  return okxList;
});
assert.equal(okx.plugin.apiVersion, 1);
assert.equal((await okx.plugin.getCategories({}))[0].subList[0].id, "all");
const okxRooms = await okx.plugin.getRooms({ id: "all", page: 1 });
assert.equal(okxRooms.length, 1);
assertRoom(okxRooms[0], "okx");
const okxSearch = await okx.plugin.search({ keyword: "測試主播", page: 1 });
assert.equal(okxSearch[0].roomId, "fixtureShareCode-1");
const okxResolved = await okx.plugin.resolveShare({
  shareCode: "https://www.okx.com/livestream/stream-room?shareCode=fixtureShareCode-1"
});
assertRoom(okxResolved, "okx");
assert.equal((await okx.plugin.getLiveState({ roomId: "fixtureShareCode-1" })).liveState, "1");
await assert.rejects(
  () => okx.plugin.getPlayback({ roomId: "fixtureShareCode-1" }),
  (error) => error.code === "UNSUPPORTED" && /authenticated official Stream Room/.test(error.message)
);
assert.equal(okx.requests[0].platformId, "okx");
assert.equal(okx.requests[0].authMode, "none");

console.log("contract: OK (binance, okx)");
