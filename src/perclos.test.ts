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
