export const PERCLOS_ALERT = 0.15;
export const PERCLOS_REARM = 0.08;
export const MICROSLEEP_MS = 500;
/**
 * 한 번 경고한 뒤 이 시간 동안은 어떤 경고도 내지 않는다.
 *
 * 값이 `perclos.ts`의 `WINDOW_MS`와 같지만 **의미상 독립**이다. 창 길이가 바뀌어도
 * 이 값은 따라갈 이유가 없다. 미세수면이 같은 창 안에서 반복 발화하는 것을 막는 일도
 * 이제 쿨다운이 아니라 `MICROSLEEP_RECENCY_MS`가 맡는다 — 쿨다운은 사용자를
 * 연달아 놀라게 하지 않기 위한 것이지, 오래된 구간을 걸러내는 장치가 아니다.
 */
export const COOLDOWN_MS = 60_000;
/** 이보다 오래전에 끝난 감김 구간은 지금 일어난 일이 아니다. */
export const MICROSLEEP_RECENCY_MS = 2_000;

export interface AlertState {
  armed: boolean;
  lastAlertAt: number | null;
}

/**
 * 판별 유니온. 필드 이름이 단위를 말한다 — `perclos`는 비율(0~1), `closedMs`는 밀리초.
 * 그룹 모드에서 이 이벤트는 직렬화돼 다른 기계의 다른 코드가 렌더링한다.
 * 한 필드에 두 단위가 섞여 있으면 그쪽에서 "501%"가 찍힌다.
 */
export type AlertEvent =
  | { type: 'perclos'; perclos: number; at: number }
  | { type: 'microsleep'; closedMs: number; at: number }
  | { type: 'saturated'; perclos: number; at: number };

export interface AlertInput {
  perclos: number | null;
  longestClosedMs: number;
  longestClosedEndedAt: number | null;
  saturated: boolean;
  now: number;
}

// 그룹 모드에서 참가자마다 이 객체를 나눠 갖는다. 한 번의 실수로 전부 오염되지 않게 얼린다.
export const INITIAL_ALERT_STATE: AlertState = Object.freeze({ armed: true, lastAlertAt: null });

export function updateAlert(
  state: AlertState,
  input: AlertInput,
): { state: AlertState; event: AlertEvent | null } {
  const { perclos, longestClosedMs, longestClosedEndedAt, saturated, now } = input;
  const inCooldown = state.lastAlertAt !== null && now - state.lastAlertAt < COOLDOWN_MS;

  if (inCooldown) return { state, event: null };

  // 포화는 "자고 있다"와 "보정이 깨졌다"를 EAR만으로 구분할 수 없다는 사실 자체를
  // 알린다. 통합 계층이 재보정을 요청하고, 응답이 없으면 그때 진짜 수면으로 본다.
  // 코어는 구분하려 들지 않고 정직하게 전달만 한다. 그래서 무장 상태와 무관하고
  // 미세수면·PERCLOS보다 앞선다.
  if (saturated && perclos !== null) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'saturated', perclos, at: now },
    };
  }

  // 미세수면은 재무장 게이트를 우회한다. 실제로 잠들면 PERCLOS가 재무장 값 아래로
  // 내려오지 않아 영원히 재무장되지 않고, 정작 깨워야 할 사람에게 침묵하게 된다.
  // 다만 60초 창 어딘가에 있던 구간이 아니라 **방금 끝난** 구간이어야 한다.
  if (
    longestClosedMs >= MICROSLEEP_MS &&
    longestClosedEndedAt !== null &&
    now - longestClosedEndedAt <= MICROSLEEP_RECENCY_MS
  ) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'microsleep', closedMs: longestClosedMs, at: now },
    };
  }

  if (!state.armed) {
    // 임계 근처에서 경고가 연타되는 것을 막는다. 충분히 내려와야 다시 무장한다.
    if (perclos !== null && perclos < PERCLOS_REARM) {
      return { state: { ...state, armed: true }, event: null };
    }
    return { state, event: null };
  }

  if (perclos !== null && perclos >= PERCLOS_ALERT) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'perclos', perclos, at: now },
    };
  }

  return { state, event: null };
}
