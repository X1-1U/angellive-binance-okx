// Read-only live directory smoke test; requires network and curl. No playback/chat writes.
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const run = promisify(execFile);
await Promise.all(['binance', 'okx'].map(async id => {
  let requests = 0;
  const context = vm.createContext({ Host: { http: { request: async ({ request }) => {
    requests++;
    const args = ['--silent', '--show-error', '--fail', '--max-time', '20', request.url];
    if (request.method) args.push('-X', request.method);
    for (const [key, value] of Object.entries(request.headers || {})) args.push('-H', `${key}: ${value}`);
    if (request.body) args.push('--data-raw', request.body);
    const { stdout } = await run('curl', args, { maxBuffer: 16 * 1024 * 1024 });
    return { status: 200, bodyText: stdout };
  } } }, console });
  vm.runInContext(await fs.readFile(new URL(`../plugins/${id}/index.js`, import.meta.url), 'utf8'), context);
  const rooms = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await context.LiveParsePlugin.getRooms({ page });
    rooms.push(...batch);
    if (batch.length < 50) break;
  }
  assert.equal(new Set(rooms.map(r => r.roomId)).size, rooms.length);
  assert.ok(rooms.every((r, i) => r.liveState === '1' && (!i || Number(rooms[i - 1].liveWatchedCount) >= Number(r.liveWatchedCount))));
  console.log(JSON.stringify({ platform: id, rooms: rooms.length, requests, top: rooms.slice(0, 3).map(r => ({ name: r.userName, viewers: r.liveWatchedCount })) }));
}));
