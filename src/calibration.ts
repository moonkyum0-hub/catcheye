const MIN_RANGE = 0.08;
const CLOSURE_FRACTION = 0.2; // P80 정의: 닫힘 80% 지점
const ASYMMETRY_FRACTION = 0.3;
const DRIFT_ALPHA = 0.02;

export interface Calibration {
  openEar: number;
  closedEar: number;
  closedThreshold: number;
  asymmetryLimit: number;
}

export type CalibrationResult =
  | { ok: true; calibration: Calibration }
  | { ok: false; reason: 'no-samples' | 'insufficient-range' };

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function derive(openEar: number, closedEar: number): Calibration {
  const range = openEar - closedEar;
  return {
    openEar,
    closedEar,
    closedThreshold: closedEar + CLOSURE_FRACTION * range,
    asymmetryLimit: ASYMMETRY_FRACTION * range,
  };
}

export function buildCalibration(
  openSamples: readonly number[],
  closedSamples: readonly number[],
): CalibrationResult {
  // 열린 눈 구간에는 깜빡임이 섞여 값이 아래로 튄다. 중앙값이 아니라 P75를 쓴다.
  const openEar = percentile(openSamples, 0.75);
  const closedEar = percentile(closedSamples, 0.5);
  if (openEar === null || closedEar === null) return { ok: false, reason: 'no-samples' };
  if (openEar - closedEar < MIN_RANGE) return { ok: false, reason: 'insufficient-range' };
  return { ok: true, calibration: derive(openEar, closedEar) };
}

export function updateOpenBaseline(calibration: Calibration, rollingP75: number): Calibration {
  // 감은 눈 EAR은 거의 변하지 않으므로 closedEar는 고정하고 openEar만 따라간다.
  const openEar = calibration.openEar * (1 - DRIFT_ALPHA) + rollingP75 * DRIFT_ALPHA;
  return derive(openEar, calibration.closedEar);
}
