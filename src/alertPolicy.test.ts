import { describe, expect, it } from 'vitest';
import { INITIAL_ALERT_STATE, updateAlert } from './alertPolicy';

describe('updateAlert', () => {
  it('PERCLOS가 15% 이상이면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'perclos', perclos: 0.2, at: 1000 });
    expect(result.state.armed).toBe(false);
    expect(result.state.lastAlertAt).toBe(1000);
  });

  it('정확히 15%면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.15,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 1000,
    });
    expect(result.event?.type).toBe('perclos');
  });

  it('15% 미만이면 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.14,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('미세수면은 PERCLOS와 무관하게 즉시 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 501,
      longestClosedEndedAt: 999,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'microsleep', closedMs: 501, at: 1000 });
  });

  it('미세수면 경계 아래(499ms)는 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 499,
      longestClosedEndedAt: 999,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('미세수면이 PERCLOS보다 우선한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.3,
      longestClosedMs: 600,
      longestClosedEndedAt: 999,
      saturated: false,
      now: 1000,
    });
    expect(result.event?.type).toBe('microsleep');
  });

  it('PERCLOS가 null이면 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: null,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toBeNull();
    expect(result.state.armed).toBe(true);
  });

  it('경고 후 60초 안에는 다시 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 0.3,
      longestClosedMs: 700,
      longestClosedEndedAt: 29_999,
      saturated: false,
      now: 30_000,
    });
    expect(second.event).toBeNull();
  });

  it('쿨다운이 끝나도 재무장 전에는 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 70_000,
    });
    expect(second.event).toBeNull();
    expect(second.state.armed).toBe(false);
  });

  it('PERCLOS가 8% 아래로 내려가면 재무장하고 다시 경고할 수 있다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const rearmed = updateAlert(first.state, {
      perclos: 0.05,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 70_000,
    });
    expect(rearmed.state.armed).toBe(true);
    expect(rearmed.event).toBeNull();

    const third = updateAlert(rearmed.state, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 80_000,
    });
    expect(third.event?.type).toBe('perclos');
  });

  it('쿨다운 중에는 재무장하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const during = updateAlert(first.state, {
      perclos: 0.01,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 30_000,
    });
    expect(during.state.armed).toBe(false);
  });

  it('무장 해제 상태여도 미세수면이면 경고한다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    expect(first.state.armed).toBe(false);

    const second = updateAlert(first.state, {
      perclos: 0.95,
      longestClosedMs: 5000,
      longestClosedEndedAt: 69_999,
      saturated: false,
      now: 70_000,
    });
    expect(second.event?.type).toBe('microsleep');
  });

  it('쿨다운 중에는 미세수면도 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    expect(first.state.armed).toBe(false);

    const second = updateAlert(first.state, {
      perclos: 0.95,
      longestClosedMs: 5000,
      longestClosedEndedAt: 29_999,
      saturated: false,
      now: 30_000,
    });
    expect(second.event).toBeNull();
  });

  it('PERCLOS가 정확히 8%면 재무장하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 0.08,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 70_000,
    });
    expect(second.state.armed).toBe(false);
  });

  it('미세수면이 정확히 500ms면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 500,
      longestClosedEndedAt: 999,
      saturated: false,
      now: 1000,
    });
    expect(result.event?.type).toBe('microsleep');
  });

  it('마지막 경고로부터 정확히 60초가 지나면 쿨다운이 끝난다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 0.05,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 60_000,
    });
    expect(second.state.armed).toBe(true);
  });

  it('오래전에 끝난 감김 구간으로는 경고하지 않는다', () => {
    // 60초 창 안에는 아직 남아 있지만 59초 전에 끝난 구간이다. 지금 일어난 일이 아니다.
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 600,
      longestClosedEndedAt: 1000,
      saturated: false,
      now: 60_000,
    });
    expect(result.event).toBeNull();
  });

  it('종료 시각이 없으면 미세수면 경고를 하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 600,
      longestClosedEndedAt: null,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('포화 상태면 무장 해제 상태여도 경고한다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    expect(first.state.armed).toBe(false);

    const second = updateAlert(first.state, {
      perclos: 1,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: true,
      now: 70_000,
    });
    expect(second.event).toEqual({ type: 'saturated', perclos: 1, at: 70_000 });
    expect(second.state).toEqual({ armed: false, lastAlertAt: 70_000 });
  });

  it('포화가 미세수면과 PERCLOS보다 우선한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 1,
      longestClosedMs: 5000,
      longestClosedEndedAt: 999,
      saturated: true,
      now: 1000,
    });
    expect(result.event?.type).toBe('saturated');
  });

  it('쿨다운 중에는 포화도 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: false,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 1,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: true,
      now: 30_000,
    });
    expect(second.event).toBeNull();
  });

  it('포화인데 perclos가 null이면 포화 경고를 내지 않는다', () => {
    const quiet = updateAlert(INITIAL_ALERT_STATE, {
      perclos: null,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      saturated: true,
      now: 1000,
    });
    expect(quiet.event).toBeNull();

    // 포화를 흘려보낸 뒤에는 아래 규칙들이 그대로 이어져야 한다.
    const fellThrough = updateAlert(INITIAL_ALERT_STATE, {
      perclos: null,
      longestClosedMs: 600,
      longestClosedEndedAt: 999,
      saturated: true,
      now: 1000,
    });
    expect(fellThrough.event?.type).toBe('microsleep');
  });

  it('PERCLOS가 null이어도 최근 미세수면이면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: null,
      longestClosedMs: 700,
      longestClosedEndedAt: 900,
      saturated: false,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'microsleep', closedMs: 700, at: 1000 });
  });

  it('INITIAL_ALERT_STATE는 얼어 있어 참가자끼리 오염되지 않는다', () => {
    expect(Object.isFrozen(INITIAL_ALERT_STATE)).toBe(true);
  });
});
