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

  // 측정을 믿을 수 없으면 회복 판정도 할 수 없다. 커버리지가 낮을 때의
  // value는 정상처럼 보이지만 근거가 없으므로 재무장에 쓰면 안 된다.
  if (!isMeasurable(analysis)) {
    return { state, status: 'unmeasurable' };
  }

  // 코어가 재무장할 만큼 회복했으면 붙잡아 둘 이유가 없다.
  if (analysis !== null && analysis.value !== null && analysis.value < PERCLOS_REARM) {
    return { state: { lastAlertAt: null }, status: 'present' };
  }

  if (state.lastAlertAt !== null && now - state.lastAlertAt < DROWSY_HOLD_MS) {
    return { state, status: 'drowsy' };
  }

  return { state: { lastAlertAt: null }, status: 'present' };
}
