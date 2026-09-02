import { describe, expect, it } from 'vitest';
import { classifyFrame } from './frameState';
import type { Calibration } from './calibration';
import type { EarResult } from './ear';

// openEar 0.30, closedEar 0.10 -> closedThreshold 0.14, asymmetryLimit 0.06
const CALIBRATION: Calibration = {
  openEar: 0.3,
  closedEar: 0.1,
  closedThreshold: 0.14,
  asymmetryLimit: 0.06,
};

function ear(mean: number, asymmetry = 0): EarResult {
  return { left: mean, right: mean, mean, asymmetry };
}

describe('classifyFrame', () => {
  it('얼굴이 없으면 missing이다', () => {
    expect(classifyFrame(null, CALIBRATION)).toBe('missing');
  });

  it('임계값보다 크면 open이다', () => {
    expect(classifyFrame(ear(0.28), CALIBRATION)).toBe('open');
  });

  it('임계값보다 작으면 closed다', () => {
    expect(classifyFrame(ear(0.12), CALIBRATION)).toBe('closed');
  });

  it('임계값과 같으면 closed다', () => {
    expect(classifyFrame(ear(0.14), CALIBRATION)).toBe('closed');
  });

  it('좌우 비대칭이 한계를 넘으면 missing이다', () => {
    // 한쪽 눈만 가려진 측면 각도. 감김으로 세면 안 된다.
    expect(classifyFrame(ear(0.12, 0.07), CALIBRATION)).toBe('missing');
    expect(classifyFrame(ear(0.28, 0.07), CALIBRATION)).toBe('missing');
  });

  it('비대칭이 한계와 같으면 유효하다', () => {
    expect(classifyFrame(ear(0.28, 0.06), CALIBRATION)).toBe('open');
  });
});
