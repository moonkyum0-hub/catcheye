import type { Calibration } from './calibration';
import type { EarResult } from './ear';
import type { FrameState } from './types';

export function classifyFrame(ear: EarResult | null, calibration: Calibration): FrameState {
  // 얼굴 미검출과 한쪽 눈만 보이는 각도는 둘 다 판정 불가다.
  // 자리를 비운 것을 졸음으로 세는 것이 이 부류 프로그램의 가장 흔한 오판이다.
  if (ear === null) return 'missing';
  if (ear.asymmetry > calibration.asymmetryLimit) return 'missing';
  return ear.mean <= calibration.closedThreshold ? 'closed' : 'open';
}
