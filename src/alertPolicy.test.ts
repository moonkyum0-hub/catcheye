import { describe, expect, it } from 'vitest';
import { INITIAL_ALERT_STATE, updateAlert } from './alertPolicy';

describe('updateAlert', () => {
  it('PERCLOS가 15% 이상이면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'perclos', value: 0.2, at: 1000 });
    expect(result.state.armed).toBe(false);
    expect(result.state.lastAlertAt).toBe(1000);
  });

  it('정확히 15%면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.15,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event?.type).toBe('perclos');
  });

  it('15% 미만이면 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.14,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('미세수면은 PERCLOS와 무관하게 즉시 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 501,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'microsleep', value: 501, at: 1000 });
  });

  it('미세수면 경계 아래(499ms)는 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 499,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('미세수면이 PERCLOS보다 우선한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.3,
      longestClosedMs: 600,
      now: 1000,
    });
    expect(result.event?.type).toBe('microsleep');
  });

  it('PERCLOS가 null이면 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: null,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event).toBeNull();
    expect(result.state.armed).toBe(true);
  });

  it('경고 후 60초 안에는 다시 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 0.3,
      longestClosedMs: 700,
      now: 30_000,
    });
    expect(second.event).toBeNull();
  });

  it('쿨다운이 끝나도 재무장 전에는 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, { perclos: 0.2, longestClosedMs: 0, now: 0 });
    const second = updateAlert(first.state, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 70_000,
    });
    expect(second.event).toBeNull();
    expect(second.state.armed).toBe(false);
  });

  it('PERCLOS가 8% 아래로 내려가면 재무장하고 다시 경고할 수 있다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, { perclos: 0.2, longestClosedMs: 0, now: 0 });
    const rearmed = updateAlert(first.state, {
      perclos: 0.05,
      longestClosedMs: 0,
      now: 70_000,
    });
    expect(rearmed.state.armed).toBe(true);
    expect(rearmed.event).toBeNull();

    const third = updateAlert(rearmed.state, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 80_000,
    });
    expect(third.event?.type).toBe('perclos');
  });

  it('쿨다운 중에는 재무장하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, { perclos: 0.2, longestClosedMs: 0, now: 0 });
    const during = updateAlert(first.state, {
      perclos: 0.01,
      longestClosedMs: 0,
      now: 30_000,
    });
    expect(during.state.armed).toBe(false);
  });
});
