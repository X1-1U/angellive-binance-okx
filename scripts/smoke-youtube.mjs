// Opt-in network check: no login/cookies. Media probes discard bytes, never save video.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run = promisify(execFile);
async function request({request}) {
  const args = ['--silent', '--show-error', '--fail', '--max-time', '20', request.url];
  if (request.method) args.push('-X', request.method);
  for (const [k,v] of Object.entries(request.headers || {})) args.push('-H', `${k}: ${v}`);
  if (request.body) args.push('--data-raw', request.body);
  const {stdout} = await run('curl', args, {maxBuffer: 16 * 1024 * 1024});
  if (process.env.YOUTUBE_DEBUG && request.url.includes('/live_chat/get_live_chat')) {
    const data = JSON.parse(stdout).continuationContents?.liveChatContinuation;
    console.log('chat action types', (data?.actions || []).map(a=>Object.keys(a)), 'keys', Object.keys(data || {}));
  }
  return {status: 200, bodyText: stdout};
}
const context = vm.createContext({Host: {http: {request}, raise(code,message) {throw new Error(`${code}: ${message}`);}}, console});
vm.runInContext(await fs.readFile(new URL('../plugins/youtube-tw/index.js',import.meta.url),'utf8'),context);
const plugin = context.LiveParsePlugin;
const rooms = await plugin.getRooms({id:'all',page:1});
assert.ok(rooms.length);
console.log('directory',rooms.length,rooms.slice(0,3).map(r=>({title:r.roomTitle,id:r.roomId})));
const id = process.argv[2] || rooms[0].roomId;
const playback = await plugin.getPlayback({roomId:id});
const qualities = playback[0].qualitys;
console.log('playback',id,qualities.map(q=>q.title));
const variant = qualities.at(-1).url;
let previousSequence = '', unique = 0;
const seenSequences = new Set();
const plan = await plugin.getDanmaku({roomId:id});
const initial = await plugin.createDanmakuSession({connectionId:'smoke',roomId:id,args:plan.args});
console.log('initial chat messages',initial.messages.length);
// Probe for over one minute: catches the commonly observed 30-second media rejection.
for(let i=0;i<8;i++) {
  const manifest = (await request({request:{url:variant}})).bodyText;
  assert.ok(manifest.startsWith('#EXTM3U'));
  const sequence = (manifest.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)||[])[1];
  if(sequence) seenSequences.add(sequence);
  const segment = manifest.split(/\r?\n/).filter(s=>s && !s.startsWith('#')).at(-1);
  assert.ok(segment);
  const url = new URL(segment,variant).href;
  const {stdout} = await run('curl',['--silent','--show-error','--fail','--max-time','20','--output','/dev/null','--write-out','%{http_code} %{size_download}',url]);
  const chat = await plugin.onDanmakuTick({connectionId:'smoke'});
  unique += chat.messages.length;
  console.log('probe',i,{sequence,advanced:sequence!==previousSequence,media:stdout,chatMessages:chat.messages.length});
  previousSequence=sequence;
  if(i<7) await new Promise(resolve=>setTimeout(resolve,10000));
}
assert.ok(seenSequences.size>1,'live playlist must advance');
await plugin.destroyDanmakuSession({connectionId:'smoke'});
console.log('PASS: live media advances; chat continuation ticks complete; unique messages:',unique);
