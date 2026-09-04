import type { ClientMessage } from './protocol.ts';

/** 표시 이름 상한. 넘으면 자른다. */
export const MAX_NAME_LENGTH = 40;
/** 방 코드는 6자다. 그보다 긴 입력은 볼 것도 없이 버린다. */
export const MAX_ROOM_CODE_LENGTH = 6;
/** 연결 id는 `c` + 숫자다. 넉넉히 잡아도 이 정도면 충분하다. */
export const MAX_TARGET_ID_LENGTH = 64;

/**
 * 소켓으로 들어온 원문을 `ClientMessage`로 바꾼다. 형태가 어긋나면 `null`.
 *
 * 클라이언트를 믿지 않는다. 길이 상한을 파싱 단계에서 걸어, 뒤쪽 로직이
 * 임의 길이 문자열을 다루지 않게 한다.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
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
      if (roomCode.length > MAX_ROOM_CODE_LENGTH) return null;
      const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
      // 이름이 비면 명단에서 누가 누군지 알 수 없다.
      if (trimmed.length === 0) return null;
      return { type: 'join', roomCode, name: trimmed };
    }
    case 'state': {
      const { status } = parsed as { status?: unknown };
      if (status !== 'present' && status !== 'drowsy' && status !== 'unmeasurable') return null;
      return { type: 'state', status };
    }
    case 'wake': {
      const { targetId } = parsed as { targetId?: unknown };
      if (typeof targetId !== 'string') return null;
      if (targetId.length === 0 || targetId.length > MAX_TARGET_ID_LENGTH) return null;
      return { type: 'wake', targetId };
    }
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}
