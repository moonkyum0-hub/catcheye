import type { FrameSample } from './types';

export const WINDOW_MS = 60_000;
/**
 * 유효 프레임이 이 비율에 못 미치면 PERCLOS를 계산하지 않는다.
 * UI가 "왜 값이 없는지"를 설명하려면 이 값을 알아야 하므로 내보낸다.
 */
export const MIN_VALID_RATIO = 0.5;
/** 이 이상이면 사실상 계속 감고 있는 것으로 본다. */
export const SATURATION_PERCLOS = 0.95;
/** 창이 이 비율만큼 차야 포화 판정을 신뢰한다. 시작 직후 오판을 막는다. */
const SATURATION_MIN_SPAN = 0.9;
/**
 * 연속된 두 샘플이 이보다 멀면 그 사이는 관측하지 않은 구간이다.
 * 30fps에서 프레임 간격은 33ms이므로 250ms는 프레임 몇 개를 놓친 정도까지만 허용한다.
 * 탭이 숨겨져 캡처 루프가 멈춘 구간을 감김으로 세지 않기 위한 것이다.
 */
export const MAX_SAMPLE_GAP_MS = 250;

export interface PerclosResult {
  value: number | null;
  validRatio: number;
  longestClosedMs: number;
  /** 최장 감김 구간의 마지막 프레임 시각. 감김 구간이 없으면 null. */
  longestClosedEndedAt: number | null;
  /**
   * 창 안 첫 샘플과 마지막 샘플의 시각 차이. **관측 시간이 아니라 양 끝의 거리다** —
   * 중간에 캡처가 멈춘 공백을 모른다. 진단용으로만 쓰고, 포화 판정에는 `observedMs`를 쓴다.
   */
  windowSpanMs: number;
  /** 연속된 샘플 사이 간격 중 MAX_SAMPLE_GAP_MS 이하인 것만 더한 값. 실제로 관측한 시간. */
  observedMs: number;
  /** 창이 거의 다 찼는데 PERCLOS가 포화 수준이면 true. 자는 중이거나 보정이 깨진 상태. */
  saturated: boolean;
  blinkCount: number;
  meanBlinkMs: number | null;
}

/**
 * 최근 windowMs 구간의 PERCLOS와 보조 지표를 낸다.
 *
 * 전제: `samples`는 `t` 오름차순이다. 정렬을 강제하지 않는 것은 비용 때문이다.
 * 전제가 깨져 구간 길이가 음수로 나오면 그 구간은 통계에서 제외한다 —
 * 음수 평균 깜빡임 시간 같은 무의미한 숫자를 내보내지 않기 위해서다.
 */
export function analyzeWindow(
  samples: readonly FrameSample[],
  now: number,
  windowMs: number = WINDOW_MS,
): PerclosResult {
  const cutoff = now - windowMs;
  // 지역 변수 이름으로 `window`를 쓰지 않는다. 이 모듈은 플랫폼 독립이 존재
  // 이유인데 DOM 전역을 가리는 이름은 그 의도를 흐린다.
  const windowSamples = samples.filter((sample) => sample.t >= cutoff && sample.t <= now);

  if (windowSamples.length === 0) {
    return {
      value: null,
      validRatio: 0,
      longestClosedMs: 0,
      longestClosedEndedAt: null,
      windowSpanMs: 0,
      observedMs: 0,
      saturated: false,
      blinkCount: 0,
      meanBlinkMs: null,
    };
  }

  let closed = 0;
  let valid = 0;
  // 감김 구간의 길이는 (마지막 감김 프레임 t - 첫 감김 프레임 t)로 잰다.
  // 마지막 프레임의 노출 시간만큼 과소평가되지만 프레임 간격을 추정하지 않아도 된다.
  let runStart: number | null = null;
  let runEnd = 0;
  let longestClosedMs = 0;
  let longestClosedEndedAt: number | null = null;
  const runs: number[] = [];
  // 샘플이 끊긴 동안은 관측한 시간이 아니다. 여기에 더하지 않는다.
  let observedMs = 0;
  let prevT: number | null = null;

  const closeRun = (): void => {
    if (runStart === null) return;
    const duration = runEnd - runStart;
    runStart = null;
    if (duration < 0) return;
    runs.push(duration);
    // 길이가 같은 구간이 둘이면 먼저 나온 것을 남긴다(비교가 엄격한 > 인 이유).
    if (longestClosedEndedAt === null || duration > longestClosedMs) {
      longestClosedMs = duration;
      longestClosedEndedAt = runEnd;
    }
  };

  for (const sample of windowSamples) {
    const gap = prevT === null ? null : sample.t - prevT;
    // 공백은 관측하지 않은 구간이다. 감김 구간을 끊는 이유는 missing과 같다 —
    // 보지 못한 시간을 감고 있던 시간으로 셀 수는 없다.
    const gapped = gap !== null && gap > MAX_SAMPLE_GAP_MS;
    if (gap !== null && gap > 0 && gap <= MAX_SAMPLE_GAP_MS) observedMs += gap;
    prevT = sample.t;

    if (sample.state === 'closed') {
      closed += 1;
      valid += 1;
      if (gapped) closeRun();
      if (runStart === null) runStart = sample.t;
      runEnd = sample.t;
    } else {
      if (sample.state === 'open') valid += 1;
      closeRun();
    }
  }
  closeRun();

  const first = windowSamples[0];
  const last = windowSamples[windowSamples.length - 1];
  const windowSpanMs = first !== undefined && last !== undefined ? last.t - first.t : 0;

  const validRatio = valid / windowSamples.length;
  const value = validRatio >= MIN_VALID_RATIO && valid > 0 ? closed / valid : null;
  const meanBlinkMs =
    runs.length > 0 ? runs.reduce((sum, ms) => sum + ms, 0) / runs.length : null;
  // span이 아니라 실제로 관측한 시간으로 판정한다. 탭이 숨겨져 캡처가 멈춘 1분을
  // "1분간 눈을 감고 있었다"로 보고하지 않기 위해서다.
  const saturated =
    value !== null && value >= SATURATION_PERCLOS && observedMs >= windowMs * SATURATION_MIN_SPAN;

  return {
    value,
    validRatio,
    longestClosedMs,
    longestClosedEndedAt,
    windowSpanMs,
    observedMs,
    saturated,
    blinkCount: runs.length,
    meanBlinkMs,
  };
}
