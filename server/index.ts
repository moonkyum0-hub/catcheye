import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  createRoomsState,
  handleDisconnect,
  handleMessage,
  tick,
  type Outbound,
  type RoomsState,
} from '../shared/room';
import type { ClientMessage, ServerMessage } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 1000;

let state: RoomsState = createRoomsState();
const sockets = new Map<string, WebSocket>();
let nextConnectionId = 1;

const KEY = 'certs/key.pem';
const CERT = 'certs/cert.pem';
const secure = existsSync(KEY) && existsSync(CERT);

// https 페이지는 평문 ws:// 연결을 열 수 없다(혼합 콘텐츠). 앱을 https로 띄우면
// 이 서버도 wss여야 하므로, 인증서가 있으면 같은 것을 써서 TLS로 올린다.
const server = secure
  ? new WebSocketServer({
      server: createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }).listen(PORT),
    })
  : new WebSocketServer({ port: PORT });

function send(connectionId: string, message: ServerMessage): void {
  const socket = sockets.get(connectionId);
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function flush(outbound: Outbound[]): void {
  for (const item of outbound) {
    for (const connectionId of item.to) send(connectionId, item.message);
  }
}

/** 신뢰할 수 없는 입력이다. 형태를 확인하고 아니면 버린다. */
function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return null;
  const candidate = parsed as { type: unknown };
  switch (candidate.type) {
    case 'join': {
      const { roomCode, name } = parsed as { roomCode?: unknown; name?: unknown };
      if (typeof roomCode !== 'string' || typeof name !== 'string') return null;
      return { type: 'join', roomCode, name: name.slice(0, 40) };
    }
    case 'state': {
      const { status } = parsed as { status?: unknown };
      if (status !== 'present' && status !== 'drowsy' && status !== 'unmeasurable') return null;
      return { type: 'state', status };
    }
    case 'wake': {
      const { targetId } = parsed as { targetId?: unknown };
      if (typeof targetId !== 'string') return null;
      return { type: 'wake', targetId };
    }
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}

server.on('connection', (socket) => {
  const connectionId = `c${nextConnectionId}`;
  nextConnectionId += 1;
  sockets.set(connectionId, socket);

  socket.on('message', (data) => {
    const message = parseClientMessage(data.toString());
    if (!message) return;
    const step = handleMessage(state, connectionId, message, Date.now());
    state = step.state;
    flush(step.outbound);
  });

  socket.on('close', () => {
    sockets.delete(connectionId);
    const step = handleDisconnect(state, connectionId, Date.now());
    state = step.state;
    flush(step.outbound);
  });
});

setInterval(() => {
  const step = tick(state, Date.now());
  state = step.state;
  flush(step.outbound);
}, TICK_MS);

console.log(`${secure ? 'wss' : 'ws'} server listening on :${PORT}`);
