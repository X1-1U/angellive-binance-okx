import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

let now = 100000;
class Clock extends Date { static now() { return now; } }
const requests = [];
let translateStatus = 200, translateCalls = 0;
const TRANSLATOR = 'https://dmiteb.zzmzx325vip.top:3002/ai-translator/translate', TOKEN = 'fixture-token';
const dictionary = {
  'Ranked grind to the top today': '今天衝排名',
  'that was an insane play lol': '那一波太誇張了',
  'this streamer is really good': '這個主播真的很強',
  'how did he do that': '他怎麼做到的'
};
const user = (login, title) => ({id: 'id-' + login, login, displayName: login, profileImageURL: 'https://static-cdn.jtvnw.net/a.jpg', lastBroadcast: {title}, stream: {id: 'b', title, viewersCount: 10, previewImageURL: 'https://static-cdn.jtvnw.net/p.jpg', game: {name: 'Game'}}});
const context = vm.createContext({Date: Clock, Host: {
  raise(code, message) { const e = new Error(message); e.code = code; throw e; },
  http: {async request(input) {
    requests.push(input);
    const {url, body} = input.request;
    if (url === TRANSLATOR) {
      translateCalls++;
      if (input.request.headers.Authorization !== 'Bearer ' + TOKEN) return {status: 401, bodyText: '{"error":"bad"}'};
      if (translateStatus !== 200) return {status: translateStatus, bodyText: ''};
      const {texts} = JSON.parse(body);
      assert.ok(texts.length >= 1 && texts.length <= 20, 'service accepts at most 20 texts');
      return {status: 200, bodyText: JSON.stringify({translations: texts.map((text) => dictionary[text] || text)})};
    }
    if (url.startsWith('https://usher.ttvnw.net/')) return {status: 200, bodyText: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10,RESOLUTION=1920x1080,FRAME-RATE=60\nhttps://video.ttvnw.net/full.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://video.ttvnw.net/audio.m3u8\n'};
    if (url.startsWith('https://video.ttvnw.net/')) return {status: 200, bodyText: '#EXTM3U\n#EXTINF:2.0,\nseg.ts\n'};
    const {query, variables} = JSON.parse(body);
    let data;
    if (query.includes('games(first')) data = {games: {edges: [{cursor: 'c', node: {id: '509658', name: 'Just Chatting', displayName: '純聊天', boxArtURL: ''}}], pageInfo: {hasNextPage: false}}};
    else if (query.includes('game(id')) data = {game: {streams: {edges: [{cursor: 'c', node: {...user('hot', 'Ranked grind to the top today').stream, broadcaster: user('hot', 'Ranked grind to the top today')}}], pageInfo: {hasNextPage: false}}}};
    else if (query.includes('streamPlaybackAccessToken')) data = {streamPlaybackAccessToken: {value: '{}', signature: 'sig'}};
    else data = {user: user(variables.login, 'Ranked grind to the top today')};
    return {status: 200, bodyText: JSON.stringify({data})};
  }}
}});
vm.runInContext(await fs.readFile(new URL('../plugins/twitch-live-test/index.js', import.meta.url), 'utf8'), context);
const p = context.LiveParsePlugin;

// 分類使用 Twitch 官方在地化名稱；房間標題翻譯成 zh-TW 並快取。
assert.equal((await p.getCategories())[0].subList[0].title, '純聊天');
// 未填密碼：不呼叫翻譯服務，顯示原文。
assert.equal((await p.getRooms({id: '509658'}))[0].roomTitle, 'Ranked grind to the top today');
assert.equal(translateCalls, 0, 'no token means no translation requests');
// 密碼驗證：正確、錯誤、未填。
assert.equal((await p.validateCredential({apiToken: 'Bearer ' + TOKEN})).state, 'valid');
assert.equal((await p.validateCredential({apiToken: 'wrong'})).state, 'invalid');
assert.equal((await p.getCredentialStatus({})).state, 'invalid');
const valid = await p.validateCredential({apiToken: TOKEN});
assert.equal(valid.credentialKind, 'token'); assert.equal(valid.authorizationType, 'api');
translateCalls = 0;
assert.equal((await p.getRooms({id: '509658', apiToken: TOKEN}))[0].roomTitle, '今天衝排名');
assert.equal((await p.getRoomDetail({roomId: 'hot', apiToken: TOKEN})).roomTitle, '今天衝排名');
assert.equal(translateCalls, 1, 'titles are cached');

// 單一畫質優先 mePlayer（宿主字幕需要），自動畫質維持 AVPlayer 並排在後面。
const groups = await p.getPlayback({roomId: 'hot'});
const qualities = Array.from(groups[0].qualitys);
assert.equal(qualities[0].title, 'HLS 1080p60');
assert.deepEqual(Array.from(qualities[0].playbackHints.preferredEngines), ['mePlayer', 'avPlayer']);
const auto = qualities.find((quality) => quality.url.startsWith('https://usher.ttvnw.net/'));
assert.deepEqual(Array.from(auto.playbackHints.preferredEngines), ['avPlayer', 'mePlayer']);
assert.ok(auto.title.includes('不支援即時字幕'));

// 聊天：frame 不等待翻譯；tick 批次翻譯；指令／洗版／短句直接原文。
await p.createDanmakuSession({connectionId: 'c', roomId: 'hot'});
assert.equal((await p.onDanmakuOpen({connectionId: 'c'})).timer.intervalMs, 1000);
const frame = (text) => p.onDanmakuFrame({connectionId: 'c', frameType: 'text', text});
const privmsg = (id, text) => `@id=${id};display-name=U${id} :u!u@u PRIVMSG #hot :${text}\r\n`;
await frame(':tmi.twitch.tv 001 justinfan1 :Welcome\r\n');
translateCalls = 0;
let r = await frame(privmsg(1, 'that was an insane play lol') + privmsg(2, 'KEKW KEKW KEKW') + privmsg(3, '!discord') + privmsg(4, 'gg wp'));
assert.deepEqual(Array.from(r.messages, (m) => m.text), ['KEKW KEKW KEKW', '!discord', 'gg wp']);
assert.equal(translateCalls, 0, 'frame callback never waits on the network');
now += 1000;
r = await p.onDanmakuTick({connectionId: 'c'});
assert.deepEqual(Array.from(r.messages, (m) => [m.nickname, m.text]), [['U1', '那一波太誇張了']]);
assert.equal(Array.from(r.writes).length, 0, 'no PING before 15s');
assert.equal(translateCalls, 1);
r = await frame(privmsg(5, 'that was an insane play lol'));
assert.equal(r.messages[0].text, '那一波太誇張了', 'cached translation is delivered immediately');
now += 15000;
assert.ok((await p.onDanmakuTick({connectionId: 'c'})).writes[0].text.startsWith('PING'), 'keepalive still sent every 15s');

// 翻譯服務失敗：原文照常送出，之後暫停翻譯、frame 直接送原文。
translateStatus = 429;
await frame(privmsg(6, 'this streamer is really good'));
now += 1000;
r = await p.onDanmakuTick({connectionId: 'c'});
assert.equal(r.messages[0].text, 'this streamer is really good');
translateCalls = 0;
r = await frame(privmsg(7, 'how did he do that'));
assert.equal(r.messages[0].text, 'how did he do that');
now += 1000; await p.onDanmakuTick({connectionId: 'c'});
assert.equal(translateCalls, 0, 'paused after failure');
translateStatus = 200; now += 31000;
await frame(privmsg(8, 'how did he do that'));
now += 1000;
assert.equal((await p.onDanmakuTick({connectionId: 'c'})).messages[0].text, '他怎麼做到的', 'translation resumes after the pause');

// 佇列上限：聊天過快時，最舊的訊息以原文送出。
let burst = '';
for (let i = 0; i < 40; i++) burst += privmsg(100 + i, `brand new sentence number ${i} here`);
r = await frame(burst);
assert.equal(r.messages.length, 4);
assert.ok(requests.every((item) => item.authMode === 'none' && item.platformId === 'twitch-live-test'));
const translateRequest = requests.find((item) => item.request.url === TRANSLATOR && item.request.body.includes('insane'));
assert.ok(!/U1|display-name/.test(translateRequest.request.body), 'nicknames are not sent for translation');
assert.ok(requests.every((item) => item.request.url === TRANSLATOR || !('Authorization' in (item.request.headers || {}))), 'the token is only sent to the translation service');
// 宿主清除 Token 後（瀏覽呼叫不再帶 apiToken），聊天也停止翻譯。
await p.getRooms({id: '509658'});
r = await frame(privmsg(900, 'one more brand new sentence here'));
assert.equal(r.messages[0].text, 'one more brand new sentence here');
console.log('twitch-test contract: OK (token-gated zh-TW titles/chat, queue/cache/backoff, credential validation, subtitle-capable engine hints)');
