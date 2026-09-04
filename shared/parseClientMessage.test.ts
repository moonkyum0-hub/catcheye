import { describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  MAX_ROOM_CODE_LENGTH,
  MAX_TARGET_ID_LENGTH,
  parseClientMessage,
} from './parseClientMessage';

const json = (value: unknown): string => JSON.stringify(value);

describe('parseClientMessage', () => {
  it('네 종류 메시지를 통과시킨다', () => {
    expect(parseClientMessage(json({ type: 'join', roomCode: 'ABC123', name: '문겸' }))).toEqual({
      type: 'join',
      roomCode: 'ABC123',
      name: '문겸',
    });
    expect(parseClientMessage(json({ type: 'state', status: 'drowsy' }))).toEqual({
      type: 'state',
      status: 'drowsy',
    });
    expect(parseClientMessage(json({ type: 'wake', targetId: 'c2' }))).toEqual({
      type: 'wake',
      targetId: 'c2',
    });
    expect(parseClientMessage(json({ type: 'leave' }))).toEqual({ type: 'leave' });
  });

  it('JSON이 아니면 버린다', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('객체가 아니거나 type이 없으면 버린다', () => {
    expect(parseClientMessage(json(42))).toBeNull();
    expect(parseClientMessage(json(null))).toBeNull();
    expect(parseClientMessage(json(['join']))).toBeNull();
    expect(parseClientMessage(json({ roomCode: 'ABC123' }))).toBeNull();
  });

  it('모르는 type은 버린다', () => {
    expect(parseClientMessage(json({ type: 'kick', targetId: 'c2' }))).toBeNull();
  });

  it('필드 타입이 다르면 버린다', () => {
    expect(parseClientMessage(json({ type: 'join', roomCode: 123, name: '문겸' }))).toBeNull();
    expect(parseClientMessage(json({ type: 'join', roomCode: 'ABC123', name: 5 }))).toBeNull();
    expect(parseClientMessage(json({ type: 'state', status: 'sleepy' }))).toBeNull();
    expect(parseClientMessage(json({ type: 'wake', targetId: { id: 'c2' } }))).toBeNull();
  });

  it('이름은 상한에서 자르고 앞뒤 공백을 없앤다', () => {
    const long = 'ㄱ'.repeat(MAX_NAME_LENGTH + 20);
    const parsed = parseClientMessage(json({ type: 'join', roomCode: 'ABC123', name: long }));
    expect(parsed).not.toBeNull();
    if (parsed?.type !== 'join') throw new Error('join이어야 한다');
    expect(parsed.name).toHaveLength(MAX_NAME_LENGTH);

    const padded = parseClientMessage(json({ type: 'join', roomCode: 'ABC123', name: '  문겸  ' }));
    if (padded?.type !== 'join') throw new Error('join이어야 한다');
    expect(padded.name).toBe('문겸');
  });

  it('빈 이름은 버린다', () => {
    // 명단에서 누가 누군지 알 수 없게 된다.
    expect(parseClientMessage(json({ type: 'join', roomCode: 'ABC123', name: '   ' }))).toBeNull();
  });

  it('상한을 넘는 방 코드와 대상 id는 버린다', () => {
    // 상한을 파싱 단계에서 걸어야 뒤쪽 로직이 임의 길이 문자열을 다루지 않는다.
    const longCode = 'A'.repeat(MAX_ROOM_CODE_LENGTH + 1);
    expect(parseClientMessage(json({ type: 'join', roomCode: longCode, name: '문겸' }))).toBeNull();

    const longTarget = 'c'.repeat(MAX_TARGET_ID_LENGTH + 1);
    expect(parseClientMessage(json({ type: 'wake', targetId: longTarget }))).toBeNull();
    expect(parseClientMessage(json({ type: 'wake', targetId: '' }))).toBeNull();
  });
});
