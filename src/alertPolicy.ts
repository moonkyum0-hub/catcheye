export const PERCLOS_ALERT = 0.15;
export const PERCLOS_REARM = 0.08;
export const MICROSLEEP_MS = 500;
export const COOLDOWN_MS = 60_000;

export interface AlertState {
  armed: boolean;
  lastAlertAt: number | null;
}

export interface AlertEvent {
  type: 'perclos' | 'microsleep';
  value: number;
  at: number;
}

export interface AlertInput {
  perclos: number | null;
  longestClosedMs: number;
  now: number;
}

export const INITIAL_ALERT_STATE: AlertState = { armed: true, lastAlertAt: null };

export function updateAlert(
  state: AlertState,
  input: AlertInput,
): { state: AlertState; event: AlertEvent | null } {
  const { perclos, longestClosedMs, now } = input;
  const inCooldown = state.lastAlertAt !== null && now - state.lastAlertAt < COOLDOWN_MS;

  if (inCooldown) return { state, event: null };

  if (!state.armed) {
    // 임계 근처에서 경고가 연타되는 것을 막는다. 충분히 내려와야 다시 무장한다.
    if (perclos !== null && perclos < PERCLOS_REARM) {
      return { state: { ...state, armed: true }, event: null };
    }
    return { state, event: null };
  }

  if (longestClosedMs >= MICROSLEEP_MS) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'microsleep', value: longestClosedMs, at: now },
    };
  }

  if (perclos !== null && perclos >= PERCLOS_ALERT) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'perclos', value: perclos, at: now },
    };
  }

  return { state, event: null };
}
