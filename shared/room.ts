import type { ClientMessage, ErrorCode, ParticipantView, ServerMessage, Status } from './protocol';

/** 이 시간 무소식이면 연결이 끊긴 것으로 표시한다. state 전송 주기 5초의 3배. */
export const DISCONNECT_AFTER_MS = 15_000;
/** 이 시간 무소식이면 목록에서 제거한다. */
export const REMOVE_AFTER_MS = 30_000;
/** 같은 사람을 다시 깨우기까지 기다려야 하는 시간. 깨우는 사람이 아니라 깨워지는 사람에게 붙는다. */
export const WAKE_COOLDOWN_MS = 30_000;

const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export interface Participant {
  connectionId: string;
  name: string;
  status: Status;
  /** 직전 상태. 졸다가 사라진 사람과 자리를 비운 사람을 가르는 유일한 단서다. */
  previousStatus: Status | null;
  lastSeenAt: number;
  lastWokenAt: number | null;
}

export interface Room {
  code: string;
  participants: Participant[];
}

export interface RoomsState {
  rooms: Room[];
  /** 직전 tick 시각. disconnected 표시가 새로 생겼는지 판단하는 데 쓴다. */
  lastTickAt: number | null;
}

export interface Outbound {
  to: string[];
  message: ServerMessage;
}

export interface StepResult {
  state: RoomsState;
  outbound: Outbound[];
}

export function createRoomsState(): RoomsState {
  return { rooms: [], lastTickAt: null };
}

function isDisconnected(participant: Participant, now: number): boolean {
  return now - participant.lastSeenAt >= DISCONNECT_AFTER_MS;
}

function isWakeable(participant: Participant, now: number): boolean {
  if (isDisconnected(participant, now)) return false;
  if (participant.status === 'drowsy') return true;
  // 졸다가 신호가 끊겼다. 고개를 떨궈 얼굴이 사라졌을 수 있으므로 대상으로 남긴다.
  return participant.status === 'unmeasurable' && participant.previousStatus === 'drowsy';
}

function toView(participant: Participant, now: number): ParticipantView {
  return {
    id: participant.connectionId,
    name: participant.name,
    status: participant.status,
    wakeable: isWakeable(participant, now),
    disconnected: isDisconnected(participant, now),
  };
}

function viewsOf(room: Room, now: number): ParticipantView[] {
  return room.participants.map((participant) => toView(participant, now));
}

function findRoomOf(state: RoomsState, connectionId: string): Room | null {
  return (
    state.rooms.find((room) =>
      room.participants.some((participant) => participant.connectionId === connectionId),
    ) ?? null
  );
}

function replaceRoom(state: RoomsState, room: Room): RoomsState {
  return { ...state, rooms: state.rooms.map((existing) => (existing.code === room.code ? room : existing)) };
}

function errorTo(connectionId: string, code: ErrorCode): Outbound {
  return { to: [connectionId], message: { type: 'error', code } };
}

function broadcast(room: Room, now: number, exceptId?: string): Outbound[] {
  const to = room.participants
    .map((participant) => participant.connectionId)
    .filter((id) => id !== exceptId);
  if (to.length === 0) return [];
  return [{ to, message: { type: 'participants', participants: viewsOf(room, now) } }];
}

function handleJoin(
  state: RoomsState,
  connectionId: string,
  roomCode: string,
  name: string,
  now: number,
): StepResult {
  const code = roomCode.toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) {
    return { state, outbound: [errorTo(connectionId, 'invalid-room-code')] };
  }

  // 이미 다른 방에 있었다면 먼저 나간다.
  const left = handleDisconnect(state, connectionId, now);

  const participant: Participant = {
    connectionId,
    name,
    // 아직 아무것도 측정하지 않았다. present라고 말하면 거짓이다.
    status: 'unmeasurable',
    previousStatus: null,
    lastSeenAt: now,
    lastWokenAt: null,
  };

  const existing = left.state.rooms.find((room) => room.code === code);
  const room: Room = existing
    ? { ...existing, participants: [...existing.participants, participant] }
    : { code, participants: [participant] };
  const rooms = existing
    ? left.state.rooms.map((candidate) => (candidate.code === code ? room : candidate))
    : [...left.state.rooms, room];

  return {
    state: { ...left.state, rooms },
    outbound: [
      ...left.outbound,
      { to: [connectionId], message: { type: 'joined', selfId: connectionId, participants: viewsOf(room, now) } },
      ...broadcast(room, now, connectionId),
    ],
  };
}

function handleState(state: RoomsState, connectionId: string, status: Status, now: number): StepResult {
  const room = findRoomOf(state, connectionId);
  if (!room) return { state, outbound: [errorTo(connectionId, 'not-joined')] };

  const before = JSON.stringify(viewsOf(room, now));
  const nextRoom: Room = {
    ...room,
    participants: room.participants.map((participant) =>
      participant.connectionId === connectionId
        ? {
            ...participant,
            status,
            // 상태가 실제로 바뀔 때만 직전 상태를 갱신한다. 같은 상태가 반복돼도 잊지 않는다.
            previousStatus: participant.status === status ? participant.previousStatus : participant.status,
            lastSeenAt: now,
          }
        : participant,
    ),
  };
  const after = JSON.stringify(viewsOf(nextRoom, now));

  return {
    state: replaceRoom(state, nextRoom),
    outbound: before === after ? [] : broadcast(nextRoom, now),
  };
}

function handleWake(state: RoomsState, connectionId: string, targetId: string, now: number): StepResult {
  const room = findRoomOf(state, connectionId);
  if (!room) return { state, outbound: [errorTo(connectionId, 'not-joined')] };
  if (targetId === connectionId) return { state, outbound: [errorTo(connectionId, 'cannot-wake-self')] };

  const target = room.participants.find((participant) => participant.connectionId === targetId);
  if (!target) return { state, outbound: [errorTo(connectionId, 'no-such-target')] };
  if (!isWakeable(target, now)) return { state, outbound: [errorTo(connectionId, 'target-not-wakeable')] };
  if (target.lastWokenAt !== null && now - target.lastWokenAt < WAKE_COOLDOWN_MS) {
    return { state, outbound: [errorTo(connectionId, 'wake-cooldown')] };
  }

  const waker = room.participants.find((participant) => participant.connectionId === connectionId);
  const nextRoom: Room = {
    ...room,
    participants: room.participants.map((participant) =>
      participant.connectionId === targetId ? { ...participant, lastWokenAt: now } : participant,
    ),
  };

  return {
    state: replaceRoom(state, nextRoom),
    outbound: [{ to: [targetId], message: { type: 'wakeRequest', fromName: waker?.name ?? '' } }],
  };
}

export function handleDisconnect(state: RoomsState, connectionId: string, now: number): StepResult {
  const room = findRoomOf(state, connectionId);
  if (!room) return { state, outbound: [] };

  const participants = room.participants.filter(
    (participant) => participant.connectionId !== connectionId,
  );

  if (participants.length === 0) {
    // 마지막 참가자가 나가면 방이 사라진다. 서버 메모리에만 있었으므로 남는 것이 없다.
    return { state: { ...state, rooms: state.rooms.filter((r) => r.code !== room.code) }, outbound: [] };
  }

  const nextRoom: Room = { ...room, participants };
  return { state: replaceRoom(state, nextRoom), outbound: broadcast(nextRoom, now) };
}

export function handleMessage(
  state: RoomsState,
  connectionId: string,
  message: ClientMessage,
  now: number,
): StepResult {
  switch (message.type) {
    case 'join':
      return handleJoin(state, connectionId, message.roomCode, message.name, now);
    case 'state':
      return handleState(state, connectionId, message.status, now);
    case 'wake':
      return handleWake(state, connectionId, message.targetId, now);
    case 'leave':
      return handleDisconnect(state, connectionId, now);
  }
}

export function tick(state: RoomsState, now: number): StepResult {
  // 첫 tick에서 now를 쓰면 before === after가 되어, 그 틱에 막 생긴
  // disconnected 표시를 영영 알리지 못한다. 0을 쓰면 그때 아무도 끊기지
  // 않았을 경우 before === after가 그대로 성립해 헛된 브로드캐스트도 없다.
  const previous = state.lastTickAt ?? 0;

  // 먼저 만료된 참가자를 제거한다. 방 소멸로 이어질 수 있다.
  const stale = state.rooms.flatMap((room) =>
    room.participants
      .filter((participant) => now - participant.lastSeenAt >= REMOVE_AFTER_MS)
      .map((participant) => participant.connectionId),
  );

  let current: RoomsState = state;
  const outbound: Outbound[] = [];
  for (const connectionId of stale) {
    const step = handleDisconnect(current, connectionId, now);
    current = step.state;
    outbound.push(...step.outbound);
  }

  // 남은 방 중 disconnected 표시가 새로 생긴 곳만 다시 알린다.
  for (const room of current.rooms) {
    const before = JSON.stringify(viewsOf(room, previous));
    const after = JSON.stringify(viewsOf(room, now));
    if (before !== after) outbound.push(...broadcast(room, now));
  }

  return { state: { ...current, lastTickAt: now }, outbound };
}
