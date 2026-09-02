export type CameraError =
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'constraints-unsatisfiable'
  | 'playback-failed'
  | 'unknown';

export interface CameraHandle {
  video: HTMLVideoElement;
  stop(): void;
}

export type CameraResult =
  | { ok: true; handle: CameraHandle }
  // 이 모듈은 단위 테스트가 없다. 런타임 진단이 유일한 안전망이므로 원본 에러를 버리지 않는다.
  | { ok: false; error: CameraError; cause?: unknown };

/**
 * 던져진 값에서 `name`을 뽑는다. `DOMException`으로 좁히지 않는 이유가 있다 —
 * `OverconstrainedError`는 Media Capture 스펙에서 별도 인터페이스이고, 레거시 별칭
 * `TrackStartError` / `ConstraintNotSatisfiedError`는 `NavigatorUserMediaError`로
 * 던져지곤 했다. `DOMException`만 보면 정작 그 이름을 쓰는 엔진에서 죽은 분기가 된다.
 */
function errorName(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof (error as { name: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';
}

function classifyAcquireError(error: unknown): CameraError {
  const name = errorName(error);
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
  // 화상통화를 켠 채로 이 도구를 쓰는 것이 그룹 모드의 기본 사용 방식이다.
  // 다른 앱이 카메라를 잡고 있는 상황은 예외가 아니라 가장 흔한 실패다.
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'device-busy';
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'constraints-unsatisfiable';
  }
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
    return { ok: false, error: classifyAcquireError(error), cause: error };
  }

  const video = document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;

  try {
    await video.play();
  } catch (error) {
    // 스트림은 이미 열렸다. 여기서 놓아주지 않으면 카메라가 켜진 채
    // 아무도 끌 수 없는 상태로 남는다. 자동재생 차단도 NotAllowedError를
    // 던지므로 권한 거부와 섞이지 않게 별도 코드로 구분한다.
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    return { ok: false, error: 'playback-failed', cause: error };
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
