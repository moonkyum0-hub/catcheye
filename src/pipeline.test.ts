import { describe, expect, it } from 'vitest';
import type { AlertEvent } from './alertPolicy';
import { INITIAL_ALERT_STATE, MICROSLEEP_RECENCY_MS, updateAlert } from './alertPolicy';
import type { Calibration } from './calibration';
import { buildCalibration } from './calibration';
import { classifyFrame } from './frameState';
import { analyzeWindow } from './perclos';
import type { FrameSample } from './types';

// 순수 계산 층만 이어 붙인다. 카메라도 MediaPipe도 없다.
// buildCalibration -> classifyFrame -> analyzeWindow -> updateAlert.

const FPS = 30;
const FRAME_MS = 1000 / FPS;
const TICK_MS = 1000;

const OPEN_EAR = 0.3;
const CLOSED_EAR = 0.1;

/** 열린 눈 0.30 / 감은 눈 0.10 -> closedThreshold 0.14, asymmetryLimit 0.06 */
function baseCalibration(): Calibration {
  const result = buildCalibration([0.3, 0.3, 0.3, 0.3], [0.1, 0.1, 0.1]);
  if (!result.ok) throw new Error('보정이 성립해야 한다');
  return result.calibration;
}

/** EAR 시계열(null이면 얼굴 미검출)을 30fps 프레임 판정으로 바꾼다. */
function toSamples(ears: readonly (number | null)[], calibration: Calibration): FrameSample[] {
  return ears.map((value, index) => ({
    t: index * FRAME_MS,
    // classifyFrame은 EarResult를 받는다. 좌우 비대칭이 없는 이상적인 값으로 감싼다.
    state: classifyFrame(
      value === null ? null : { left: value, right: value, mean: value, asymmetry: 0 },
      calibration,
    ),
  }));
}

/** 1초마다 analyzeWindow + updateAlert을 돌려 발생한 이벤트를 모은다. */
function runPipeline(
  ears: readonly (number | null)[],
  calibration: Calibration,
): { events: AlertEvent[]; samples: FrameSample[] } {
  const samples = toSamples(ears, calibration);
  const events: AlertEvent[] = [];
  let state = INITIAL_ALERT_STATE;
  const lastT = (ears.length - 1) * FRAME_MS;

  for (let now = TICK_MS; now <= lastT; now += TICK_MS) {
    const perclos = analyzeWindow(samples, now);
    const next = updateAlert(state, {
      perclos: perclos.value,
      longestClosedMs: perclos.longestClosedMs,
      longestClosedEndedAt: perclos.longestClosedEndedAt,
      saturated: perclos.saturated,
      now,
    });
    state = next.state;
    if (next.event) events.push(next.event);
  }

  return { events, samples };
}

/** 4초마다 5프레임(약 150ms) 깜빡이는 깨어 있는 사람. 깜빡임은 각 주기의 1초 지점. */
function awakeEars(seconds: number, blinkEverySec = 4, blinkFrames = 5): number[] {
  const period = blinkEverySec * FPS;
  const ears: number[] = [];
  for (let i = 0; i < seconds * FPS; i += 1) {
    const phase = i % period;
    ears.push(phase >= FPS && phase < FPS + blinkFrames ? CLOSED_EAR : OPEN_EAR);
  }
  return ears;
}

describe('파이프라인 조합', () => {
  it('깨어 있고 정상적으로 깜빡이면 아무 경고도 나오지 않는다', () => {
    // 4초마다 150ms면 PERCLOS는 5/120 ≈ 4.2%. 경고선 15%는 물론 재무장선 8%보다도 낮다.
    const calibration = baseCalibration();
    const { events, samples } = runPipeline(awakeEars(300), calibration);

    expect(events).toEqual([]);

    const mid = analyzeWindow(samples, 150_000);
    expect(mid.value).toBeCloseTo(5 / 120, 2);
    expect(mid.saturated).toBe(false);
    // 깜빡임 하나의 길이는 4 * (1000/30) ≈ 133ms. 미세수면 경계 500ms에 한참 못 미친다.
    expect(mid.longestClosedMs).toBeLessThan(500);
  });

  it('600ms 미세수면 한 번이면 그 직후에 microsleep 경고가 정확히 한 번 나온다', () => {
    // 19프레임 연속 감김 = 18 * (1000/30) = 600ms. 시작 프레임 3000 -> t=100000, 끝 t=100600.
    const calibration = baseCalibration();
    const ears = awakeEars(300);
    const START_INDEX = 3000;
    const MICROSLEEP_FRAMES = 19;
    for (let i = 0; i < MICROSLEEP_FRAMES; i += 1) ears[START_INDEX + i] = CLOSED_EAR;
    const microsleepEndedAt = (START_INDEX + MICROSLEEP_FRAMES - 1) * FRAME_MS;
    expect(microsleepEndedAt).toBeCloseTo(100_600, 6);

    const { events, samples } = runPipeline(ears, calibration);

    expect(events).toHaveLength(1);
    const event = events[0];
    if (event === undefined || event.type !== 'microsleep') {
      throw new Error(`microsleep 이벤트가 나와야 한다: ${JSON.stringify(events)}`);
    }
    expect(event.closedMs).toBeCloseTo(600, 6);
    // CM-3의 핵심: 경고 시각이 실제 종료 시각 직후여야 한다. 이 창 안에 있었다는 것만으로
    // 50초 전에 끝난 일로 사람을 놀라게 하면 안 된다.
    expect(event.at).toBeGreaterThanOrEqual(microsleepEndedAt);
    expect(event.at - microsleepEndedAt).toBeLessThanOrEqual(MICROSLEEP_RECENCY_MS);

    // 같은 구간이 30초 뒤에도 여전히 60초 창 안에 남아 있다(데이터는 그대로다).
    // 그런데도 새로 무장된 정책은 아무것도 내지 않아야 한다 — 지금 일어난 일이 아니므로.
    const stale = analyzeWindow(samples, 131_000);
    expect(stale.longestClosedMs).toBeCloseTo(600, 6);
    expect(stale.longestClosedEndedAt).toBeCloseTo(microsleepEndedAt, 6);
    const staleAlert = updateAlert(INITIAL_ALERT_STATE, {
      perclos: stale.value,
      longestClosedMs: stale.longestClosedMs,
      longestClosedEndedAt: stale.longestClosedEndedAt,
      saturated: stale.saturated,
      now: 131_000,
    });
    expect(staleAlert.event).toBeNull();
  });

  it('조명이 어두워져 EAR이 임계값 아래로 붕괴하면 포화를 알린다', () => {
    // 60초 이후 EAR이 0.11로 주저앉는다. 눈은 뜨고 있지만 closedThreshold 0.14 아래라
    // 모든 프레임이 closed로 찍힌다. 이때 코어가 할 정직한 말은 "PERCLOS가 높다"가 아니라
    // "값이 포화됐다 — 자는 중이거나 보정이 깨졌다"이다.
    const calibration = baseCalibration();
    const ears = awakeEars(180);
    for (let i = 60 * FPS; i < ears.length; i += 1) ears[i] = 0.11;

    const { events, samples } = runPipeline(ears, calibration);

    const late = analyzeWindow(samples, 150_000);
    expect(late.value).toBeCloseTo(1, 10);
    expect(late.saturated).toBe(true);

    expect(events.some((event) => event.type === 'saturated')).toBe(true);
    // 붕괴 이후로는 perclos 경고가 되풀이되는 것이 아니라 포화로 수렴해야 한다.
    expect(events.at(-1)?.type).toBe('saturated');
    expect(events.some((event) => event.type === 'perclos')).toBe(false);
  });

  it('자리를 비워 얼굴이 계속 잡히지 않으면 값도 경고도 내지 않는다', () => {
    // 자리 비움을 졸음으로 세는 것이 이 부류 프로그램의 가장 흔한 오판이다.
    // 유효 프레임이 하나도 없으므로 그럴듯한 숫자 대신 null이 나와야 한다.
    const calibration = baseCalibration();
    const ears: null[] = new Array<null>(120 * FPS).fill(null);

    const { events, samples } = runPipeline(ears, calibration);

    expect(events).toEqual([]);
    const result = analyzeWindow(samples, 100_000);
    expect(result.value).toBeNull();
    expect(result.validRatio).toBe(0);
    expect(result.saturated).toBe(false);
  });
});
