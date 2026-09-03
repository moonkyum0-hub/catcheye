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
    // 쿨다운(30초)이 연결 끊김 판정(15초)보다 길다. 실제 클라이언트처럼 하트비트를 보내
    // 대상이 살아 있게 유지해야 쿨다운 자체를 검증할 수 있다.
    const alive = setStatus(first.state, 'c2', 'drowsy', 2000 + WAKE_COOLDOWN_MS - 1);
    const second = handleMessage(alive.state, 'c1', { type: 'wake', targetId: 'c2' }, 2000 + WAKE_COOLDOWN_MS - 1);
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
    const alive = setStatus(first.state, 'c2', 'drowsy', 2000 + WAKE_COOLDOWN_MS);
    const second = handleMessage(alive.state, 'c1', { type: 'wake', targetId: 'c2' }, 2000 + WAKE_COOLDOWN_MS);
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
