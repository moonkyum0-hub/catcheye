# PERCLOS 측정 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노트북 내장 웹캠으로 PERCLOS를 실시간 계산해 졸음 경고 이벤트를 내보내는 측정 코어를 만든다.

**Architecture:** 순수 계산 층(EAR, 보정, 프레임 판정, PERCLOS, 경고 정책)과 I/O 층(카메라, MediaPipe)을 분리한다. 순수 층은 카메라 없이 vitest로 전부 검증하고 먼저 만든다. I/O는 마지막에 붙인다.

**Tech Stack:** Vite + TypeScript(strict) + vitest + `@mediapipe/tasks-vision` (WASM, 로컬 번들)

**설계 문서:** `docs/superpowers/specs/2026-09-02-perclos-core-design.md`

## Global Constraints

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. 배열 인덱스 접근은 항상 `undefined` 검사를 거친다.
- 순수 계산 층(`ear.ts`, `calibration.ts`, `frameState.ts`, `perclos.ts`, `alertPolicy.ts`)은 DOM·카메라·MediaPipe를 **import하지 않는다**.
- 영상 프레임을 저장하거나 전송하지 않는다. 네트워크 호출은 코드 어디에도 없다. 모델과 WASM은 `public/`에 번들된 로컬 파일에서 로드한다.
- 값을 계산할 수 없으면 `null`을 반환한다. 추정값이나 0으로 대체하지 않는다.
- 상수는 정의에서 유도한 값만 쓴다: 감김 임계 `closedEar + 0.2 * (openEar - closedEar)` (P80), 보정 거부 `0.08`, PERCLOS 창 `60000ms`, 경고 `0.15`, 재무장 `0.08`, 쿨다운 `60000ms`, 미세수면 `500ms`, 드리프트 `alpha = 0.02`, 좌우 비대칭 한계 `0.3 * (openEar - closedEar)`, 유효 프레임 하한 `0.5`.
- 검증 명령은 `npm run check` (= `tsc --noEmit && vitest run`) 하나로 통일한다.
- 커밋 메시지는 "무엇을"보다 "왜"를 쓴다.

## File Structure

| 파일 | 책임 | 층 |
|---|---|---|
| `src/types.ts` | 공용 타입 (`Landmark`, `FrameState`, `FrameSample`) | - |
| `src/ear.ts` | landmark → 좌/우 EAR, 평균, 좌우 비대칭 | 순수 |
| `src/calibration.ts` | 백분위 계산, 보정 산출·검증, 드리프트 갱신 | 순수 |
| `src/frameState.ts` | EAR + 보정 → `open` / `closed` / `missing` | 순수 |
| `src/perclos.ts` | 프레임 시퀀스 → PERCLOS, 최장 감김 구간, 깜빡임 보조 지표 | 순수 |
| `src/alertPolicy.ts` | 지표 → 경고 이벤트. 쿨다운·재무장 상태기계 | 순수 |
| `src/camera.ts` | `getUserMedia`, 에러 분류, 정지 | I/O |
| `src/faceTracker.ts` | MediaPipe FaceLandmarker 초기화·검출 | I/O |
| `src/app.ts` | 보정 플로우 + 프레임 루프 + 최소 표시 | I/O |
| `scripts/copy-assets.mjs` | WASM을 `node_modules`에서 `public/`으로 복사 | 빌드 |

---

### Task 1: 프로젝트 스캐폴드와 EAR 계산

스캐폴드는 EAR 테스트를 돌리기 위해 필요하므로 같은 태스크에 넣는다.

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.html`, `.gitignore`
- Create: `src/types.ts`, `src/ear.ts`
- Test: `src/ear.test.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `interface Landmark { x: number; y: number; z: number }`
  - `interface EarResult { left: number; right: number; mean: number; asymmetry: number }`
  - `function computeEar(landmarks: readonly Landmark[], videoWidth: number, videoHeight: number): EarResult | null`

- [ ] **Step 1: package.json을 만들고 의존성을 설치한다**

`package.json`:

```json
{
  "name": "perclos",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "check": "tsc --noEmit && vitest run",
    "assets": "node scripts/copy-assets.mjs"
  }
}
```

버전을 손으로 적지 말고 설치 결과를 그대로 쓴다:

```bash
npm install -D typescript vite vitest
```

```bash
npm install @mediapipe/tasks-vision
```

- [ ] **Step 2: tsconfig.json, index.html, .gitignore를 만든다**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "scripts"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PERCLOS</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/app.ts"></script>
  </body>
</html>
```

`.gitignore`:

```
node_modules
dist
public/mediapipe
public/models
```

WASM과 모델 파일은 저장소에 넣지 않는다. `npm run assets`와 README의 다운로드 절차로 재생성한다.

- [ ] **Step 3: 실패하는 테스트를 작성한다**

`src/ear.test.ts`:

```ts
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
```

- [ ] **Step 4: 테스트를 실행해 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./ear"`

- [ ] **Step 5: 최소 구현을 작성한다**

`src/types.ts`:

```ts
export interface Landmark {
  x: number;
  y: number;
  z: number;
}
```

`src/ear.ts`:

```ts
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
```

- [ ] **Step 6: 검증한다**

Run: `npm run check`
Expected: tsc 에러 없음, vitest 6 passed

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json tsconfig.json index.html .gitignore src/types.ts src/ear.ts src/ear.test.ts && git commit -m "feat: EAR을 픽셀 종횡비 보정해 계산

정규화 좌표를 그대로 쓰면 640x480에서 EAR이 33% 부풀려진다.
비정사각형 해상도가 기본이므로 보정을 계산 안에 넣는다."
```

---

### Task 2: 보정 (기준선과 임계값)

**Files:**
- Create: `src/calibration.ts`
- Test: `src/calibration.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `function percentile(values: readonly number[], p: number): number | null`
  - `interface Calibration { openEar: number; closedEar: number; closedThreshold: number; asymmetryLimit: number }`
  - `type CalibrationResult = { ok: true; calibration: Calibration } | { ok: false; reason: 'no-samples' | 'insufficient-range' }`
  - `function buildCalibration(openSamples: readonly number[], closedSamples: readonly number[]): CalibrationResult`
  - `function updateOpenBaseline(calibration: Calibration, rollingP75: number): Calibration`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/calibration.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./calibration"`

- [ ] **Step 3: 최소 구현을 작성한다**

`src/calibration.ts`:

```ts
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
```

- [ ] **Step 4: 검증한다**

Run: `npm run check`
Expected: vitest 17 passed

- [ ] **Step 5: 커밋**

```bash
git add src/calibration.ts src/calibration.test.ts && git commit -m "feat: 개인 보정으로 감김 임계값을 유도

고정 EAR 임계값은 눈 크기와 안경 때문에 사람마다 빗나간다.
임계값을 임의로 고르는 대신 PERCLOS의 P80 정의에서 계산한다."
```

---

### Task 3: 프레임 판정 (open / closed / missing)

**Files:**
- Create: `src/frameState.ts`
- Modify: `src/types.ts` (`FrameState`, `FrameSample` 추가)
- Test: `src/frameState.test.ts`

**Interfaces:**
- Consumes: `EarResult` (Task 1), `Calibration` (Task 2)
- Produces:
  - `type FrameState = 'open' | 'closed' | 'missing'`
  - `interface FrameSample { t: number; state: FrameState }`
  - `function classifyFrame(ear: EarResult | null, calibration: Calibration): FrameState`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/frameState.test.ts`:

```ts
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
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./frameState"`

- [ ] **Step 3: 최소 구현을 작성한다**

`src/types.ts`에 추가한다:

```ts
export type FrameState = 'open' | 'closed' | 'missing';

export interface FrameSample {
  t: number;
  state: FrameState;
}
```

`src/frameState.ts`:

```ts
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
```

- [ ] **Step 4: 검증한다**

Run: `npm run check`
Expected: vitest 23 passed

- [ ] **Step 5: 커밋**

```bash
git add src/types.ts src/frameState.ts src/frameState.test.ts && git commit -m "feat: 판정 불가 프레임을 missing으로 분리

자리 비움과 측면 각도를 감김으로 세면 졸음으로 오판한다.
세 상태를 명시적으로 나눠 이후 계산에서 제외할 수 있게 한다."
```

---

### Task 4: PERCLOS와 미세수면 계산

**Files:**
- Create: `src/perclos.ts`
- Test: `src/perclos.test.ts`

**Interfaces:**
- Consumes: `FrameSample` (Task 3)
- Produces:
  - `const WINDOW_MS: number` (60000)
  - `interface PerclosResult { value: number | null; validRatio: number; longestClosedMs: number; blinkCount: number; meanBlinkMs: number | null }`
  - `function analyzeWindow(samples: readonly FrameSample[], now: number, windowMs?: number): PerclosResult`

**설계 메모:** 감김 구간의 길이는 `마지막 감김 프레임의 t − 첫 감김 프레임의 t`로 정의한다. 마지막 프레임의 노출 시간(30fps에서 약 33ms)만큼 과소평가되지만, 정의가 명확하고 프레임 간격 추정에 의존하지 않는다. 이 근사는 코드 주석과 README 한계 항목에 남긴다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/perclos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { analyzeWindow } from './perclos';
import type { FrameSample, FrameState } from './types';

const FRAME_MS = 1000 / 30;

// 30fps로 runs를 이어붙인 샘플 배열을 만든다.
function frames(...runs: Array<[FrameState, number]>): FrameSample[] {
  const samples: FrameSample[] = [];
  let index = 0;
  for (const [state, count] of runs) {
    for (let i = 0; i < count; i += 1) {
      samples.push({ t: index * FRAME_MS, state });
      index += 1;
    }
  }
  return samples;
}

function lastTime(samples: readonly FrameSample[]): number {
  const last = samples[samples.length - 1];
  if (!last) throw new Error('샘플이 있어야 한다');
  return last.t;
}

describe('analyzeWindow', () => {
  it('감김 프레임 비율을 PERCLOS로 계산한다', () => {
    // 1800프레임 중 360프레임 감김 = 0.20
    const samples = frames(['closed', 360], ['open', 1440]);
    const result = analyzeWindow(samples, lastTime(samples));
    expect(result.value).toBeCloseTo(0.2, 10);
    expect(result.validRatio).toBeCloseTo(1, 10);
  });

  it('missing 프레임은 분모에서 뺀다', () => {
    // 유효 900프레임 중 감김 90 = 0.10
    const samples = frames(['missing', 900], ['closed', 90], ['open', 810]);
    const result = analyzeWindow(samples, lastTime(samples));
    expect(result.value).toBeCloseTo(0.1, 10);
    expect(result.validRatio).toBeCloseTo(0.5, 10);
  });

  it('유효 프레임이 50% 미만이면 값을 내지 않는다', () => {
    const samples = frames(['missing', 1000], ['open', 800]);
    const result = analyzeWindow(samples, lastTime(samples));
    expect(result.value).toBeNull();
    expect(result.validRatio).toBeLessThan(0.5);
  });

  it('창 밖의 오래된 샘플은 무시한다', () => {
    // 0~60초는 전부 감김, 60~120초는 전부 열림. now=120초면 최근 60초만 본다.
    const samples: FrameSample[] = [];
    for (let t = 0; t < 60000; t += FRAME_MS) samples.push({ t, state: 'closed' });
    for (let t = 60000; t <= 120000; t += FRAME_MS) samples.push({ t, state: 'open' });
    const result = analyzeWindow(samples, 120000);
    expect(result.value).toBeCloseTo(0, 10);
  });

  it('샘플이 없으면 값을 내지 않는다', () => {
    const result = analyzeWindow([], 0);
    expect(result.value).toBeNull();
    expect(result.validRatio).toBe(0);
    expect(result.longestClosedMs).toBe(0);
  });

  it('최장 감김 구간의 길이를 잰다', () => {
    const samples: FrameSample[] = [
      { t: 1000, state: 'closed' },
      { t: 1499, state: 'closed' },
      { t: 1600, state: 'open' },
    ];
    expect(analyzeWindow(samples, 1600).longestClosedMs).toBeCloseTo(499, 10);
  });

  it('미세수면 경계를 넘는 구간을 잡아낸다', () => {
    const samples: FrameSample[] = [
      { t: 1000, state: 'closed' },
      { t: 1501, state: 'closed' },
      { t: 1600, state: 'open' },
    ];
    expect(analyzeWindow(samples, 1600).longestClosedMs).toBeCloseTo(501, 10);
  });

  it('missing이 감김 구간을 끊는다', () => {
    const samples: FrameSample[] = [
      { t: 0, state: 'closed' },
      { t: 400, state: 'missing' },
      { t: 800, state: 'closed' },
    ];
    // 두 구간 다 단일 프레임이므로 길이 0
    expect(analyzeWindow(samples, 800).longestClosedMs).toBe(0);
  });

  it('깜빡임 횟수와 평균 길이를 보조 지표로 낸다', () => {
    const samples: FrameSample[] = [
      { t: 0, state: 'open' },
      { t: 100, state: 'closed' },
      { t: 200, state: 'closed' },
      { t: 300, state: 'open' },
      { t: 400, state: 'closed' },
      { t: 700, state: 'closed' },
      { t: 800, state: 'open' },
    ];
    const result = analyzeWindow(samples, 800);
    expect(result.blinkCount).toBe(2);
    // (100 + 300) / 2 = 200
    expect(result.meanBlinkMs).toBeCloseTo(200, 10);
  });

  it('깜빡임이 없으면 평균 길이는 null이다', () => {
    const samples = frames(['open', 30]);
    expect(analyzeWindow(samples, lastTime(samples)).meanBlinkMs).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./perclos"`

- [ ] **Step 3: 최소 구현을 작성한다**

`src/perclos.ts`:

```ts
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
```

- [ ] **Step 4: 검증한다**

Run: `npm run check`
Expected: vitest 33 passed

- [ ] **Step 5: 커밋**

```bash
git add src/perclos.ts src/perclos.test.ts && git commit -m "feat: 60초 창에서 PERCLOS와 최장 감김 구간을 계산

유효 프레임이 절반에 못 미치면 값을 내지 않는다.
자리를 비웠을 때 그럴듯한 숫자를 만들지 않기 위해서다."
```

---

### Task 5: 경고 정책 (쿨다운과 재무장)

**Files:**
- Create: `src/alertPolicy.ts`
- Test: `src/alertPolicy.test.ts`

**Interfaces:**
- Consumes: `PerclosResult` (Task 4) — `value`와 `longestClosedMs`만 쓴다
- Produces:
  - `interface AlertState { armed: boolean; lastAlertAt: number | null }`
  - `interface AlertEvent { type: 'perclos' | 'microsleep'; value: number; at: number }`
  - `interface AlertInput { perclos: number | null; longestClosedMs: number; now: number }`
  - `const INITIAL_ALERT_STATE: AlertState`
  - `function updateAlert(state: AlertState, input: AlertInput): { state: AlertState; event: AlertEvent | null }`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/alertPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { INITIAL_ALERT_STATE, updateAlert } from './alertPolicy';

describe('updateAlert', () => {
  it('PERCLOS가 15% 이상이면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'perclos', value: 0.2, at: 1000 });
    expect(result.state.armed).toBe(false);
    expect(result.state.lastAlertAt).toBe(1000);
  });

  it('정확히 15%면 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.15,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event?.type).toBe('perclos');
  });

  it('15% 미만이면 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.14,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('미세수면은 PERCLOS와 무관하게 즉시 경고한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 501,
      now: 1000,
    });
    expect(result.event).toEqual({ type: 'microsleep', value: 501, at: 1000 });
  });

  it('미세수면 경계 아래(499ms)는 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.02,
      longestClosedMs: 499,
      now: 1000,
    });
    expect(result.event).toBeNull();
  });

  it('미세수면이 PERCLOS보다 우선한다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.3,
      longestClosedMs: 600,
      now: 1000,
    });
    expect(result.event?.type).toBe('microsleep');
  });

  it('PERCLOS가 null이면 경고하지 않는다', () => {
    const result = updateAlert(INITIAL_ALERT_STATE, {
      perclos: null,
      longestClosedMs: 0,
      now: 1000,
    });
    expect(result.event).toBeNull();
    expect(result.state.armed).toBe(true);
  });

  it('경고 후 60초 안에는 다시 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 0,
    });
    const second = updateAlert(first.state, {
      perclos: 0.3,
      longestClosedMs: 700,
      now: 30_000,
    });
    expect(second.event).toBeNull();
  });

  it('쿨다운이 끝나도 재무장 전에는 경고하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, { perclos: 0.2, longestClosedMs: 0, now: 0 });
    const second = updateAlert(first.state, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 70_000,
    });
    expect(second.event).toBeNull();
    expect(second.state.armed).toBe(false);
  });

  it('PERCLOS가 8% 아래로 내려가면 재무장하고 다시 경고할 수 있다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, { perclos: 0.2, longestClosedMs: 0, now: 0 });
    const rearmed = updateAlert(first.state, {
      perclos: 0.05,
      longestClosedMs: 0,
      now: 70_000,
    });
    expect(rearmed.state.armed).toBe(true);
    expect(rearmed.event).toBeNull();

    const third = updateAlert(rearmed.state, {
      perclos: 0.2,
      longestClosedMs: 0,
      now: 80_000,
    });
    expect(third.event?.type).toBe('perclos');
  });

  it('쿨다운 중에는 재무장하지 않는다', () => {
    const first = updateAlert(INITIAL_ALERT_STATE, { perclos: 0.2, longestClosedMs: 0, now: 0 });
    const during = updateAlert(first.state, {
      perclos: 0.01,
      longestClosedMs: 0,
      now: 30_000,
    });
    expect(during.state.armed).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./alertPolicy"`

- [ ] **Step 3: 최소 구현을 작성한다**

`src/alertPolicy.ts`:

```ts
export const PERCLOS_ALERT = 0.15;
export const PERCLOS_REARM = 0.08;
export const MICROSLEEP_MS = 500;
export const COOLDOWN_MS = 60_000;

export interface AlertState {
  armed: boolean;
  lastAlertAt: number | null;
}

export interface AlertEvent {
  type: 'perclos' | 'microsleep';
  value: number;
  at: number;
}

export interface AlertInput {
  perclos: number | null;
  longestClosedMs: number;
  now: number;
}

export const INITIAL_ALERT_STATE: AlertState = { armed: true, lastAlertAt: null };

export function updateAlert(
  state: AlertState,
  input: AlertInput,
): { state: AlertState; event: AlertEvent | null } {
  const { perclos, longestClosedMs, now } = input;
  const inCooldown = state.lastAlertAt !== null && now - state.lastAlertAt < COOLDOWN_MS;

  if (inCooldown) return { state, event: null };

  if (!state.armed) {
    // 임계 근처에서 경고가 연타되는 것을 막는다. 충분히 내려와야 다시 무장한다.
    if (perclos !== null && perclos < PERCLOS_REARM) {
      return { state: { ...state, armed: true }, event: null };
    }
    return { state, event: null };
  }

  if (longestClosedMs >= MICROSLEEP_MS) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'microsleep', value: longestClosedMs, at: now },
    };
  }

  if (perclos !== null && perclos >= PERCLOS_ALERT) {
    return {
      state: { armed: false, lastAlertAt: now },
      event: { type: 'perclos', value: perclos, at: now },
    };
  }

  return { state, event: null };
}
```

- [ ] **Step 4: 검증한다**

Run: `npm run check`
Expected: vitest 44 passed

- [ ] **Step 5: 커밋**

```bash
git add src/alertPolicy.ts src/alertPolicy.test.ts && git commit -m "feat: 쿨다운과 재무장을 둔 경고 상태기계

임계값 근처에서 경고가 연타되면 사람이 무시하게 된다.
경고 후 60초를 쉬고, PERCLOS가 8% 아래로 내려와야 다시 무장한다."
```

---

### Task 6: 카메라와 얼굴 랜드마크 (I/O)

**Files:**
- Create: `src/camera.ts`, `src/faceTracker.ts`, `scripts/copy-assets.mjs`

**Interfaces:**
- Consumes: `Landmark` (Task 1)
- Produces:
  - `type CameraError = 'permission-denied' | 'no-device' | 'unknown'`
  - `interface CameraHandle { video: HTMLVideoElement; stop(): void }`
  - `type CameraResult = { ok: true; handle: CameraHandle } | { ok: false; error: CameraError }`
  - `function startCamera(): Promise<CameraResult>`
  - `interface FaceTracker { detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null; close(): void }`
  - `function createFaceTracker(): Promise<FaceTracker>`

**주의:** 이 태스크는 모델 파일 다운로드가 필요하다. 실행하는 에이전트는 다운로드 전에 사용자 승인을 받는다 (약 3.8MB, Google 공식 스토리지).

- [ ] **Step 1: 에셋 복사 스크립트를 만든다**

`scripts/copy-assets.mjs`:

```js
import { cp, mkdir } from 'node:fs/promises';

// MediaPipe WASM 런타임을 public/으로 복사한다. 실행 시 CDN을 부르지 않기 위해서다.
await mkdir('public/mediapipe', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', {
  recursive: true,
});
await mkdir('public/models', { recursive: true });
console.log('WASM 복사 완료. 모델은 README 절차대로 public/models/face_landmarker.task 에 둔다.');
```

- [ ] **Step 2: WASM을 복사한다**

```bash
npm run assets
```

Expected: `public/mediapipe/wasm/` 아래에 `.wasm`과 `.js` 파일이 생긴다.

- [ ] **Step 3: 모델 파일을 내려받는다 (사용자 승인 필요)**

사용자에게 다운로드 승인을 받은 뒤 실행한다:

```bash
curl -L -o public/models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

확인:

```bash
ls -l public/models/face_landmarker.task
```

Expected: 3MB 이상

- [ ] **Step 4: camera.ts를 작성한다**

`src/camera.ts`:

```ts
export type CameraError = 'permission-denied' | 'no-device' | 'unknown';

export interface CameraHandle {
  video: HTMLVideoElement;
  stop(): void;
}

export type CameraResult =
  | { ok: true; handle: CameraHandle }
  | { ok: false; error: CameraError };

export async function startCamera(): Promise<CameraResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
    return {
      ok: true,
      handle: {
        video,
        stop() {
          for (const track of stream.getTracks()) track.stop();
          video.srcObject = null;
        },
      },
    };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { ok: false, error: 'permission-denied' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { ok: false, error: 'no-device' };
    }
    return { ok: false, error: 'unknown' };
  }
}
```

- [ ] **Step 5: faceTracker.ts를 작성한다**

`src/faceTracker.ts`:

```ts
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Landmark } from './types';

export interface FaceTracker {
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  close(): void;
}

export async function createFaceTracker(): Promise<FaceTracker> {
  // 경로는 전부 public/ 아래의 로컬 파일이다. 네트워크를 타지 않는다.
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
  });

  return {
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      const face = result.faceLandmarks[0];
      return face && face.length > 0 ? (face as Landmark[]) : null;
    },
    close() {
      landmarker.close();
    },
  };
}
```

- [ ] **Step 6: 검증한다**

Run: `npm run check`
Expected: tsc 에러 없음, vitest 44 passed (I/O 층은 단위 테스트 대상이 아니다)

- [ ] **Step 7: 커밋**

```bash
git add src/camera.ts src/faceTracker.ts scripts/copy-assets.mjs && git commit -m "feat: 카메라와 얼굴 랜드마크를 로컬 자산으로 연결

WASM과 모델을 public/에 번들해 실행 중 네트워크 호출이 없게 한다.
카메라 실패는 권한 거부와 장치 없음을 구분해 다르게 안내한다."
```

---

### Task 7: 통합 루프와 최소 표시

프론트엔드 설계는 별도 스펙이다. 여기서는 코어가 실제로 도는지 눈으로 확인할 최소한만 만든다.

**Files:**
- Create: `src/app.ts`, `README.md`, `.claude/launch.json`
- Test: 브라우저 수동 검증

**Interfaces:**
- Consumes: 앞선 모든 태스크의 export
- Produces: 없음 (진입점)

**주의 1:** MediaPipe의 `detectForVideo`는 같은 타임스탬프로 두 번 호출하면 실패한다. 프레임당 정확히 한 번만 부른다.

**주의 2:** `requestVideoFrameCallback`이 설치된 TypeScript의 `lib.dom.d.ts`에 없으면 tsc가 에러를 낸다. 그때는 `src/video.d.ts`를 만든다:

```ts
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(callback: (now: number, metadata: object) => void): number;
    cancelVideoFrameCallback(handle: number): void;
  }
}

export {};
```

- [ ] **Step 1: app.ts를 작성한다**

`src/app.ts`:

```ts
import { INITIAL_ALERT_STATE, updateAlert, type AlertState } from './alertPolicy';
import { buildCalibration, percentile, updateOpenBaseline, type Calibration } from './calibration';
import { startCamera } from './camera';
import { computeEar } from './ear';
import { createFaceTracker } from './faceTracker';
import { classifyFrame } from './frameState';
import { analyzeWindow, WINDOW_MS } from './perclos';
import type { FrameSample } from './types';

const OPEN_PHASE_MS = 15_000;
const CLOSED_PHASE_MS = 3_000;
const DRIFT_WINDOW_MS = 300_000;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app 요소가 필요하다');

const status = document.createElement('pre');
const startButton = document.createElement('button');
startButton.textContent = '시작';
root.append(startButton, status);

function render(lines: string[]): void {
  status.textContent = lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  startButton.disabled = true;

  const camera = await startCamera();
  if (!camera.ok) {
    const message = {
      'permission-denied': '카메라 권한이 거부됐습니다. 브라우저 설정에서 허용해 주세요.',
      'no-device': '카메라를 찾을 수 없습니다.',
      unknown: '카메라를 열지 못했습니다.',
    }[camera.error];
    render([message]);
    startButton.disabled = false;
    return;
  }

  const tracker = await createFaceTracker();
  const { video } = camera.handle;

  // 프레임당 한 번만 검출한다. 같은 타임스탬프로 두 번 부르면 MediaPipe가 실패한다.
  const readFrame = (timestampMs: number) => {
    const landmarks = tracker.detect(video, timestampMs);
    return landmarks ? computeEar(landmarks, video.videoWidth, video.videoHeight) : null;
  };

  const stop = (): void => {
    camera.handle.stop();
    tracker.close();
    startButton.disabled = false;
  };

  // --- 보정 ---
  const collect = async (label: string, durationMs: number): Promise<number[]> => {
    const samples: number[] = [];
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      const remaining = Math.ceil((durationMs - (performance.now() - start)) / 1000);
      render([`${label} (${remaining}초)`, `수집 ${samples.length}개`]);
      const ear = readFrame(performance.now());
      if (ear) samples.push(ear.mean);
      await sleep(33);
    }
    return samples;
  };

  const openSamples = await collect('평소대로 화면을 보세요', OPEN_PHASE_MS);
  const closedSamples = await collect('눈을 감아 주세요', CLOSED_PHASE_MS);
  const built = buildCalibration(openSamples, closedSamples);

  if (!built.ok) {
    render([
      built.reason === 'no-samples'
        ? '얼굴이 잡히지 않았습니다. 조명과 카메라 각도를 확인하고 다시 시작하세요.'
        : '열린 눈과 감은 눈의 차이가 너무 작습니다. 조명을 밝게 하고 다시 시작하세요.',
    ]);
    stop();
    return;
  }

  let calibration: Calibration = built.calibration;
  let alertState: AlertState = INITIAL_ALERT_STATE;
  const samples: FrameSample[] = [];
  const openEarHistory: Array<{ t: number; ear: number }> = [];
  let lastTick = 0;
  let lastEvent = '없음';

  // --- 측정 루프 ---
  const onFrame = (now: number): void => {
    const ear = readFrame(now);
    const state = classifyFrame(ear, calibration);

    samples.push({ t: now, state });
    while (samples.length > 0 && (samples[0]?.t ?? now) < now - WINDOW_MS) samples.shift();

    if (state === 'open' && ear) {
      openEarHistory.push({ t: now, ear: ear.mean });
      while (openEarHistory.length > 0 && (openEarHistory[0]?.t ?? now) < now - DRIFT_WINDOW_MS) {
        openEarHistory.shift();
      }
    }

    if (now - lastTick >= 1000) {
      lastTick = now;
      const analysis = analyzeWindow(samples, now);
      const result = updateAlert(alertState, {
        perclos: analysis.value,
        longestClosedMs: analysis.longestClosedMs,
        now,
      });
      alertState = result.state;

      const rollingP75 = percentile(
        openEarHistory.map((entry) => entry.ear),
        0.75,
      );
      if (rollingP75 !== null) calibration = updateOpenBaseline(calibration, rollingP75);

      if (result.event) {
        console.warn('졸음 경고', result.event);
        lastEvent = `${result.event.type} @ ${(result.event.at / 1000).toFixed(0)}s`;
      }

      render([
        `PERCLOS: ${analysis.value === null ? '–' : `${(analysis.value * 100).toFixed(1)}%`}`,
        `유효 프레임: ${(analysis.validRatio * 100).toFixed(0)}%`,
        `최장 감김: ${analysis.longestClosedMs.toFixed(0)}ms`,
        `깜빡임: ${analysis.blinkCount}회 / 평균 ${analysis.meanBlinkMs?.toFixed(0) ?? '–'}ms`,
        `임계 EAR: ${calibration.closedThreshold.toFixed(4)}`,
        `마지막 경고: ${lastEvent}`,
      ]);
    }

    video.requestVideoFrameCallback(() => onFrame(performance.now()));
  };

  video.requestVideoFrameCallback(() => onFrame(performance.now()));
}

startButton.addEventListener('click', () => {
  void main();
});
```

- [ ] **Step 2: launch.json을 만든다**

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "perclos",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5173
    }
  ]
}
```

- [ ] **Step 3: README.md를 작성한다**

`README.md`:

~~~markdown
# PERCLOS

노트북 내장 웹캠으로 PERCLOS(눈꺼풀이 동공을 80% 이상 덮은 시간의 비율)를 실시간 계산해
졸음 경고를 내보내는 측정 도구.

## 설치

```bash
npm install
npm run assets
curl -L -o public/models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
npm run dev
```

## 사용

시작을 누르면 약 20초 보정을 거친다. 15초는 평소대로 화면을 보고, 3초는 눈을 감는다.
보정이 끝나면 1초마다 PERCLOS가 갱신되고, 경고는 콘솔에 찍힌다.

## 검증

```bash
npm run check
```

## 한계

- 경고 임계값 15%는 운전 시뮬레이터 연구에서 나온 값이다. 책상 작업에는 맞지 않을 수 있다.
- 감김 구간의 길이는 마지막 프레임의 노출 시간(30fps에서 약 33ms)만큼 과소평가된다.
- 안경 반사와 저조도에서 정확도가 떨어진다. 이때는 값을 만들지 않고 `–`로 표시한다.
- **의료기기가 아니다.** 수면장애 진단이나 운전 적합성 판정에 쓸 수 없다.

## 프라이버시

영상 프레임은 메모리에서만 처리하며 저장하거나 전송하지 않는다.
모델과 WASM은 로컬 파일에서 로드하므로 실행 중 네트워크 호출이 없다.
~~~

- [ ] **Step 4: 브라우저에서 검증한다**

preview_start로 `perclos` 설정을 띄우고 확인한다:

1. 시작 버튼 → 카메라 권한 요청이 뜬다
2. 보정 안내 문구가 카운트다운과 함께 바뀐다
3. 보정 후 PERCLOS가 숫자로 갱신된다
4. 눈을 1초 이상 감으면 콘솔에 `졸음 경고 { type: 'microsleep', ... }`이 찍힌다
5. 카메라 앞을 벗어나면 PERCLOS가 `–`가 되고 경고가 뜨지 않는다
6. 콘솔에 에러가 없다
7. 네트워크 탭에 외부 도메인 요청이 없다

문제가 있으면 `superpowers:systematic-debugging`으로 진단한다.

- [ ] **Step 5: 커밋**

```bash
git add src/app.ts README.md .claude/launch.json && git commit -m "feat: 보정부터 경고까지 이어지는 루프를 연결

프론트엔드 설계 전에 코어가 실제 카메라에서 도는지 확인하기 위한 최소 표시다.
경고는 콘솔로만 내보내고 연출은 별도 스펙에서 정한다."
```

---

## 완료 후

코어가 실제 카메라에서 도는 것을 확인하면 프론트엔드 설계로 넘어간다.
그때 정할 것: 경고 연출(소리·화면), 창 크기와 상시 표시, 임계값 조정 UI, 측정 결과 저장 여부.
