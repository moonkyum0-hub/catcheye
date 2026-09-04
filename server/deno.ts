// Deno Deploy 진입점.
//
// server/index.ts(Node + ws)와 같은 일을 하지만 소켓 API만 다르다. 방 로직은
// shared/room.ts에 전부 있고 여기서는 손대지 않는다. TLS는 플랫폼이 끝내므로
// 인증서 분기도 없다.
//
// 로컬 개발은 여전히 `npm run server`(Node)를 쓴다. 이 파일은 배포용이다.

import { parseClientMessage } from '../shared/parseClientMessage.ts';
import {
  createRoomsState,
  handleDisconnect,
  handleMessage,
  tick,
  type Outbound,
  type RoomsState,
} from '../shared/room.ts';
import type { ServerMessage } from '../shared/protocol.ts';

const TICK_MS = 1000;
/** ws 기본값(100MiB)처럼 큰 프레임을 받아 줄 이유가 없다. */
const MAX_MESSAGE_BYTES = 4096;

let state: RoomsState = createRoomsState();
const sockets = new Map<string, WebSocket>();
let nextConnectionId = 1;

function send(connectionId: string, message: ServerMessage): void {
  const socket = sockets.get(connectionId);
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function flush(outbound: Outbound[]): void {
  for (const item of outbound) {
    for (const connectionId of item.to) send(connectionId, item.message);
  }
}

function advance(step: { state: RoomsState; outbound: Outbound[] }): void {
  state = step.state;
  flush(step.outbound);
}

Deno.serve((request) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    // 인증서 경고를 통과시키거나 살아 있는지 확인할 때 쓰인다.
    return new Response('perclos room server', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(request);
  const connectionId = `c${nextConnectionId}`;
  nextConnectionId += 1;

  socket.onopen = () => {
    sockets.set(connectionId, socket);
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) return;
    const message = parseClientMessage(event.data);
    if (!message) return;
    advance(handleMessage(state, connectionId, message, Date.now()));
  };

  const drop = (): void => {
    if (!sockets.delete(connectionId)) return;
    advance(handleDisconnect(state, connectionId, Date.now()));
  };

  socket.onclose = drop;
  socket.onerror = drop;

  return response;
});

setInterval(() => advance(tick(state, Date.now())), TICK_MS);
