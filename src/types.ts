export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type FrameState = 'open' | 'closed' | 'missing';

export interface FrameSample {
  t: number;
  state: FrameState;
}
