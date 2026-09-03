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
