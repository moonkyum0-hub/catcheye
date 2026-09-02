import { describe, expect, it } from 'vitest';
import { computeEar } from './ear';
import type { Landmark } from './types';

// 478개 랜드마크 배열을 만들고 지정한 인덱스만 덮어쓴다.
function makeLandmarks(overrides: Record<number, { x: number; y: number }>): Landmark[] {
  const arr: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [index, point] of Object.entries(overrides)) {
    arr[Number(index)] = { x: point.x, y: point.y, z: 0 };
  }
  return arr;
}

// 양쪽 눈을 가로 0.1, 위아래 각각 0.02씩 벌어진 대칭 형태로 배치한다.
// 640x480에서 가로 64px, 세로 19.2px -> EAR = (19.2 + 19.2) / (2 * 64) = 0.3
const SYMMETRIC_EYES = makeLandmarks({
  33: { x: 0.1, y: 0.5 },
  133: { x: 0.2, y: 0.5 },
  160: { x: 0.125, y: 0.48 },
  144: { x: 0.125, y: 0.52 },
  158: { x: 0.175, y: 0.48 },
  153: { x: 0.175, y: 0.52 },
  362: { x: 0.8, y: 0.5 },
  263: { x: 0.9, y: 0.5 },
  385: { x: 0.825, y: 0.48 },
  380: { x: 0.825, y: 0.52 },
  387: { x: 0.875, y: 0.48 },
  373: { x: 0.875, y: 0.52 },
});

describe('computeEar', () => {
  it('픽셀 종횡비를 보정해 EAR을 계산한다', () => {
    const result = computeEar(SYMMETRIC_EYES, 640, 480);
    expect(result).not.toBeNull();
    // 정규화 좌표를 그대로 쓰면 0.4가 나온다. 0.3이어야 보정이 걸린 것이다.
    expect(result?.right).toBeCloseTo(0.3, 6);
    expect(result?.left).toBeCloseTo(0.3, 6);
    expect(result?.mean).toBeCloseTo(0.3, 6);
    expect(result?.asymmetry).toBeCloseTo(0, 6);
  });

  it('정사각형 해상도에서는 정규화 좌표 계산과 같아진다', () => {
    const result = computeEar(SYMMETRIC_EYES, 480, 480);
    expect(result?.mean).toBeCloseTo(0.4, 6);
  });

  it('좌우 눈이 다르면 비대칭을 보고한다', () => {
    // 왼쪽 눈만 절반으로 감긴 형태 (세로 0.02 -> 0.01)
    const asymmetric = makeLandmarks({
      33: { x: 0.1, y: 0.5 },
      133: { x: 0.2, y: 0.5 },
      160: { x: 0.125, y: 0.48 },
      144: { x: 0.125, y: 0.52 },
      158: { x: 0.175, y: 0.48 },
      153: { x: 0.175, y: 0.52 },
      362: { x: 0.8, y: 0.5 },
      263: { x: 0.9, y: 0.5 },
      385: { x: 0.825, y: 0.49 },
      380: { x: 0.825, y: 0.51 },
      387: { x: 0.875, y: 0.49 },
      373: { x: 0.875, y: 0.51 },
    });
    const result = computeEar(asymmetric, 640, 480);
    expect(result?.right).toBeCloseTo(0.3, 6);
    expect(result?.left).toBeCloseTo(0.15, 6);
    expect(result?.asymmetry).toBeCloseTo(0.15, 6);
  });

  it('필요한 랜드마크가 없으면 null을 반환한다', () => {
    expect(computeEar([], 640, 480)).toBeNull();
  });

  it('눈이 화면 밖으로 나가면 null을 반환한다', () => {
    // MediaPipe는 얼굴이 프레임을 벗어나도 0~1 범위 밖 좌표를 추정해서 내놓는다.
    const outOfFrame = makeLandmarks({
      33: { x: 1.05, y: 0.5 },
      133: { x: 1.15, y: 0.5 },
      160: { x: 1.075, y: 0.48 },
      144: { x: 1.075, y: 0.52 },
      158: { x: 1.125, y: 0.48 },
      153: { x: 1.125, y: 0.52 },
      362: { x: 0.8, y: 0.5 },
      263: { x: 0.9, y: 0.5 },
      385: { x: 0.825, y: 0.48 },
      380: { x: 0.825, y: 0.52 },
      387: { x: 0.875, y: 0.48 },
      373: { x: 0.875, y: 0.52 },
    });
    expect(computeEar(outOfFrame, 640, 480)).toBeNull();
  });

  it('가로 폭이 0이면 null을 반환한다', () => {
    const degenerate = makeLandmarks({
      33: { x: 0.1, y: 0.5 },
      133: { x: 0.1, y: 0.5 },
      160: { x: 0.1, y: 0.48 },
      144: { x: 0.1, y: 0.52 },
      158: { x: 0.1, y: 0.48 },
      153: { x: 0.1, y: 0.52 },
      362: { x: 0.8, y: 0.5 },
      263: { x: 0.9, y: 0.5 },
      385: { x: 0.825, y: 0.48 },
      380: { x: 0.825, y: 0.52 },
      387: { x: 0.875, y: 0.48 },
      373: { x: 0.875, y: 0.52 },
    });
    expect(computeEar(degenerate, 640, 480)).toBeNull();
  });
});
