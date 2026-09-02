import type { FrameSample } from './types';

export const WINDOW_MS = 60_000;
const MIN_VALID_RATIO = 0.5;

export interface PerclosResult {
  value: number | null;
  validRatio: number;
  longestClosedMs: number;
  blinkCount: number;
  meanBlinkMs: number | null;
}

export function analyzeWindow(
  samples: readonly FrameSample[],
  now: number,
  windowMs: number = WINDOW_MS,
): PerclosResult {
  const cutoff = now - windowMs;
  const window = samples.filter((sample) => sample.t >= cutoff && sample.t <= now);

  if (window.length === 0) {
    return { value: null, validRatio: 0, longestClosedMs: 0, blinkCount: 0, meanBlinkMs: null };
  }

  let closed = 0;
  let valid = 0;
  // 감김 구간의 길이는 (마지막 감김 프레임 t - 첫 감김 프레임 t)로 잰다.
  // 마지막 프레임의 노출 시간만큼 과소평가되지만 프레임 간격을 추정하지 않아도 된다.
  let runStart: number | null = null;
  let runEnd = 0;
  let longestClosedMs = 0;
  const runs: number[] = [];

  const closeRun = (): void => {
    if (runStart === null) return;
    const duration = runEnd - runStart;
    runs.push(duration);
    longestClosedMs = Math.max(longestClosedMs, duration);
    runStart = null;
  };

  for (const sample of window) {
    if (sample.state === 'closed') {
      closed += 1;
      valid += 1;
      if (runStart === null) runStart = sample.t;
      runEnd = sample.t;
    } else {
      if (sample.state === 'open') valid += 1;
      closeRun();
    }
  }
  closeRun();

  const validRatio = valid / window.length;
  const value = validRatio >= MIN_VALID_RATIO && valid > 0 ? closed / valid : null;
  const meanBlinkMs =
    runs.length > 0 ? runs.reduce((sum, ms) => sum + ms, 0) / runs.length : null;

  return { value, validRatio, longestClosedMs, blinkCount: runs.length, meanBlinkMs };
}
