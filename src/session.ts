import type { ClientMessage, ParticipantView, ServerMessage, Status } from '../shared/protocol';

const RECONNECT_DELAY_MS = 2_000;
const STATE_INTERVAL_MS = 5_000;

export interface SessionHandlers {
  onParticipants(participants: ParticipantView[], selfId: string | null): void;
  onWakeRequest(fromName: string): void;
  onError(code: string): void;
  onConnectionChange(connected: boolean): void;
}

export interface Session {
  /** 최신 상태를 보관해 두었다가 5초마다 보낸다. */
  setStatus(status: Status): void;
  wake(targetId: string): void;
  close(): void;
}

export function connectSession(
  url: string,
  roomCode: string,
  name: string,
  handlers: SessionHandlers,
): Session {
  let socket: WebSocket | null = null;
  let selfId: string | null = null;
  let status: Status = 'unmeasurable';
  let closed = false;

  const send = (message: ClientMessage): void => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const open = (): void => {
    if (closed) return;
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      handlers.onConnectionChange(true);
      send({ type: 'join', roomCode, name });
      send({ type: 'state', status });
    });

    socket.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (message.type) {
        case 'joined':
          // 재연결하면 서버가 새 연결 id를 주므로 매번 갱신해야 한다.
          selfId = message.selfId;
          handlers.onParticipants(message.participants, selfId);
          break;
        case 'participants':
          handlers.onParticipants(message.participants, selfId);
          break;
        case 'wakeRequest':
          handlers.onWakeRequest(message.fromName);
          break;
        case 'error':
          // 서버가 하트비트 만료로 우리를 방에서 지웠다. 소켓은 살아 있어서
          // 재연결도 일어나지 않으므로, 다시 참여하지 않으면 영영 돌아가지 못한다.
          // 백그라운드 탭은 인터벌이 분당 1회까지 조여져 30초 만료에 쉽게 걸린다.
          if (message.code === 'not-joined') {
            send({ type: 'join', roomCode, name });
            send({ type: 'state', status });
            break;
          }
          handlers.onError(message.code);
          break;
      }
    });

    socket.addEventListener('close', () => {
      handlers.onConnectionChange(false);
      if (!closed) window.setTimeout(open, RECONNECT_DELAY_MS);
    });
  };

  open();

  const timer = window.setInterval(() => send({ type: 'state', status }), STATE_INTERVAL_MS);

  return {
    setStatus(next) {
      if (next === status) return;
      status = next;
      // 전이는 즉시 보낸다. 5초 인터벌은 하트비트로만 남긴다. 짧은 상태가
      // 주기에 인질로 잡히면 미세수면처럼 잠깐 뜨는 상태를 방이 놓친다.
      send({ type: 'state', status });
    },
    wake(targetId) {
      send({ type: 'wake', targetId });
    },
    close() {
      closed = true;
      window.clearInterval(timer);
      send({ type: 'leave' });
      socket?.close();
    },
  };
}
