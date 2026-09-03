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
      const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
        event,
        analysis: HEALTHY,
        now: 1000,
      });
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
    const recovered = updateSessionStatus(alerted.state, {
      event: null,
      analysis: HEALTHY,
      now: 2000,
    });
    expect(recovered.status).toBe('present');
    expect(recovered.state.lastAlertAt).toBeNull();
  });

  it('분석 결과가 없으면 unmeasurable이다', () => {
    // 카메라 실패, 보정 미완료, 재보정 필요가 전부 여기로 온다.
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: null,
      analysis: null,
      now: 1000,
    });
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
    const result = updateSessionStatus(INITIAL_SESSION_STATUS_STATE, {
      event: null,
      analysis: HEALTHY,
      now: 1000,
    });
    expect(result.status).toBe('present');
  });
});
