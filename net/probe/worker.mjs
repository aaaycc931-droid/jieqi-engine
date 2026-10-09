import { DurableObject } from 'cloudflare:workers';
import { authorized, echo, json, limitedText, SESSION, SUBPROTOCOL } from './protocol.mjs';

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (!['/ping', '/echo', '/ws'].includes(u.pathname)) return new Response('Not found', { status: 404 });
    const ws = u.pathname === '/ws';
    if (!env.PROBE_TOKEN || env.PROBE_TOKEN.length < 24) return json({ error: 'probe disabled' }, 503);
    if (!authorized(request.headers, env.PROBE_TOKEN, ws)) return json({ error: 'unauthorized' }, 401);
    if (u.pathname === '/ping' && request.method === 'GET') return json({ v: 1, node: 'cloudflare-worker', serverAt: Date.now(), colo: request.cf?.colo ?? null });
    if (!SESSION.test(u.searchParams.get('session') ?? '')) return json({ error: 'invalid session' }, 400);
    // Echo traverses a DO, rather than proving only that the edge Worker is reachable.
    const id = env.PROBE.idFromName(u.searchParams.get('session'));
    return env.PROBE.get(id).fetch(request);
  },
};

export class Probe extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/echo' && request.method === 'POST') {
      try { return json(echo(await limitedText(request), 'cloudflare-do')); }
      catch { return json({ error: 'invalid echo' }, 400); }
    }
    if (path !== '/ws' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'unsupported request' }, 400);
    if (this.ctx.getWebSockets().length >= 8) return json({ error: 'connection limit' }, 429);
    const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ openedAt: Date.now(), messages: 0 });
    return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': SUBPROTOCOL } });
  }

  webSocketMessage(ws, message) {
    const a = ws.deserializeAttachment();
    if (++a.messages > 4000 || Date.now() - a.openedAt > 2 * 60 * 60 * 1000) { ws.close(1008, 'probe limit'); return; }
    ws.serializeAttachment(a);
    try { ws.send(JSON.stringify(echo(message, 'cloudflare-do'))); }
    catch { ws.close(1008, 'invalid echo'); }
  }

  webSocketClose(ws, code, reason) { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason); }
  webSocketError(ws) { ws.close(1011, 'socket error'); }
}
