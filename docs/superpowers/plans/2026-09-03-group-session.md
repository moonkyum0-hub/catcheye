# 그룹 세션 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 사람이 방 코드로 모여 서로의 졸음 상태를 보고, 조는 사람을 버튼으로 깨울 수 있게 한다.

**Architecture:** 방 상태 기계(`shared/room.ts`)를 소켓도 타이머도 모르는 순수 함수로 만들고, 서버는 그것을 `ws`에 연결하는 얇은 껍데기로 둔다. 클라이언트도 같은 방식으로 코어 이벤트 → 상태 변환(`src/sessionStatus.ts`)을 순수 모듈로 분리한다.

**Tech Stack:** Node + `ws` + `tsx`, TypeScript(strict), vitest. 기존 측정 코어(96 테스트)는 그대로 둔다.

**설계 문서:** `docs/superpowers/specs/2026-09-03-group-session-design.md`

## Global Constraints

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- **PERCLOS 수치·EAR·영상은 서버로 보내지 않는다.** 방을 넘는 상태는 `'present' | 'drowsy' | 'unmeasurable'` 셋뿐이다.
- **"모른다"를 "멀쩡함"으로 보여주지 않는다.** 측정 불가는 `unmeasurable`이며 `present`가 아니다.
- 시각은 전부 서버 시계로 찍는다. 클라이언트의 `performance.now()` 값은 방을 넘지 않는다.
- `shared/room.ts`는 소켓·타이머·DOM을 import하지 않는다. `src/sessionStatus.ts`도 마찬가지다.
- 깨우기 권한은 서버가 강제한다. 클라이언트를 믿지 않는다.
- 상수: `DISCONNECT_AFTER_MS 15000`, `REMOVE_AFTER_MS 30000`, `WAKE_COOLDOWN_MS 30000`, `DROWSY_HOLD_MS 90000`, 방 코드 6자 `[A-Z0-9]`, `state` 전송 주기 5초.
- 기존 96개 테스트는 계속 통과해야 한다.
- 커밋 메시지는 "무엇을"보다 "왜". 마지막 줄에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| 파일 | 책임 | 층 |
|---|---|---|
| `shared/protocol.ts` | 메시지·상태 타입. 클라이언트와 서버가 함께 import | 타입 |
| `shared/room.ts` | 방 상태 기계. 참여·이탈·상태·깨우기·만료 | 순수 |
| `server/index.ts` | ws 서버. `room.ts`를 소켓에 연결 | I/O |
| `src/sessionStatus.ts` | 코어 이벤트 → `Status` 변환 | 순수 |
| `src/session.ts` | ws 클라이언트. 재연결·하트비트 | I/O |
| `src/app.ts` | 카메라 루프 + 보정 + 세션 연결 + 최소 하네스 | I/O |

---

### Task 1: 프로토콜과 방 상태 기계

이 계획의 핵심. 네트워크 없이 전부 테스트한다.

**Files:**
- Create: `shared/protocol.ts`, `shared/room.ts`
- Modify: `tsconfig.json` (include에 `shared`, `server` 추가), `package.json` (`ws`, `tsx` 설치)
- Test: `shared/room.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type Status = 'present' | 'drowsy' | 'unmeasurable'`
  - `interface ParticipantView { id: string; name: string; status: Status; wakeable: boolean; disconnected: boolean }`
  - `type ClientMessage`, `type ServerMessage`, `type ErrorCode`
  - `interface RoomsState`, `interface Outbound { to: string[]; message: ServerMessage }`, `interface StepResult { state: RoomsState; outbound: Outbound[] }`
  - `function createRoomsState(): RoomsState`
  - `function handleMessage(state: RoomsState, connectionId: string, message: ClientMessage, now: number): StepResult`
  - `function handleDisconnect(state: RoomsState, connectionId: string, now: number): StepResult`
  - `function tick(state: RoomsState, now: number): StepResult`
  - 상수 `DISCONNECT_AFTER_MS`, `REMOVE_AFTER_MS`, `WAKE_COOLDOWN_MS`

- [ ] **Step 1: 의존성을 설치하고 tsconfig를 넓힌다**

```bash
npm install ws && npm install -D @types/ws tsx
```

`tsconfig.json`의 `include`를 다음으로 바꾼다:

```json
  "include": ["src", "scripts", "shared", "server"]
```

`package.json`의 `scripts`에 한 줄을 추가한다:

```json
    "server": "tsx server/index.ts",
```

- [ ] **Step 2: `shared/protocol.ts`를 작성한다**

타입만 있는 파일이라 테스트가 없다. `room.ts`가 이걸 쓴다.

```ts
/** 방을 넘는 유일한 상태. 수치는 절대 나가지 않는다. */
export type Status = 'present' | 'drowsy' | 'unmeasurable';

export interface ParticipantView {
  id: string;
  name: string;
  status: Status;
  /** 지금 이 사람을 깨울 수 있는지. 서버가 판단한 결과다. */
  wakeable: boolean;
  disconnected: boolean;
}

export type ClientMessage =
  | { type: 'join'; roomCode: string; name: string }
  | { type: 'state'; status: Status }
  | { type: 'wake'; targetId: string }
  | { type: 'leave' };

export type ErrorCode =
  | 'invalid-room-code'
  | 'not-joined'
  | 'no-such-target'
  | 'target-not-wakeable'
  | 'wake-cooldown'
  | 'cannot-wake-self';

export type ServerMessage =
  | { type: 'joined'; selfId: string; participants: ParticipantView[] }
  | { type: 'participants'; participants: ParticipantView[] }
  | { type: 'wakeRequest'; fromName: string }
  | { type: 'error'; code: ErrorCode };
```

- [ ] **Step 3: 실패하는 테스트를 작성한다**

`shared/room.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DISCONNECT_AFTER_MS,
  REMOVE_AFTER_MS,
  WAKE_COOLDOWN_MS,
  createRoomsState,
  handleDisconnect,
  handleMessage,
  tick,
  type RoomsState,
  type StepResult,
} from './room';
import type { ParticipantView, ServerMessage, Status } from './protocol';

function join(state: RoomsState, id: string, name: string, now: number): StepResult {
  return handleMessage(state, id, { type: 'join', roomCode: 'ABC123', name }, now);
}

function setStatus(state: RoomsState, id: string, status: Status, now: number): StepResult {
  return handleMessage(state, id, { type: 'state', status }, now);
}

/** outbound에서 특정 종류의 메시지만 골라낸다. */
function messagesOfType<T extends ServerMessage['type']>(
  result: StepResult,
  type: T,
): Array<Extract<ServerMessage, { type: T }>> {
  return result.outbound
    .map((o) => o.message)
    .filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
}

function viewOf(result: StepResult, id: string): ParticipantView | undefined {
  const latest = messagesOfType(result, 'participants').at(-1) ?? messagesOfType(result, 'joined').at(-1);
  return latest?.participants.find((p) => p.id === id);
}

describe('참여와 이탈', () => {
  it('방에 들어가면 자기 id와 참가자 목록을 받는다', () => {
    const result = join(createRoomsState(), 'c1', '문겸', 1000);
    const joined = messagesOfType(result, 'joined')[0];
    expect(joined?.selfId).toBe('c1');
    expect(joined?.participants).toHaveLength(1);
    expect(joined?.participants[0]?.name).toBe('문겸');
  });

  it('처음 상태는 unmeasurable이다', () => {
    // 아직 아무것도 측정하지 않았다. present라고 말하면 거짓이다.
    const result = join(createRoomsState(), 'c1', '문겸', 1000);
    expect(messagesOfType(result, 'joined')[0]?.participants[0]?.status).toBe('unmeasurable');
  });

  it('두 번째 참가자가 들어오면 기존 참가자에게 알린다', () => {
    const first = join(createRoomsState(), 'c1', '문겸', 1000);
    const second = join(first.state, 'c2', '지호', 2000);
    const broadcast = second.outbound.find((o) => o.message.type === 'participants');
    expect(broadcast?.to).toEqual(['c1']);
    expect(messagesOfType(second, 'participants')[0]?.participants).toHaveLength(2);
  });

  it('방 코드 형식이 틀리면 거부한다', () => {
    const result = handleMessage(createRoomsState(), 'c1', { type: 'join', roomCode: 'abc', name: '문겸' }, 1000);
    expect(messagesOfType(result, 'error')[0]?.code).toBe('invalid-room-code');
    expect(result.state.rooms).toHaveLength(0);
  });

  it('방 코드는 대문자로 정규화된다', () => {
    const result = handleMessage(createRoomsState(), 'c1', { type: 'join', roomCode: 'abc123', name: '문겸' }, 1000);
    expect(result.state.rooms[0]?.code).toBe('ABC123');
  });

  it('마지막 참가자가 나가면 방이 사라진다', () => {
    const joined = join(createRoomsState(), 'c1', '문겸', 1000);
    const left = handleDisconnect(joined.state, 'c1', 2000);
    expect(left.state.rooms).toHaveLength(0);
  });

  it('참가자가 남아 있으면 방이 유지되고 나머지에게 알린다', () => {
    const first = join(createRoomsState(), 'c1', '문겸', 1000);
    const second = join(first.state, 'c2', '지호', 2000);
    const left = handleDisconnect(second.state, 'c1', 3000);
    expect(left.state.rooms).toHaveLength(1);
    expect(left.outbound[0]?.to).toEqual(['c2']);
  });

  it('참여하지 않은 연결의 상태 보고는 거부한다', () => {
    const result = setStatus(createRoomsState(), 'c1', 'present', 1000);
    expect(messagesOfType(result, 'error')[0]?.code).toBe('not-joined');
  });
});

describe('상태 전이', () => {
  it('상태가 바뀌면 브로드캐스트한다', () => {
    const joined = join(createRoomsState(), 'c1', '문겸', 1000);
    const changed = setStatus(joined.state, 'c1', 'present', 2000);
    expect(messagesOfType(changed, 'participants')).toHaveLength(1);
  });

  it('상태가 그대로면 브로드캐스트하지 않는다', () => {
    const joined = join(createRoomsState(), 'c1', '문겸', 1000);
    const first = setStatus(joined.state, 'c1', 'present', 2000);
    const same = setStatus(first.state, 'c1', 'present', 3000);
    expect(same.outbound).toHaveLength(0);
  });

  it('drowsy에서 unmeasurable로 가면 깨우기 대상으로 남는다', () => {
    // 고개를 떨궈 얼굴이 사라진 경우다. 자리 비움과 신호가 같지만 직전 상태가 다르다.
    const joined = join(createRoomsState(), 'c1', '문겸', 1000);
    const drowsy = setStatus(joined.state, 'c1', 'drowsy', 2000);
    const lost = setStatus(drowsy.state, 'c1', 'unmeasurable', 3000);
    expect(viewOf(lost, 'c1')?.wakeable).toBe(true);
  });

  it('present에서 unmeasurable로 가면 깨우기 대상이 아니다', () => {
    // 그냥 자리를 비운 것이다.
    const joined = join(createRoomsState(), 'c1', '문겸', 1000);
    const present = setStatus(joined.state, 'c1', 'present', 2000);
    const away = setStatus(present.state, 'c1', 'unmeasurable', 3000);
    expect(viewOf(away, 'c1')?.wakeable).toBe(false);
  });

  it('같은 상태가 반복돼도 직전 상태를 잊지 않는다', () => {
    const joined = join(createRoomsState(), 'c1', '문겸', 1000);
    const drowsy = setStatus(joined.state, 'c1', 'drowsy', 2000);
    const lost = setStatus(drowsy.state, 'c1', 'unmeasurable', 3000);
    const stillLost = setStatus(lost.state, 'c1', 'unmeasurable', 4000);
    // 브로드캐스트가 안 나가는 틱이라 뷰가 아니라 상태를 직접 본다.
    expect(stillLost.state.rooms[0]?.participants[0]?.previousStatus).toBe('drowsy');
  });
});

describe('깨우기', () => {
  /** c1(깨우는 사람)과 c2(조는 사람)가 있는 방을 만든다. */
  function roomWithDrowsyTarget(now: number): RoomsState {
    const a = join(createRoomsState(), 'c1', '문겸', now);
    const b = join(a.state, 'c2', '지호', now);
    return setStatus(b.state, 'c2', 'drowsy', now).state;
  }

  it('조는 사람을 깨우면 그 사람에게만 전달된다', () => {
    const state = roomWithDrowsyTarget(1000);
    const result = handleMessage(state, 'c1', { type: 'wake', targetId: 'c2' }, 2000);
    expect(result.outbound).toHaveLength(1);
    expect(result.outbound[0]?.to).toEqual(['c2']);
    expect(messagesOfType(result, 'wakeRequest')[0]?.fromName).toBe('문겸');
  });

  it('멀쩡한 사람은 깨울 수 없다', () => {
    const a = join(createRoomsState(), 'c1', '문겸', 1000);
    const b = join(a.state, 'c2', '지호', 1000);
    const present = setStatus(b.state, 'c2', 'present', 1000);
    const result = handleMessage(present.state, 'c1', { type: 'wake', targetId: 'c2' }, 2000);
    expect(messagesOfType(result, 'error')[0]?.code).toBe('target-not-wakeable');
  });

  it('자기 자신은 깨울 수 없다', () => {
    const state = roomWithDrowsyTarget(1000);
    const result = handleMessage(state, 'c2', { type: 'wake', targetId: 'c2' }, 2000);
    expect(messagesOfType(result, 'error')[0]?.code).toBe('cannot-wake-self');
  });

  it('없는 사람은 깨울 수 없다', () => {
    const state = roomWithDrowsyTarget(1000);
    const result = handleMessage(state, 'c1', { type: 'wake', targetId: 'c9' }, 2000);
    expect(messagesOfType(result, 'error')[0]?.code).toBe('no-such-target');
  });

  it('같은 사람을 30초 안에 다시 깨울 수 없다', () => {
    const state = roomWithDrowsyTarget(1000);
    const first = handleMessage(state, 'c1', { type: 'wake', targetId: 'c2' }, 2000);
    const second = handleMessage(first.state, 'c1', { type: 'wake', targetId: 'c2' }, 2000 + WAKE_COOLDOWN_MS - 1);
    expect(messagesOfType(second, 'error')[0]?.code).toBe('wake-cooldown');
  });

  it('쿨다운은 다른 사람이 깨우려 해도 적용된다', () => {
    // 쿨다운은 깨우는 사람이 아니라 깨워지는 사람에게 붙는다.
    const a = join(createRoomsState(), 'c1', '문겸', 1000);
    const b = join(a.state, 'c2', '지호', 1000);
    const c = join(b.state, 'c3', '수민', 1000);
    const drowsy = setStatus(c.state, 'c2', 'drowsy', 1000);
    const first = handleMessage(drowsy.state, 'c1', { type: 'wake', targetId: 'c2' }, 2000);
    const second = handleMessage(first.state, 'c3', { type: 'wake', targetId: 'c2' }, 10_000);
    expect(messagesOfType(second, 'error')[0]?.code).toBe('wake-cooldown');
  });

  it('쿨다운이 지나면 다시 깨울 수 있다', () => {
    const state = roomWithDrowsyTarget(1000);
    const first = handleMessage(state, 'c1', { type: 'wake', targetId: 'c2' }, 2000);
    const second = handleMessage(first.state, 'c1', { type: 'wake', targetId: 'c2' }, 2000 + WAKE_COOLDOWN_MS);
    expect(messagesOfType(second, 'wakeRequest')).toHaveLength(1);
  });
});

describe('하트비트 만료', () => {
  it('15초 무소식이면 disconnected로 표시한다', () => {
    const a = join(createRoomsState(), 'c1', '문겸', 0);
    const b = join(a.state, 'c2', '지호', 0);
    const result = tick(b.state, DISCONNECT_AFTER_MS);
    expect(viewOf(result, 'c1')?.disconnected).toBe(true);
  });

  it('disconnected인 사람은 깨울 수 없다', () => {
    // 전달이 안 되므로 깨우기가 성립하지 않는다.
    const a = join(createRoomsState(), 'c1', '문겸', 0);
    const b = join(a.state, 'c2', '지호', 0);
    const drowsy = setStatus(b.state, 'c2', 'drowsy', 0);
    const result = handleMessage(drowsy.state, 'c1', { type: 'wake', targetId: 'c2' }, DISCONNECT_AFTER_MS);
    expect(messagesOfType(result, 'error')[0]?.code).toBe('target-not-wakeable');
  });

  it('30초 무소식이면 목록에서 제거한다', () => {
    const a = join(createRoomsState(), 'c1', '문겸', 0);
    const b = join(a.state, 'c2', '지호', 0);
    const alive = setStatus(b.state, 'c2', 'present', REMOVE_AFTER_MS);
    const result = tick(alive.state, REMOVE_AFTER_MS);
    expect(result.state.rooms[0]?.participants).toHaveLength(1);
    expect(result.state.rooms[0]?.participants[0]?.connectionId).toBe('c2');
  });

  it('전원이 만료되면 방이 사라진다', () => {
    const a = join(createRoomsState(), 'c1', '문겸', 0);
    const result = tick(a.state, REMOVE_AFTER_MS);
    expect(result.state.rooms).toHaveLength(0);
  });

  it('변화가 없으면 tick은 아무것도 내보내지 않는다', () => {
    const a = join(createRoomsState(), 'c1', '문겸', 0);
    const result = tick(a.state, 1000);
    expect(result.outbound).toHaveLength(0);
  });
});
```

- [ ] **Step 4: 테스트를 실행해 실패를 확인한다**

Run: `npx vitest run shared/room.test.ts`
Expected: FAIL — `Failed to resolve import "./room"`

- [ ] **Step 5: `shared/room.ts`를 구현한다**

```ts
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
  const previous = state.lastTickAt ?? now;

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
```

- [ ] **Step 6: 검증한다**

Run: `npm run check`
Expected: tsc 에러 없음, 기존 96개 + 이번 25개 = **121 passed**

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json tsconfig.json shared/ && git commit -m "feat: 방 상태 기계를 순수 모듈로 구현

깨우기 권한과 쿨다운을 서버가 강제한다. 남을 깨울 권한은 곧 남을
방해할 권한이라 클라이언트에 맡길 수 없다.

졸다가 사라진 사람과 자리를 비운 사람은 신호가 같아서, 직전 상태로만
가를 수 있다. 그래서 상태가 실제로 바뀔 때만 previousStatus를 갱신한다."
```

---

### Task 2: ws 서버

**Files:**
- Create: `server/index.ts`

**Interfaces:**
- Consumes: `createRoomsState`, `handleMessage`, `handleDisconnect`, `tick`, `RoomsState` (Task 1)
- Produces: 없음 (진입점)

**주의:** 순수 층 위의 얇은 껍데기다. 방 로직을 여기에 쓰지 마라. 판단이 필요하면 `room.ts`에 있어야 한다.

- [ ] **Step 1: `server/index.ts`를 작성한다**

```ts
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

const server = new WebSocketServer({ port: PORT });

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

console.log(`ws server listening on :${PORT}`);
```

- [ ] **Step 2: 타입 검사와 기동을 확인한다**

Run: `npm run check`
Expected: tsc 에러 없음, 121 passed (I/O 층이라 새 테스트 없음)

Run: `npm run server`
Expected: `ws server listening on :8787`. 확인 후 Ctrl+C로 종료.

- [ ] **Step 3: 커밋**

```bash
git add server/ && git commit -m "feat: 방 상태 기계를 소켓에 연결

서버는 판단하지 않는다. 소켓에서 꺼내 room.ts에 넘기고 돌려받은 것을
내보낼 뿐이다. 들어오는 메시지는 신뢰하지 않고 형태를 확인한 뒤 버린다."
```

---

### Task 3: 코어 이벤트 → 방 상태 변환

**Files:**
- Create: `src/sessionStatus.ts`
- Test: `src/sessionStatus.test.ts`

**Interfaces:**
- Consumes: `AlertEvent` (`src/alertPolicy.ts`), `PerclosResult` (`src/perclos.ts`), `Status` (`shared/protocol.ts`)
- Produces:
  - `const DROWSY_HOLD_MS = 90_000`
  - `interface SessionStatusState { readonly lastAlertAt: number | null }`
  - `const INITIAL_SESSION_STATUS_STATE: Readonly<SessionStatusState>`
  - `interface SessionStatusInput { event: AlertEvent | null; analysis: AnalysisSummary | null; now: number }`
  - `interface AnalysisSummary { value: number | null; observedMs: number; windowSpanMs: number }`
  - `function updateSessionStatus(state: Readonly<SessionStatusState>, input: SessionStatusInput): { state: SessionStatusState; status: Status }`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/sessionStatus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DROWSY_HOLD_MS,
  INITIAL_SESSION_STATUS_STATE,
  updateSessionStatus,
  type AnalysisSummary,
} from './sessionStatus';

const HEALTHY: AnalysisSummary = { value: 0.02, observedMs: 58_000, windowSpanMs: 60_000 };

describe('updateSessionStatus', () => {
  it('경고 이벤트가 오면 drowsy가 된다', () => {
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: { type: 'microsleep', closedMs: 600, at: 1000 },
      analysis: HEALTHY,
      now: 1000,
    });
    expect(result.status).toBe('drowsy');
    expect(result.state.lastAlertAt).toBe(1000);
  });

  it('세 종류 이벤트 모두 drowsy로 간다', () => {
    for (const event of [
      { type: 'perclos', perclos: 0.2, at: 1000 },
      { type: 'microsleep', closedMs: 600, at: 1000 },
      { type: 'saturated', perclos: 1, at: 1000 },
    ] as const) {
      const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, { event, analysis: HEALTHY, now: 1000 });
      expect(result.status).toBe('drowsy');
    }
  });

  it('경고 후 90초 안에는 drowsy를 유지한다', () => {
    const alerted = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: { type: 'perclos', perclos: 0.2, at: 1000 },
      analysis: HEALTHY,
      now: 1000,
    });
    const later = updateSessionStatus(alerted.state, {
      event: null,
      // 재무장 조건에 못 미치는 값이라 시간으로만 풀려야 한다.
      analysis: { value: 0.1, observedMs: 58_000, windowSpanMs: 60_000 },
      now: 1000 + DROWSY_HOLD_MS - 1,
    });
    expect(later.status).toBe('drowsy');
  });

  it('경고 없이 90초가 지나면 present로 돌아온다', () => {
    const alerted = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: { type: 'perclos', perclos: 0.2, at: 1000 },
      analysis: HEALTHY,
      now: 1000,
    });
    const later = updateSessionStatus(alerted.state, {
      event: null,
      analysis: { value: 0.1, observedMs: 58_000, windowSpanMs: 60_000 },
      now: 1000 + DROWSY_HOLD_MS,
    });
    expect(later.status).toBe('present');
  });

  it('PERCLOS가 재무장 값 아래로 내려오면 바로 present가 된다', () => {
    const alerted = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: { type: 'perclos', perclos: 0.2, at: 1000 },
      analysis: HEALTHY,
      now: 1000,
    });
    const recovered = updateSessionStatus(alerted.state, { event: null, analysis: HEALTHY, now: 2000 });
    expect(recovered.status).toBe('present');
    expect(recovered.state.lastAlertAt).toBeNull();
  });

  it('분석 결과가 없으면 unmeasurable이다', () => {
    // 카메라 실패, 보정 미완료, 재보정 필요가 전부 여기로 온다.
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, { event: null, analysis: null, now: 1000 });
    expect(result.status).toBe('unmeasurable');
  });

  it('PERCLOS 값이 null이면 unmeasurable이다', () => {
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: null,
      analysis: { value: null, observedMs: 58_000, windowSpanMs: 60_000 },
      now: 1000,
    });
    expect(result.status).toBe('unmeasurable');
  });

  it('관측 커버리지가 낮으면 unmeasurable이다', () => {
    // 기계가 버벅여 초당 4프레임 미만이면 시간 기반 지표가 구조적으로 꺼진다.
    // 그 상태의 value는 정상처럼 보이지만 멀쩡함으로 읽으면 안 된다.
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: null,
      analysis: { value: 0.02, observedMs: 10_000, windowSpanMs: 60_000 },
      now: 1000,
    });
    expect(result.status).toBe('unmeasurable');
  });

  it('측정 불가여도 방금 경고가 났으면 drowsy다', () => {
    // 고개를 떨구는 순간이다. 경고는 실제 데이터에서 나왔으므로 믿는다.
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: { type: 'microsleep', closedMs: 800, at: 1000 },
      analysis: null,
      now: 1000,
    });
    expect(result.status).toBe('drowsy');
  });

  it('drowsy 중에 측정이 끊기면 unmeasurable로 넘어간다', () => {
    // 서버가 이 전이를 보고 "졸다가 사라짐"으로 판정한다.
    const alerted = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: { type: 'saturated', perclos: 1, at: 1000 },
      analysis: HEALTHY,
      now: 1000,
    });
    const lost = updateSessionStatus(alerted.state, { event: null, analysis: null, now: 2000 });
    expect(lost.status).toBe('unmeasurable');
  });

  it('아무 일도 없으면 present다', () => {
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, { event: null, analysis: HEALTHY, now: 1000 });
    expect(result.status).toBe('present');
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npx vitest run src/sessionStatus.test.ts`
Expected: FAIL — `Failed to resolve import "./sessionStatus"`

- [ ] **Step 3: `src/sessionStatus.ts`를 구현한다**

```ts
import { PERCLOS_REARM, type AlertEvent } from './alertPolicy';
import type { Status } from '../shared/protocol';

/** 마지막 경고로부터 이 시간이 지나야 drowsy가 풀린다. */
export const DROWSY_HOLD_MS = 90_000;
/** 관측 커버리지가 이 아래면 시간 기반 지표를 믿을 수 없다. */
const MIN_COVERAGE = 0.5;

export interface AnalysisSummary {
  value: number | null;
  observedMs: number;
  windowSpanMs: number;
}

export interface SessionStatusState {
  readonly lastAlertAt: number | null;
}

export const INITIAL_SESSION_STATUS_STATE: Readonly<SessionStatusState> = { lastAlertAt: null };

export interface SessionStatusInput {
  event: AlertEvent | null;
  /** 카메라 실패·보정 미완료·재보정 필요면 null. */
  analysis: AnalysisSummary | null;
  now: number;
}

function isMeasurable(analysis: AnalysisSummary | null): boolean {
  if (analysis === null) return false;
  if (analysis.value === null) return false;
  if (analysis.windowSpanMs === 0) return false;
  // 기계가 버벅이면 value는 정상처럼 나오지만 미세수면과 포화 검출이 꺼져 있다.
  // 그 상태를 멀쩡함으로 보고하면 남들이 이 사람을 놓친다.
  return analysis.observedMs / analysis.windowSpanMs >= MIN_COVERAGE;
}

export function updateSessionStatus(
  state: Readonly<SessionStatusState>,
  input: SessionStatusInput,
): { state: SessionStatusState; status: Status } {
  const { event, analysis, now } = input;

  // 경고는 실제 데이터에서 나왔다. 측정이 끊긴 틱이어도 믿는다.
  if (event !== null) {
    return { state: { lastAlertAt: now }, status: 'drowsy' };
  }

  // 코어가 재무장할 만큼 회복했으면 붙잡아 둘 이유가 없다.
  if (analysis !== null && analysis.value !== null && analysis.value < PERCLOS_REARM) {
    return { state: { lastAlertAt: null }, status: 'present' };
  }

  if (!isMeasurable(analysis)) {
    return { state, status: 'unmeasurable' };
  }

  if (state.lastAlertAt !== null && now - state.lastAlertAt < DROWSY_HOLD_MS) {
    return { state, status: 'drowsy' };
  }

  return { state: { lastAlertAt: null }, status: 'present' };
}
```

- [ ] **Step 4: 검증한다**

Run: `npm run check`
Expected: tsc 에러 없음, **132 passed** (121 + 11)

- [ ] **Step 5: 커밋**

```bash
git add src/sessionStatus.ts src/sessionStatus.test.ts && git commit -m "feat: 코어 이벤트를 방이 이해하는 상태로 옮긴다

코어는 순간 이벤트를 내는데 방에 필요한 것은 지속 상태다.
커버리지가 낮은 구간을 present로 보내지 않는 것이 핵심이다 —
그때 value는 정상처럼 보이지만 미세수면 검출이 꺼져 있어서,
멀쩡함으로 보고하면 남들이 이 사람을 놓친다."
```

---

### Task 4: 클라이언트 통합과 최소 하네스

측정 코어와 세션을 잇는다. 화면 설계는 하지 않는다 — 루프를 실제로 굴려볼 최소한만 만든다.

**Files:**
- Create: `src/session.ts`, `src/app.ts`, `.claude/launch.json`, `README.md`
- Test: 브라우저 수동 검증

**Interfaces:**
- Consumes: 측정 코어 전체, `updateSessionStatus` (Task 3), `ClientMessage`/`ServerMessage` (Task 1)
- Produces: 없음 (진입점)

**주의 1:** MediaPipe의 `detectForVideo`는 같은 타임스탬프로 두 번 호출하면 실패한다. 프레임당 한 번만 부른다.

**주의 2:** `requestVideoFrameCallback`이 설치된 TypeScript의 `lib.dom.d.ts`에 없으면 tsc가 에러를 낸다. 그때는 `src/video.d.ts`를 만든다:

```ts
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(callback: (now: number, metadata: object) => void): number;
    cancelVideoFrameCallback(handle: number): void;
  }
}

export {};
```

- [ ] **Step 1: `src/session.ts`를 작성한다**

```ts
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
      status = next;
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
```

- [ ] **Step 2: `src/app.ts`를 작성한다**

```ts
import { INITIAL_ALERT_STATE, updateAlert, type AlertState } from './alertPolicy';
import { buildCalibration, percentile, updateOpenBaseline, type Calibration } from './calibration';
import { startCamera } from './camera';
import { computeEar } from './ear';
import { createFaceTracker } from './faceTracker';
import { classifyFrame } from './frameState';
import { analyzeWindow, WINDOW_MS } from './perclos';
import { INITIAL_SESSION_STATUS_STATE, updateSessionStatus, type SessionStatusState } from './sessionStatus';
import { connectSession, type Session } from './session';
import type { ParticipantView, Status } from '../shared/protocol';
import type { FrameSample } from './types';

const OPEN_PHASE_MS = 15_000;
const CLOSED_PHASE_MS = 3_000;
const DRIFT_WINDOW_MS = 300_000;
const SERVER_URL = `ws://${window.location.hostname}:8787`;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app 요소가 필요하다');

const nameInput = document.createElement('input');
nameInput.placeholder = '이름';
const codeInput = document.createElement('input');
codeInput.placeholder = '방 코드 (예: ABC123)';
const startButton = document.createElement('button');
startButton.textContent = '시작';
const status = document.createElement('pre');
const roster = document.createElement('div');
root.append(nameInput, codeInput, startButton, status, roster);

function render(lines: string[]): void {
  status.textContent = lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 깨우기를 받았을 때 소리를 낸다. 외부 음원 없이 오실레이터로 만든다. */
function playAlarm(): void {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = 880;
  gain.gain.value = 0.2;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  window.setTimeout(() => {
    oscillator.stop();
    void context.close();
  }, 1500);
}

async function main(): Promise<void> {
  startButton.disabled = true;

  const camera = await startCamera();
  if (!camera.ok) {
    render([
      {
        'permission-denied': '카메라 권한이 거부됐습니다.',
        'no-device': '카메라를 찾을 수 없습니다.',
        'device-busy': '다른 앱이 카메라를 쓰고 있습니다. 화상통화 앱을 확인해 주세요.',
        'constraints-unsatisfiable': '이 카메라가 요청한 해상도를 지원하지 않습니다.',
        'playback-failed': '카메라 영상을 재생하지 못했습니다.',
        unknown: '카메라를 열지 못했습니다.',
      }[camera.error],
    ]);
    startButton.disabled = false;
    return;
  }

  const tracker = await createFaceTracker();
  const { video } = camera.handle;

  const readFrame = (timestampMs: number) => {
    const landmarks = tracker.detect(video, timestampMs);
    return landmarks ? computeEar(landmarks, video.videoWidth, video.videoHeight) : null;
  };

  const stop = (): void => {
    camera.handle.stop();
    tracker.close();
    startButton.disabled = false;
  };

  // --- 보정 ---
  const collect = async (label: string, durationMs: number): Promise<number[]> => {
    const samples: number[] = [];
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      const remaining = Math.ceil((durationMs - (performance.now() - start)) / 1000);
      render([`${label} (${remaining}초)`, `수집 ${samples.length}개`]);
      const ear = readFrame(performance.now());
      if (ear) samples.push(ear.mean);
      await sleep(33);
    }
    return samples;
  };

  const built = buildCalibration(
    await collect('평소대로 화면을 보세요', OPEN_PHASE_MS),
    await collect('눈을 감아 주세요', CLOSED_PHASE_MS),
  );

  if (!built.ok) {
    render([
      built.reason === 'no-samples'
        ? '얼굴이 잡히지 않았습니다. 조명과 각도를 확인하고 다시 시작하세요.'
        : '열린 눈과 감은 눈의 차이가 너무 작습니다. 조명을 밝게 하고 다시 시작하세요.',
    ]);
    stop();
    return;
  }

  // --- 세션 연결 ---
  let participants: ParticipantView[] = [];
  let selfId: string | null = null;
  let connected = false;
  let lastError = '';

  const session: Session = connectSession(SERVER_URL, codeInput.value, nameInput.value || '익명', {
    onParticipants(next, id) {
      participants = next;
      selfId = id;
      renderRoster();
    },
    onWakeRequest(fromName) {
      playAlarm();
      lastError = `${fromName}님이 깨웠습니다`;
    },
    onError(code) {
      lastError = code;
    },
    onConnectionChange(next) {
      connected = next;
    },
  });

  function renderRoster(): void {
    roster.replaceChildren();
    for (const participant of participants) {
      const row = document.createElement('div');
      const label = {
        present: '재중',
        drowsy: '졸고 있음',
        unmeasurable: '측정 불가',
      }[participant.status];
      row.textContent = `${participant.name} — ${label}${participant.disconnected ? ' (연결 끊김)' : ''} `;
      if (participant.wakeable && participant.id !== selfId) {
        const button = document.createElement('button');
        button.textContent = '깨우기';
        button.addEventListener('click', () => session.wake(participant.id));
        row.append(button);
      }
      roster.append(row);
    }
  }

  // --- 측정 루프 ---
  let calibration: Calibration = built.calibration;
  let alertState: AlertState = INITIAL_ALERT_STATE;
  let statusState: SessionStatusState = INITIAL_SESSION_STATUS_STATE;
  let myStatus: Status = 'unmeasurable';
  const samples: FrameSample[] = [];
  const openEarHistory: Array<{ t: number; ear: number }> = [];
  let lastTick = 0;
  let needsRecalibration = false;

  const onFrame = (now: number): void => {
    const ear = readFrame(now);
    const frameState = classifyFrame(ear, calibration);

    samples.push({ t: now, state: frameState });
    while (samples.length > 0 && (samples[0]?.t ?? now) < now - WINDOW_MS) samples.shift();

    if (frameState === 'open' && ear) {
      openEarHistory.push({ t: now, ear: ear.mean });
      while (openEarHistory.length > 0 && (openEarHistory[0]?.t ?? now) < now - DRIFT_WINDOW_MS) {
        openEarHistory.shift();
      }
    }

    if (now - lastTick >= 1000) {
      lastTick = now;
      const analysis = analyzeWindow(samples, now);
      const alert = updateAlert(alertState, {
        perclos: analysis.value,
        longestClosedMs: analysis.longestClosedMs,
        longestClosedEndedAt: analysis.longestClosedEndedAt,
        saturated: analysis.saturated,
        now,
      });
      alertState = alert.state;

      const rollingP75 = percentile(openEarHistory.map((entry) => entry.ear), 0.75);
      if (rollingP75 !== null) {
        const drifted = updateOpenBaseline(calibration, rollingP75);
        // null이면 보정이 못 믿을 범위로 내려갔다. 값을 깎아 맞추지 않고 재보정을 요구한다.
        if (drifted === null) needsRecalibration = true;
        else calibration = drifted;
      }

      const next = updateSessionStatus(statusState, {
        event: alert.event,
        analysis: needsRecalibration
          ? null
          : { value: analysis.value, observedMs: analysis.observedMs, windowSpanMs: analysis.windowSpanMs },
        now,
      });
      statusState = next.state;
      myStatus = next.status;
      session.setStatus(myStatus);

      render([
        `내 상태: ${myStatus}${needsRecalibration ? ' (재보정 필요)' : ''}`,
        `서버: ${connected ? '연결됨' : '끊김'}`,
        `PERCLOS: ${analysis.value === null ? '–' : `${(analysis.value * 100).toFixed(1)}%`}`,
        `유효 프레임: ${(analysis.validRatio * 100).toFixed(0)}%`,
        `관측 커버리지: ${analysis.windowSpanMs === 0 ? '–' : `${((analysis.observedMs / analysis.windowSpanMs) * 100).toFixed(0)}%`}`,
        lastError ? `알림: ${lastError}` : '',
      ]);
      renderRoster();
    }

    video.requestVideoFrameCallback(() => onFrame(performance.now()));
  };

  video.requestVideoFrameCallback(() => onFrame(performance.now()));
}

startButton.addEventListener('click', () => {
  void main();
});
```

- [ ] **Step 3: `.claude/launch.json`을 만든다**

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "perclos",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 4: `README.md`를 작성한다**

~~~markdown
# PERCLOS

웹캠으로 PERCLOS(눈꺼풀이 동공을 80% 이상 덮은 시간의 비율)를 계산해 졸음을 감지하고,
같은 방의 다른 참가자가 조는 사람을 깨울 수 있게 하는 도구.

## 설치

```bash
npm install
npm run assets
curl -L -o public/models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

## 실행

터미널 두 개가 필요하다.

```bash
npm run server
```

```bash
npm run dev
```

이름과 방 코드(영숫자 6자)를 넣고 시작을 누른다. 같은 방 코드를 쓰면 같은 방에 모인다.
약 20초 보정을 거친 뒤 서로의 상태가 보이고, 조는 사람 옆에 깨우기 버튼이 생긴다.

## 검증

```bash
npm run check
```

## 무엇이 오가는가

방을 넘는 것은 이름과 세 가지 상태(`present` / `drowsy` / `unmeasurable`)뿐이다.
영상도, EAR도, PERCLOS 수치도 서버로 보내지 않는다. 방은 서버 메모리에만 있고
마지막 참가자가 나가면 사라진다.

## 한계

- 졸음 판정은 측정 코어의 정확도를 그대로 물려받는다 (운전 연구 기준 임계값, 안경 반사, 저조도)
- 자리 비움과 고개 떨굼의 구분은 직전 상태에 기댄 추정이지 관측이 아니다
- 재보정이 필요해지면 이 최소 하네스에는 복구 경로가 없다. 새로고침 후 다시 시작해야 한다
- **의료기기가 아니다.** 수면장애 진단이나 운전 적합성 판정에 쓸 수 없다
~~~

- [ ] **Step 5: 브라우저에서 검증한다**

`npm run server`를 띄운 뒤 preview_start로 `perclos`를 열고, **탭 두 개**로 같은 방 코드에 들어가 확인한다:

1. 카메라 권한 요청 → 보정 안내가 카운트다운과 함께 바뀐다
2. 보정 후 두 탭이 서로를 참가자 목록에서 본다
3. 한쪽에서 눈을 1초 이상 감으면 그 사람의 상태가 `졸고 있음`으로 바뀌고, 다른 탭에 깨우기 버튼이 생긴다
4. 깨우기를 누르면 조는 쪽 탭에서 소리가 난다
5. 멀쩡한 사람 옆에는 깨우기 버튼이 없다
6. 한 탭을 닫으면 다른 탭의 목록에서 사라진다
7. 콘솔에 에러가 없다

문제가 있으면 `superpowers:systematic-debugging`으로 진단한다.

- [ ] **Step 6: 커밋**

```bash
git add src/session.ts src/app.ts .claude/launch.json README.md && git commit -m "feat: 측정 코어와 세션을 이어 루프를 완성

화면은 설계하지 않았다. 깨우기 루프가 실제로 도는지 확인할 최소한만 만든다.
보정이 못 믿을 범위로 내려가면 값을 깎지 않고 재보정을 요구하며,
그동안은 unmeasurable로 보고한다."
```

---

## 완료 후

다음은 서브프로젝트 2(계정과 지속 데이터)이거나 화면 설계다. 어느 쪽이든 별도 스펙에서 시작한다.
