import { cp, mkdir } from 'node:fs/promises';

// MediaPipe WASM 런타임을 public/으로 복사한다. 실행 시 CDN을 부르지 않기 위해서다.
await mkdir('public/mediapipe', { recursive: true });
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', {
  recursive: true,
});
await mkdir('public/models', { recursive: true });
console.log('WASM 복사 완료. 모델은 README 절차대로 public/models/face_landmarker.task 에 둔다.');
