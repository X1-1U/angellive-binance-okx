// Opt-in network probe. Joins public chat read-only and discards media bytes.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
async function http({request}){
  const args=['--silent','--show-error','--fail','--max-time','20',request.url];
  if(request.method)args.push('-X',request.method);
  for(const [k,v] of Object.entries(request.headers||{}))args.push('-H',`${k}: ${v}`);
  if(request.body)args.push('--data-raw',request.body);
  const {stdout}=await run('curl',args,{maxBuffer:8*1024*1024});return {status:200,bodyText:stdout};
}
const c=vm.createContext({Host:{http:{request:http},raise(code,message){throw new Error(`${code}: ${message}`);}}});
vm.runInContext(await fs.readFile(new URL('../plugins/twitch-live/index.js',import.meta.url),'utf8'),c);
const p=c.LiveParsePlugin;
const categories=await p.getCategories();
const category=categories[0].subList[0];
const rooms=await p.getRooms({id:category.id,page:1});assert.ok(rooms.length);
assert.ok(rooms.every((r,i)=>!i||Number(rooms[i-1].liveWatchedCount)>=Number(r.liveWatchedCount)));
console.log('Official category',category.title,rooms.length,'first page',rooms.slice(0,3).map(r=>({login:r.roomId,viewers:r.liveWatchedCount})));
const login=process.argv[2]||rooms[0].roomId;
const groups=await p.getPlayback({roomId:login});
console.log('playback',login,groups[0].qualitys.map(q=>q.title));
const variant=groups[0].qualitys.find(q=>q.title.includes('480p'))||groups[0].qualitys[1];assert.ok(variant);
const plan=await p.getDanmaku({roomId:login});await p.createDanmakuSession({connectionId:'probe',roomId:login,args:plan.args});
const ws=new WebSocket(plan.transport.url),counts=[0,0],started=Date.now();let opened=false,ready=false,frames=0,failure=null,chain=Promise.resolve();
function apply(result){for(const w of result.writes||[]) {assert.equal(w.kind,'text');assert.ok(!w.text.startsWith('PRIVMSG'));ws.send(w.text);}counts[Date.now()-started<30000?0:1]+=(result.messages||[]).length;}
ws.onopen=()=>{opened=true;chain=chain.then(async()=>apply(await p.onDanmakuOpen({connectionId:'probe'}))).catch(e=>{failure=e;});};
ws.onmessage=e=>{frames++;if(String(e.data).includes('ROOMSTATE'))ready=true;chain=chain.then(async()=>apply(await p.onDanmakuFrame({connectionId:'probe',frameType:'text',text:String(e.data)}))).catch(e=>{failure=e;});};
ws.onerror=()=>{failure=new Error('WebSocket transport error');};
const timer=setInterval(()=>{if(opened&&ws.readyState===1)chain=chain.then(async()=>apply(await p.onDanmakuTick({connectionId:'probe'}))).catch(e=>{failure=e;});},15000);
const sequences=new Set();
try{
  for(let i=0;i<5;i++){
    const manifest=(await http({request:{url:variant.url}})).bodyText;
    assert.ok(manifest.startsWith('#EXTM3U'));
    const sequence=(manifest.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)||[])[1];if(sequence)sequences.add(sequence);
    const path=manifest.split(/\r?\n/).filter(l=>l&&!l.startsWith('#')).at(-1);assert.ok(path);
    const {stdout}=await run('curl',['--silent','--show-error','--fail','--max-time','20','--output','/dev/null','--write-out','%{http_code} %{size_download}',new URL(path,variant.url).href]);
    console.log('probe',i,{sequence,media:stdout,chat:counts,frames});
    if(i<4)await new Promise(r=>setTimeout(r,15000));
  }
  await chain;if(failure)throw failure;
  assert.ok(opened&&ready,'anonymous chat must join');assert.ok(counts[0]+counts[1]>0,'must receive real chat');assert.ok(counts[1]>0,'must continue receiving chat after 30 seconds');assert.ok(sequences.size>1,'live manifest must advance');
  console.log('PASS: live segments and sustained anonymous chat',counts);
}finally{clearInterval(timer);ws.close();await p.destroyDanmakuSession({connectionId:'probe'});}
