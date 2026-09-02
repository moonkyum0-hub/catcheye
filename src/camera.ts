export type CameraError = 'permission-denied' | 'no-device' | 'playback-failed' | 'unknown';

export interface CameraHandle {
  video: HTMLVideoElement;
  stop(): void;
}

export type CameraResult =
  | { ok: true; handle: CameraHandle }
  | { ok: false; error: CameraError };

function classifyAcquireError(error: unknown): CameraError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
  return 'unknown';
}

export async function startCamera(): Promise<CameraResult> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
  } catch (error) {
    return { ok: false, error: classifyAcquireError(error) };
  }

  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;

  try {
    await video.play();
  } catch {
    // 스트림은 이미 열렸다. 여기서 놓아주지 않으면 카메라가 켜진 채
    // 아무도 끌 수 없는 상태로 남는다. 자동재생 차단도 NotAllowedError를
    // 던지므로 권한 거부와 섞이지 않게 별도 코드로 구분한다.
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    return { ok: false, error: 'playback-failed' };
  }

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
}
