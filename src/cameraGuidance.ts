import type { CameraError } from './camera';

export interface Guidance {
  headline: string;
  steps: string[];
}

/**
 * getUserMedia는 보안 컨텍스트에서만 동작한다. localhost는 예외로 허용되지만
 * 다른 기기에서 LAN IP로 접속하면 https가 아닌 한 카메라 요청 자체가 막힌다.
 * 이때 브라우저는 권한 창을 띄우지도 않아서, 원인을 모르면 한참 헤맨다.
 */
export function isSecureForCamera(protocol: string, hostname: string): boolean {
  if (protocol === 'https:') return true;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export const INSECURE_CONTEXT_GUIDANCE: Guidance = {
  headline: '이 주소에서는 브라우저가 카메라를 열어주지 않습니다.',
  steps: [
    'localhost가 아닌 주소는 https가 아니면 카메라 요청이 아예 차단됩니다. 권한 창도 뜨지 않습니다.',
    '같은 기기에서 볼 때는 http://localhost:5173 으로 접속하세요.',
    '다른 기기에서 보려면 https가 필요합니다.',
  ],
};

const DENIED_STEPS = [
  '주소창 왼쪽의 자물쇠(또는 슬라이더) 아이콘을 누릅니다.',
  '"카메라"를 "허용"으로 바꿉니다.',
  '페이지를 새로고침하고 다시 시작을 누릅니다.',
  '한 번 거부하면 브라우저가 다시 묻지 않습니다. 위 순서로 직접 바꿔야 합니다.',
];

export function cameraGuidance(error: CameraError): Guidance {
  switch (error) {
    case 'permission-denied':
      return { headline: '카메라 권한이 거부됐습니다.', steps: DENIED_STEPS };
    case 'no-device':
      return {
        headline: '카메라를 찾을 수 없습니다.',
        steps: [
          '노트북 내장 카메라가 켜져 있는지 확인하세요.',
          '외장 웹캠이라면 연결을 확인하세요.',
          '일부 노트북은 물리 셔터나 F키로 카메라를 끌 수 있습니다.',
        ],
      };
    case 'device-busy':
      return {
        headline: '다른 앱이 카메라를 쓰고 있습니다.',
        steps: [
          '화상통화 앱(Zoom, Teams, Discord 등)을 종료하세요.',
          '이 앱을 띄운 다른 탭이나 창이 있는지 확인하세요.',
          '카메라는 한 번에 한 곳에서만 쓸 수 있습니다.',
        ],
      };
    case 'constraints-unsatisfiable':
      return {
        headline: '이 카메라가 요청한 해상도를 지원하지 않습니다.',
        steps: ['다른 카메라를 연결해 보세요.'],
      };
    case 'playback-failed':
      return {
        headline: '카메라는 열렸지만 영상 재생이 시작되지 않았습니다.',
        steps: [
          '페이지를 새로고침하고 다시 시작을 누르세요.',
          '브라우저의 자동 재생 차단 설정이 원인일 수 있습니다.',
        ],
      };
    case 'unknown':
      return {
        headline: '카메라를 열지 못했습니다.',
        steps: [
          '페이지를 새로고침하고 다시 시도하세요.',
          '브라우저 콘솔에 원인이 남아 있습니다.',
        ],
      };
  }
}
