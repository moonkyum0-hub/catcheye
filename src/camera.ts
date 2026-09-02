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
