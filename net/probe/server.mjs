import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { authorized, echo, MAX_BYTES, SESSION, SUBPROTOCOL } from './protocol.mjs';

export function createProbeServer({ token, node = 'hong-kong-candidate' } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false });
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'timing-allow-origin': '*', 'x-content-type-options': 'nosniff' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://probe');
    const assets = { '/': 'index.html', '/index.html': 'index.html', '/runner.mjs': 'runner.mjs', '/page.mjs': 'page.mjs' };
    if (req.method === 'GET' && assets[u.pathname]) {
      try { send(res, 200, await readFile(new URL(`public/${assets[u.pathname]}`, import.meta.url), 'utf8'), u.pathname.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'); }
      catch { send(res, 500, { error: 'asset unavailable' }); } return;
    }
    if (!['/ping', '/echo', '/ws'].includes(u.pathname)) { send(res, 404, { error: 'not found' }); return; }
    if (!token || token.length < 24) { send(res, 503, { error: 'probe disabled' }); return; }
    if (!authorized(new Headers(req.headers), token)) { send(res, 401, { error: 'unauthorized' }); return; }
    if (u.pathname === '/ping' && req.method === 'GET') { send(res, 200, { v: 1, node, serverAt: Date.now(), colo: null }); return; }
    if (!SESSION.test(u.searchParams.get('session') ?? '')) { send(res, 400, { error: 'invalid session' }); return; }
    if (u.pathname !== '/echo' || req.method !== 'POST') { send(res, 400, { error: 'unsupported request' }); return; }
    try {
      let size = 0; const parts = [];
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BYTES) { send(res, 413, { error: 'message too large' }); req.resume(); return; } parts.push(chunk); }
      send(res, 200, echo(Buffer.concat(parts).toString('utf8'), node));
    } catch { if (!res.headersSent) send(res, 400, { error: 'invalid echo' }); }
  });
  server.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://probe');
    const reject = status => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (!token || token.length < 24) { reject('503 Service Unavailable'); return; }
    if (!authorized(new Headers(req.headers), token, true)) { reject('401 Unauthorized'); return; }
    if (u.pathname !== '/ws' || !SESSION.test(u.searchParams.get('session') ?? '')) { reject('400 Bad Request'); return; }
    if (sockets.clients.size >= 64) { reject('429 Too Many Requests'); return; }
    sockets.handleUpgrade(req, socket, head, ws => {
      let messages = 0; const openedAt = Date.now();
      ws.on('error', () => {});
      ws.on('message', (raw, binary) => {
        if (++messages > 4000 || Date.now() - openedAt > 2 * 60 * 60 * 1000) { ws.close(1008, 'probe limit'); return; }
        try { if (binary) throw Error('text required'); ws.send(JSON.stringify(echo(raw.toString(), node))); }
        catch { ws.close(1008, 'invalid echo'); }
      });
    });
  });
  return { server, sockets, close: async () => {
    for (const ws of sockets.clients) ws.terminate();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); sockets.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.PROBE_TOKEN;
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(token ?? '')) throw Error('Set PROBE_TOKEN to a random 24–128 character probe token');
  const probe = createProbeServer({ token, node: process.env.PROBE_NODE ?? 'hong-kong-candidate' });
  const host = process.env.PROBE_HOST ?? '127.0.0.1';
  probe.server.listen(Number(process.env.PORT ?? 8788), host, () => console.log(`NET-001 probe listening on ${host}:${probe.server.address().port}; TLS must be supplied by the reverse proxy`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await probe.close(); process.exit(0); });
}
