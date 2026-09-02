import { describe, expect, it } from 'vitest';
import { buildCalibration, percentile, updateOpenBaseline } from './calibration';

const TENTHS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

describe('percentile', () => {
  it('선형 보간으로 P75를 구한다', () => {
    // 인덱스 = (10 - 1) * 0.75 = 6.75 -> 0.7과 0.8 사이 75% 지점
    expect(percentile(TENTHS, 0.75)).toBeCloseTo(0.775, 10);
  });

  it('P50은 중앙값이다', () => {
    expect(percentile(TENTHS, 0.5)).toBeCloseTo(0.55, 10);
  });

  it('정렬되지 않은 입력도 처리한다', () => {
    expect(percentile([1.0, 0.1, 0.5], 0.5)).toBeCloseTo(0.5, 10);
  });

  it('빈 배열은 null이다', () => {
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('buildCalibration', () => {
  it('P80 정의에서 감김 임계값을 유도한다', () => {
    // openSamples의 P75가 0.30, closedSamples의 중앙값이 0.10이 되도록 구성
    const open = [0.3, 0.3, 0.3, 0.3];
    const closed = [0.1, 0.1, 0.1];
    const result = buildCalibration(open, closed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calibration.openEar).toBeCloseTo(0.3, 10);
    expect(result.calibration.closedEar).toBeCloseTo(0.1, 10);
    // 0.10 + 0.2 * (0.30 - 0.10) = 0.14
    expect(result.calibration.closedThreshold).toBeCloseTo(0.14, 10);
    // 0.3 * (0.30 - 0.10) = 0.06
    expect(result.calibration.asymmetryLimit).toBeCloseTo(0.06, 10);
  });

  it('깜빡임이 섞인 열린 눈 샘플에서 P75를 쓴다', () => {
    // 아래로 튀는 깜빡임 값이 있어도 중앙값보다 높은 기준선을 잡는다
    const open = [0.05, 0.28, 0.3, 0.3, 0.3, 0.31, 0.32, 0.32];
    const closed = [0.1];
    const result = buildCalibration(open, closed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.calibration.openEar).toBeGreaterThan(0.3);
  });

  it('열림과 감김 차이가 0.08 미만이면 거부한다', () => {
    const result = buildCalibration([0.15, 0.15, 0.15], [0.1]);
    expect(result).toEqual({ ok: false, reason: 'insufficient-range' });
  });

  it('차이가 정확히 0.08이면 통과시킨다', () => {
    // 0.16 - 0.08은 부동소수점에서도 정확히 0.08이다.
    // 0.18 - 0.10 같은 쌍은 0.07999999999999999가 되어 경계 테스트가 무너진다.
    const result = buildCalibration([0.16, 0.16, 0.16], [0.08]);
    expect(result.ok).toBe(true);
  });

  it('샘플이 비면 거부한다', () => {
    expect(buildCalibration([], [0.1])).toEqual({ ok: false, reason: 'no-samples' });
    expect(buildCalibration([0.3], [])).toEqual({ ok: false, reason: 'no-samples' });
  });
});

describe('updateOpenBaseline', () => {
  it('alpha 0.02로 천천히 이동하고 임계값을 다시 계산한다', () => {
    const base = buildCalibration([0.3, 0.3], [0.1, 0.1]);
    expect(base.ok).toBe(true);
    if (!base.ok) return;

    const updated = updateOpenBaseline(base.calibration, 0.35);
    // 0.30 * 0.98 + 0.35 * 0.02 = 0.301
    expect(updated.openEar).toBeCloseTo(0.301, 10);
    expect(updated.closedEar).toBeCloseTo(0.1, 10);
    // 0.10 + 0.2 * (0.301 - 0.10) = 0.1402
    expect(updated.closedThreshold).toBeCloseTo(0.1402, 10);
  });

  it('원본을 변형하지 않는다', () => {
    const base = buildCalibration([0.3], [0.1]);
    if (!base.ok) throw new Error('보정이 성립해야 한다');
    updateOpenBaseline(base.calibration, 0.35);
    expect(base.calibration.openEar).toBeCloseTo(0.3, 10);
  });
});
