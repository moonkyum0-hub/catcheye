import { INITIAL_ALERT_STATE, updateAlert, type AlertState } from './alertPolicy';
import { buildCalibration, percentile, updateOpenBaseline, type Calibration } from './calibration';
import { startCamera } from './camera';
import { computeEar } from './ear';
import { createFaceTracker } from './faceTracker';
import { classifyFrame } from './frameState';
import { analyzeWindow, WINDOW_MS } from './perclos';
import {
  INITIAL_SESSION_STATUS_STATE,
  updateSessionStatus,
  type SessionStatusState,
} from './sessionStatus';
import { connectSession, type Session } from './session';
import type { ParticipantView, Status } from '../shared/protocol';
import type { FrameSample } from './types';

const OPEN_PHASE_MS = 15_000;
const CLOSED_PHASE_MS = 3_000;
const DRIFT_WINDOW_MS = 300_000;
const SERVER_URL = `ws://${window.location.hostname}:8787`;

const STATUS_LABEL: Record<Status, string> = {
  present: '재중',
  drowsy: '졸고 있음',
  unmeasurable: '측정 불가',
};

const CAMERA_MESSAGE = {
  'permission-denied': '카메라 권한이 거부됐습니다.',
  'no-device': '카메라를 찾을 수 없습니다.',
  'device-busy': '다른 앱이 카메라를 쓰고 있습니다. 화상통화 앱을 확인해 주세요.',
  'constraints-unsatisfiable': '이 카메라가 요청한 해상도를 지원하지 않습니다.',
  'playback-failed': '카메라 영상을 재생하지 못했습니다.',
  unknown: '카메라를 열지 못했습니다.',
} as const;

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app 요소가 필요하다');

const nameInput = document.createElement('input');
nameInput.placeholder = '이름';
const codeInput = document.createElement('input');
codeInput.placeholder = '방 코드 (예: ABC123)';
const startButton = document.createElement('button');
startButton.textContent = '시작';
const status = document.createElement('pre');
const roster = document.createElement('div');
root.append(nameInput, codeInput, startButton, status, roster);

function render(lines: string[]): void {
  status.textContent = lines.filter((line) => line !== '').join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 깨우기를 받았을 때 소리를 낸다. 외부 음원 없이 오실레이터로 만든다. */
function playAlarm(): void {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = 880;
  gain.gain.value = 0.2;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  window.setTimeout(() => {
    oscillator.stop();
    void context.close();
  }, 1500);
}

async function main(): Promise<void> {
  startButton.disabled = true;

  const camera = await startCamera();
  if (!camera.ok) {
    render([CAMERA_MESSAGE[camera.error]]);
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

  const built = buildCalibration(
    await collect('평소대로 화면을 보세요', OPEN_PHASE_MS),
    await collect('눈을 감아 주세요', CLOSED_PHASE_MS),
  );

  if (!built.ok) {
    render([
      built.reason === 'no-samples'
        ? '얼굴이 잡히지 않았습니다. 조명과 각도를 확인하고 다시 시작하세요.'
        : '열린 눈과 감은 눈의 차이가 너무 작습니다. 조명을 밝게 하고 다시 시작하세요.',
    ]);
    stop();
    return;
  }

  // --- 세션 연결 ---
  let participants: ParticipantView[] = [];
  let selfId: string | null = null;
  let connected = false;
  let notice = '';

  function renderRoster(): void {
    roster.replaceChildren();
    for (const participant of participants) {
      const row = document.createElement('div');
      row.textContent = `${participant.name} — ${STATUS_LABEL[participant.status]}${
        participant.disconnected ? ' (연결 끊김)' : ''
      } `;
      if (participant.wakeable && participant.id !== selfId) {
        const button = document.createElement('button');
        button.textContent = '깨우기';
        button.addEventListener('click', () => session.wake(participant.id));
        row.append(button);
      }
      roster.append(row);
    }
  }

  const session: Session = connectSession(SERVER_URL, codeInput.value, nameInput.value || '익명', {
    onParticipants(next, id) {
      participants = next;
      selfId = id;
      renderRoster();
    },
    onWakeRequest(fromName) {
      playAlarm();
      notice = `${fromName}님이 깨웠습니다`;
    },
    onError(code) {
      notice = code;
    },
    onConnectionChange(next) {
      connected = next;
    },
  });

  // --- 측정 루프 ---
  let calibration: Calibration = built.calibration;
  let alertState: AlertState = INITIAL_ALERT_STATE;
  let statusState: SessionStatusState = INITIAL_SESSION_STATUS_STATE;
  const samples: FrameSample[] = [];
  const openEarHistory: Array<{ t: number; ear: number }> = [];
  let lastTick = 0;
  let needsRecalibration = false;

  const onFrame = (now: number): void => {
    const ear = readFrame(now);
    const frameState = classifyFrame(ear, calibration);

    samples.push({ t: now, state: frameState });
    while (samples.length > 0 && (samples[0]?.t ?? now) < now - WINDOW_MS) samples.shift();

    if (frameState === 'open' && ear) {
      openEarHistory.push({ t: now, ear: ear.mean });
      while (openEarHistory.length > 0 && (openEarHistory[0]?.t ?? now) < now - DRIFT_WINDOW_MS) {
        openEarHistory.shift();
      }
    }

    if (now - lastTick >= 1000) {
      lastTick = now;
      const analysis = analyzeWindow(samples, now);
      const alert = updateAlert(alertState, {
        perclos: analysis.value,
        longestClosedMs: analysis.longestClosedMs,
        longestClosedEndedAt: analysis.longestClosedEndedAt,
        saturated: analysis.saturated,
        now,
      });
      alertState = alert.state;

      const rollingP75 = percentile(
        openEarHistory.map((entry) => entry.ear),
        0.75,
      );
      if (rollingP75 !== null) {
        const drifted = updateOpenBaseline(calibration, rollingP75);
        // null이면 보정이 못 믿을 범위로 내려갔다. 값을 깎아 맞추지 않고 재보정을 요구한다.
        if (drifted === null) needsRecalibration = true;
        else calibration = drifted;
      }

      const next = updateSessionStatus(statusState, {
        event: alert.event,
        analysis: needsRecalibration
          ? null
          : {
              value: analysis.value,
              observedMs: analysis.observedMs,
              windowSpanMs: analysis.windowSpanMs,
            },
        now,
      });
      statusState = next.state;
      session.setStatus(next.status);

      const coverage =
        analysis.windowSpanMs === 0
          ? '–'
          : `${((analysis.observedMs / analysis.windowSpanMs) * 100).toFixed(0)}%`;

      render([
        `내 상태: ${STATUS_LABEL[next.status]}${needsRecalibration ? ' (재보정 필요 — 새로고침 후 다시 시작하세요)' : ''}`,
        `서버: ${connected ? '연결됨' : '끊김'}`,
        `PERCLOS: ${analysis.value === null ? '–' : `${(analysis.value * 100).toFixed(1)}%`}`,
        `유효 프레임: ${(analysis.validRatio * 100).toFixed(0)}%`,
        `관측 커버리지: ${coverage}`,
        notice ? `알림: ${notice}` : '',
      ]);
      renderRoster();
    }

    video.requestVideoFrameCallback(() => onFrame(performance.now()));
  };

  video.requestVideoFrameCallback(() => onFrame(performance.now()));
}

startButton.addEventListener('click', () => {
  void main();
});
