export const VERSION = 1;
export const MAX_BYTES = 65536;
export const SESSION = /^[a-zA-Z0-9_-]{16,64}$/;
export const SUBPROTOCOL = 'lezi-net-v1';

export function authorized(headers, token, websocket = false) {
  if (!token || token.length < 24) return false;
  if (!websocket) return headers.get('authorization') === `Bearer ${token}`;
  const protocols = (headers.get('sec-websocket-protocol') ?? '').split(',').map(x => x.trim());
  return protocols.includes(SUBPROTOCOL) && protocols.includes(`probe.${token}`);
}

export function echo(raw, node, now = Date.now()) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw Error('invalid message size');
  const m = JSON.parse(raw);
  if (m?.v !== VERSION || m.kind !== 'echo' || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(m.id)
    || !Number.isFinite(m.sentAt) || typeof m.padding !== 'string' || m.padding.length > 16384) throw Error('invalid echo');
  return { v: VERSION, kind: 'echo', id: m.id, sentAt: m.sentAt, padding: m.padding, serverAt: now, node };
}

export function validReply(reply, request) {
  return reply?.v === VERSION && reply.kind === 'echo' && reply.id === request.id
    && reply.sentAt === request.sentAt && reply.padding === request.padding && Number.isFinite(reply.serverAt);
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'timing-allow-origin': '*', 'x-content-type-options': 'nosniff',
  } });
}

export async function limitedText(request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) throw Error('message too large');
  const reader = request.body?.getReader();
  if (!reader) throw Error('missing body');
  let size = 0; const parts = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_BYTES) throw Error('message too large'); parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const p of parts) { bytes.set(p, offset); offset += p.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
