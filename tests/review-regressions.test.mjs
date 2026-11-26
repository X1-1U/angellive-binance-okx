import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const fixture = async name => JSON.parse(await fs.readFile(new URL(`fixtures/${name}.json`, root), 'utf8'));
const bnOld = (await fixture('binance-room-detail')).data;
const bnLive = (await fixture('binance-live-list')).data.vos[0];
const bnOK = data => ({code:'000000', success:true, data});
const okxUser = (await fixture('okx-live-list')).data.users[0];
const okxToken = await fixture('okx-anonymous-token');
const okxLive = await fixture('okx-live-status');
const okxPlayback = await fixture('okx-playback-info');

async function loadPlugin(id, responder, clock = Date) {
  const requests = [];
  const context = vm.createContext({Date:clock, Host:{
    raise(code, message) {throw Object.assign(new Error(message), {code});},
    http:{request:async({request}) => {
      requests.push(request);
      const response = await responder(request);
      return typeof response?.bodyText === 'string' ? response : {status:200, bodyText:JSON.stringify(response)};
    }}
  }});
  vm.runInContext(await fs.readFile(new URL(`plugins/${id}/index.js`, root), 'utf8'), context);
  return {plugin:context.LiveParsePlugin, requests};
}

for (const failedOld of [false, true]) {
  test(`OKX playback and chat find the live session after an ${failedOld ? 'unreachable' : 'ended'} older session`, async() => {
    const oldId = 'oldFixtureShare-1', newId = 'fixtureShareCode-1';
    const users = [
      {...okxUser,livestream:{...okxUser.livestream,shareCode:oldId,viewerCount:100}},
      {...okxUser,livestream:{...okxUser.livestream,shareCode:newId,viewerCount:1}}
    ];
    const {plugin} = await loadPlugin('okx', async r => {
      const url = new URL(r.url);
      if (url.pathname.endsWith('users-all')) return {code:'0',data:{total:2,users}};
      if (url.pathname.endsWith('anonymous-token')) return okxToken;
      if (url.pathname.endsWith('/status')) {
        if (url.searchParams.get('shareCode') === oldId) {
          if (failedOld) throw new Error('Old session unavailable');
          return {code:'0',data:{status:3}};
        }
        return okxLive;
      }
      if (url.pathname.endsWith('/info')) return okxPlayback;
      throw new Error('Unexpected request');
    });
    const payload = {roomId:oldId,userId:okxUser.authorId};
    const groups = await plugin.getPlayback(payload);
    assert.ok(groups.length > 0);
    assert.ok(groups.every(group => group.requestContext.roomId === newId));
    const chat = await plugin.getDanmaku(payload);
    assert.equal(chat.args.roomId, newId);
    assert.equal(chat.args.channelId, okxLive.data.channelId);
  });
}

test('OKX retries an unanswered history request even when newer push messages arrive', async() => {
  let now = 100000;
  const {plugin} = await loadPlugin('okx', async() => {throw new Error('Chat test must not use HTTP');}, {now:()=>now});
  const connectionId = 'history-retry', channelId = 'fixture-channel-1';
  const frame = (websocketCommand, data) => plugin.onDanmakuFrame({connectionId,frameType:'text',text:JSON.stringify({websocketCommand,code:0,data})});
  const historyWrites = result => Array.from(result.writes || []).filter(write => write.text !== 'ping').map(write => JSON.parse(write.text)).filter(write => write.websocketCommand === 'WSGetMsgByPage');
  await plugin.createDanmakuSession({connectionId,roomId:'fixtureShareCode-1',args:{channelId,token:'fixture-token'}});
  await plugin.onDanmakuOpen({connectionId});
  await frame('WSAuth', {});
  const initial = await frame('WSGetNewestSeq', {seqDtoList:[{channelId,seq:102}]});
  assert.equal(historyWrites(initial)[0].data.lastSeq, '102');
  now += 5000;
  assert.equal(historyWrites(await plugin.onDanmakuTick({connectionId})).length, 0);
  await frame('WSMessage', {channelId,seq:104,textMessage:{text:'A newer push'}});
  now += 5000;
  const retry = historyWrites(await plugin.onDanmakuTick({connectionId}));
  assert.equal(retry.length, 1, 'missing history must be retried at the deadline');
  assert.equal(retry[0].data.lastSeq, '102', 'retry the missing requested range, not the pushed high-water mark');
  now += 5000;
  assert.equal(historyWrites(await plugin.onDanmakuTick({connectionId})).length, 0, 'avoid retrying on every heartbeat');
  now += 5000;
  assert.equal(historyWrites(await plugin.onDanmakuTick({connectionId})).length, 1, 'continue retrying if still unanswered');
  await frame('WSGetMsgByPage', {channelId,messageList:[{channelId,seq:102,textMessage:{text:'Recovered history'}}]});
  now += 10000;
  assert.equal(historyWrites(await plugin.onDanmakuTick({connectionId})).length, 0, 'acknowledgment must stop the timeout retry');
});

async function chatSession() {
  let now = 100000;
  const {plugin} = await loadPlugin('okx', async() => {throw new Error('Unexpected HTTP');}, {now:()=>now});
  const connectionId = 'correlated-history', channelId = 'fixture-channel-1';
  const frame = (command, data, requestId, code = 0) => plugin.onDanmakuFrame({connectionId,frameType:'text',text:JSON.stringify({websocketCommand:command,data,requestId,code})});
  const history = result => Array.from(result.writes || []).filter(write => write.text !== 'ping').map(write => JSON.parse(write.text)).filter(write => write.websocketCommand === 'WSGetMsgByPage');
  await plugin.createDanmakuSession({connectionId,roomId:'fixtureShareCode-1',args:{channelId,token:'fixture-token'}});
  await plugin.onDanmakuOpen({connectionId});
  await frame('WSAuth', {});
  return {plugin,connectionId,channelId,frame,history,advance:ms=>{now += ms;},newest:seq=>frame('WSGetNewestSeq',{seqDtoList:[{channelId,seq}]})};
}

test('OKX ignores a delayed duplicate acknowledgment for an earlier history range', async() => {
  const s = await chatSession();
  const first = s.history(await s.newest(102))[0];
  s.advance(10000);
  const duplicate = s.history(await s.plugin.onDanmakuTick({connectionId:s.connectionId}))[0];
  const data = {channelId:s.channelId,messageList:[{channelId:s.channelId,seq:102,textMessage:{text:'History 102'}}]};
  await s.frame('WSGetMsgByPage',data,first.requestId);
  const next = s.history(await s.newest(103))[0];
  assert.ok(next, 'new range is requested after acknowledging the first range');
  await s.frame('WSMessage',{channelId:s.channelId,seq:104,textMessage:{text:'Push 104'}});
  await s.frame('WSGetMsgByPage',data,duplicate.requestId);
  s.advance(10000);
  const retry = s.history(await s.plugin.onDanmakuTick({connectionId:s.connectionId}));
  assert.equal(retry.length,1,'stale reply must not clear the active range');
  assert.equal(retry[0].data.lastSeq,'103');
});

for (const withRequestId of [true,false]) {
  test(`OKX accepts an empty successful history acknowledgment ${withRequestId ? 'with' : 'without'} request ID`, async() => {
    const s = await chatSession();
    const initial = s.history(await s.newest(102))[0];
    await s.frame('WSGetMsgByPage',{channelId:s.channelId,messageList:[]},withRequestId ? initial.requestId : undefined);
    assert.equal(s.history(await s.newest(102)).length,0,'empty success must complete this range');
    s.advance(10000);
    assert.equal(s.history(await s.plugin.onDanmakuTick({connectionId:s.connectionId})).length,0);
  });
}

test('OKX does not treat an error reply as successful history delivery', async() => {
  const s = await chatSession();
  const initial = s.history(await s.newest(102))[0];
  await s.frame('WSGetMsgByPage',{channelId:s.channelId,messageList:[]},initial.requestId,500);
  s.advance(10000);
  assert.equal(s.history(await s.plugin.onDanmakuTick({connectionId:s.connectionId})).length,1);
});

test('YouTube offline metadata omissions do not erase known favorite identity or artwork', async() => {
  const replies = [
    {playabilityStatus:{status:'OK'},videoDetails:{isLive:true,channelId:'UCdemo',title:'晚間直播',author:'測試主播',thumbnail:{thumbnails:[{url:'https://i.ytimg.com/test.jpg'}]}}},
    {playabilityStatus:{status:'LIVE_STREAM_OFFLINE'}},
    {status:503,bodyText:''}
  ];
  const {plugin} = await loadPlugin('youtube-tw', async() => replies.shift());
  const roomId = 'testvideo01';
  await plugin.resolveShare({shareCode:roomId});
  const snapshot = room => ({state:room.liveState,title:room.roomTitle,userId:room.userId,name:room.userName,cover:room.roomCover});
  const payload = {roomId,userId:'UCdemo'};
  const expected = {title:'晚間直播',userId:'UCdemo',name:'測試主播',cover:'https://i.ytimg.com/test.jpg'};
  assert.deepEqual(snapshot(await plugin.getRoomDetail(payload)), {state:'0',...expected});
  assert.deepEqual(snapshot(await plugin.getRoomDetail(payload)), {state:'3',...expected});
});

test('YouTube offline cold refresh retains the supplied favorite channel ID', async() => {
  const {plugin} = await loadPlugin('youtube-tw', async() => ({playabilityStatus:{status:'LIVE_STREAM_OFFLINE'}}));
  const room = await plugin.getRoomDetail({roomId:'testvideo01',userId:'UCdemo'});
  assert.equal(room.liveState, '0');
  assert.equal(room.userId, 'UCdemo');
});

test('YouTube applies fresh titles without clearing metadata omitted in the new details', async() => {
  const replies = [
    {playabilityStatus:{status:'OK'},videoDetails:{isLive:true,channelId:'UCdemo',title:'舊標題',author:'測試主播',thumbnail:{thumbnails:[{url:'https://i.ytimg.com/test.jpg'}]}}},
    {playabilityStatus:{status:'OK'},videoDetails:{isLive:false,title:'新標題'}}
  ];
  const {plugin} = await loadPlugin('youtube-tw', async() => replies.shift());
  const payload = {roomId:'testvideo01',userId:'UCdemo'};
  await plugin.getRoomDetail(payload);
  const room = await plugin.getRoomDetail(payload);
  assert.equal(room.roomTitle, '新標題');
  assert.equal(room.liveState, '0');
  assert.equal(room.userName, '測試主播');
  assert.equal(room.userId, 'UCdemo');
  assert.equal(room.roomCover, 'https://i.ytimg.com/test.jpg');
});

test('Binance recalculates remaining deadline after a slow successful profile lookup', async() => {
  let now = 100000;
  const {plugin} = await loadPlugin('binance', async r => {
    let data, delay;
    if (r.url.includes('room-detail')) {
      const isOld = r.url.includes('39715484101961');
      data = isOld ? bnOld : bnLive;
      delay = 7900;
    } else if (r.url.includes('pgc/user/client')) {
      data = {squareUid:'fixture-square-uid', liveStatusVO:{contentId:bnLive.id}};
      delay = 7000;
    } else throw new Error('Unexpected request');
    now += Math.min(delay, r.timeout * 1000);
    if (delay > r.timeout * 1000) throw Object.assign(new Error('Timed out'), {code:'NETWORK'});
    return bnOK(data);
  }, {now:()=>now});
  const room = await plugin.getRoomDetail({roomId:'39715484101961',userId:'fixture-square-uid'});
  assert.ok(now <= 116000, `16-second budget exceeded: ${now - 100000}ms`);
  assert.equal(room.liveState, '2', 'retain the freshly confirmed replay when new-room validation times out');
});

for (const scenario of [
  {name:'failed earlier page', livePage:2, failedPage:1},
  {name:'two empty earlier pages', livePage:4, failedPage:0},
  {name:'failed earlier candidate validation', livePage:2, failedPage:0, failedCandidate:true},
  {name:'failed earlier candidate on the same page', livePage:1, failedPage:0, failedCandidateSamePage:true}
]) {
  test(`Binance uses a successful prefetched live page despite ${scenario.name}`, async() => {
    const {plugin} = await loadPlugin('binance', async r => {
      if (r.url.includes('room-detail')) {
        if (r.url.includes('49990000123455')) throw new Error('One candidate validation unavailable');
        return bnOK(r.url.includes('39715484101961') ? bnOld : bnLive);
      }
      if (r.url.includes('pgc/user/client')) throw new Error('Profile unavailable');
      if (r.url.includes('feed/live/list')) {
        const page = JSON.parse(r.body).pageIndex;
        if (page === scenario.failedPage) throw new Error('One directory page unavailable');
        return bnOK({vos:page === scenario.livePage ? scenario.failedCandidateSamePage ? [{...bnLive,id:'49990000123455'},bnLive] : [bnLive] : scenario.failedCandidate && page === 1 ? [{...bnLive,id:'49990000123455'}] : []});
      }
      throw new Error('Unexpected request');
    });
    const room = await plugin.getRoomDetail({roomId:'39715484101961',userId:'fixture-square-uid'});
    assert.equal(room.roomId, '49990000123456');
    assert.equal(room.liveState, '1');
  });
}

test('Binance stops after an entirely rate-limited directory batch', async() => {
  const {plugin,requests} = await loadPlugin('binance',async r => {
    if (r.url.includes('room-detail')) return bnOK(bnOld);
    if (r.url.includes('pgc/user/client')) throw new Error('Profile unavailable');
    if (r.url.includes('feed/live/list')) return {status:429,bodyText:''};
    throw new Error('Unexpected request');
  });
  const room = await plugin.getRoomDetail({roomId:'39715484101961',userId:'fixture-square-uid'});
  assert.equal(room.liveState,'2');
  assert.equal(requests.filter(r=>r.url.includes('feed/live/list')).length,4,'do not start further batches after every page was rate-limited');
});
