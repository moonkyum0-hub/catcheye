import type { Landmark } from './types';

// MediaPipe Face Mesh 인덱스. 순서는 [바깥끝, 위1, 위2, 안끝, 아래2, 아래1].
const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;
const LEFT_EYE = [362, 385, 387, 263, 373, 380] as const;

export interface EarResult {
  left: number;
  right: number;
  mean: number;
  asymmetry: number;
}

function distance(a: Landmark, b: Landmark, width: number, height: number): number {
  // 랜드마크는 0~1로 정규화돼 있다. 픽셀로 되돌리지 않으면 비정사각형 영상에서 비율이 왜곡된다.
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
}

function collect(landmarks: readonly Landmark[], indices: readonly number[]): Landmark[] | null {
  const points: Landmark[] = [];
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) return null;
    // 얼굴이 프레임을 벗어나면 MediaPipe가 0~1 밖 좌표를 추정한다. 그 값은 믿지 않는다.
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return null;
    points.push(point);
  }
  return points;
}

function eyeAspectRatio(points: readonly Landmark[], width: number, height: number): number | null {
  const [p1, p2, p3, p4, p5, p6] = points;
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null;
  const horizontal = distance(p1, p4, width, height);
  if (horizontal === 0) return null;
  return (distance(p2, p6, width, height) + distance(p3, p5, width, height)) / (2 * horizontal);
}

export function computeEar(
  landmarks: readonly Landmark[],
  videoWidth: number,
  videoHeight: number,
): EarResult | null {
  const rightPoints = collect(landmarks, RIGHT_EYE);
  const leftPoints = collect(landmarks, LEFT_EYE);
  if (!rightPoints || !leftPoints) return null;

  const right = eyeAspectRatio(rightPoints, videoWidth, videoHeight);
  const left = eyeAspectRatio(leftPoints, videoWidth, videoHeight);
  if (right === null || left === null) return null;

  return { left, right, mean: (left + right) / 2, asymmetry: Math.abs(left - right) };
}
