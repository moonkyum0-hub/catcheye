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
