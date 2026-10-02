// Read-only upstream probe, NOT a player/decode or home-network benchmark.
// Usage: node scripts/smoke-hls.mjs binance|okx [roomId] [samples=12]
// Each curl opens a fresh connection; media bytes are discarded. Never log signed URLs/tokens.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const [platform, requestedRoom, count = '12'] = process.argv.slice(2);
assert.ok(['binance', 'okx'].includes(platform), 'Specify binance or okx');
const samples = Number(count);
assert.ok(Number.isInteger(samples) && samples >= 2 && samples <= 60);
let stage = 'initialization';
async function fetchText(request) {
  const args = ['-fsSL', '--max-time', '20', request.url];
  if (request.method) args.push('-X', request.method);
  for (const [k, v] of Object.entries(request.headers || {})) args.push('-H', `${k}: ${v}`);
  if (request.body) args.push('--data-raw', request.body);
  try { return (await run('curl', args, { maxBuffer: 16 * 1024 * 1024 })).stdout; }
  catch (error) { const failure = new Error('Transport failure'); failure.code = `curl ${error.code}`; throw failure; }
}
async function main() {
  const context = vm.createContext({ console, Host: {
    http: { request: async ({ request }) => ({ status: 200, bodyText: await fetchText(request) }) },
    raise(code) { const error = new Error('Plugin failure'); error.code = code; throw error; }
  } });
  vm.runInContext(await fs.readFile(new URL(`../plugins/${platform}/index.js`, import.meta.url), 'utf8'), context);
  const plugin = context.LiveParsePlugin;
  stage = 'directory';
  const candidates = requestedRoom ? [requestedRoom] : (await plugin.getRooms({ page: 1 })).slice(0, 3).map(room => room.roomId);
  assert.ok(candidates.length, 'No live room found');
  stage = 'playback lookup';
  let roomId, playback;
  for (const candidate of candidates) {
    try { playback = await plugin.getPlayback({ roomId: candidate }); roomId = candidate; break; }
    catch (error) {
      if (error.code !== 'NOT_FOUND' || requestedRoom) throw error;
      console.log(JSON.stringify({ skippedRoom: candidate, code: 'NOT_FOUND' }));
    }
  }
  assert.ok(playback, 'No playable candidate found');
  stage = 'live HLS selection';
  const quality = playback.flatMap(line => Array.from(line.qualitys)).find(q => q.playbackHints?.streamFormat === 'hlsLive');
  assert.ok(quality, 'No live HLS returned');
  console.log(JSON.stringify({ platform, roomId, engines: quality.playbackHints.preferredEngines }));
  const headers = quality.headers || {};
  let playlistURL = quality.url;
  const sequences = new Set();
  let errors = 0;
  for (let i = 0; i < samples; i++) {
    try {
      let manifest = await fetchText({ url: playlistURL, headers });
      // Follow a master playlist without changing or caching the plugin's signed media URL.
      for (let depth = 0; manifest.includes('#EXT-X-STREAM-INF:') && depth < 3; depth++) {
        const lines = manifest.split(/\r?\n/).map(line => line.trim());
        const idx = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
        const variant = lines.slice(idx + 1).find(line => line && !line.startsWith('#'));
        assert.ok(variant, 'Missing variant');
        playlistURL = new URL(variant, playlistURL).href;
        manifest = await fetchText({ url: playlistURL, headers });
      }
      assert.ok(manifest.trimStart().startsWith('#EXTM3U'), 'Invalid playlist');
      assert.ok(!manifest.includes('#EXT-X-ENDLIST'), 'Stream has ended');
      const sequence = manifest.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1];
      assert.ok(sequence, 'Missing sequence');
      const durations = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map(m => Number(m[1]));
      const segments = manifest.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
      assert.ok(segments.length && durations.length, 'Missing full segments');
      const args = ['-fsSL', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code} %{time_total} %{size_download}', new URL(segments.at(-1), playlistURL).href];
      for (const [k,v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
      const { stdout } = await run('curl', args);
      console.log(JSON.stringify({ sample: i, sequence, newSequence: !sequences.has(sequence), windowSeconds: durations.reduce((a,b) => a+b,0), latestSegmentSeconds: durations.at(-1), media: stdout }));
      sequences.add(sequence);
    } catch (error) {
      errors++;
      console.log(JSON.stringify({ sample: i, error: error.code ? `curl ${error.code}` : error.message }));
    }
    if (i + 1 < samples) await new Promise(resolve => setTimeout(resolve, 10000));
  }
  console.log(JSON.stringify({ platform, samples, errors, uniqueSequences: sequences.size, note: 'Fresh-connection transport samples only; not proof of device smoothness.' }));
  if (errors || sequences.size < 2) process.exitCode = 1;
}
main().catch(error => {
  console.error(JSON.stringify({ setupFailed: stage, code: error.code || error.name, note: 'No sensitive URLs logged.' }));
  process.exitCode = 1;
});
