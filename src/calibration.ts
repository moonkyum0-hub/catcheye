/** 열림/감김 EAR 차이가 이보다 좁으면 그 보정은 믿을 수 없다. */
export const MIN_RANGE = 0.08;
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

/**
 * 열린 눈 기준선을 롤링 P75 쪽으로 천천히 옮긴다.
 * 드리프트 결과가 보정 거부선 아래로 내려가면 null을 반환한다 — 호출자는
 * 재보정을 요청해야 한다. 값을 깎아 맞추지 않는다. 그건 못 믿을 숫자를
 * 그럴듯하게 꾸미는 것이고, 이 프로젝트가 하지 않기로 한 일이다.
 *
 * 전제: rollingP75는 현재 보정으로 open이라 판정된 프레임에서만 모은 값이다.
 * 그 전제를 어기면(예: 감김 프레임이 섞인 P75) 기준선이 무너질 수 있다.
 */
export function updateOpenBaseline(
  calibration: Calibration,
  rollingP75: number,
): Calibration | null {
  // 감은 눈 EAR은 거의 변하지 않으므로 closedEar는 고정하고 openEar만 따라간다.
  const openEar = calibration.openEar * (1 - DRIFT_ALPHA) + rollingP75 * DRIFT_ALPHA;
  if (openEar - calibration.closedEar < MIN_RANGE) return null;
  return derive(openEar, calibration.closedEar);
}
