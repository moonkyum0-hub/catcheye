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
import { parseClientMessage } from '../shared/parseClientMessage';
import type { ServerMessage } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 1000;
/** ws 기본값은 100MiB다. 이 프로토콜의 메시지는 그 근처도 가지 않는다. */
const MAX_PAYLOAD_BYTES = 4096;
/** 이 주기로 ping을 보내고, 다음 주기까지 pong이 없으면 소켓을 끊는다. */
const PING_INTERVAL_MS = 30_000;

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
      maxPayload: MAX_PAYLOAD_BYTES,
    })
  : new WebSocketServer({ port: PORT, maxPayload: MAX_PAYLOAD_BYTES });

// 기동 실패(포트 점유 등)를 미처리 이벤트로 프로세스가 죽지 않게 한다.
server.on('error', (error) => {
  console.error('서버를 시작하지 못했습니다:', error.message);
  process.exit(1);
});

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

/** 마지막 pong을 받은 소켓들. 반열림 연결은 close 이벤트가 영영 오지 않는다. */
const alive = new WeakSet<WebSocket>();

server.on('connection', (socket) => {
  const connectionId = `c${nextConnectionId}`;
  nextConnectionId += 1;
  sockets.set(connectionId, socket);
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));

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

// 참가자에겐 30초 만료가 있는데 소켓에는 없었다. pong이 없는 소켓을 끊지 않으면
// 반열림 연결이 프로세스 수명 내내 쌓인다.
setInterval(() => {
  for (const [connectionId, socket] of sockets) {
    if (!alive.has(socket)) {
      sockets.delete(connectionId);
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, PING_INTERVAL_MS);

console.log(`${secure ? 'wss' : 'ws'} server listening on :${PORT}`);
