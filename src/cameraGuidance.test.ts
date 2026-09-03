import { describe, expect, it } from 'vitest';
import { cameraGuidance, isSecureForCamera } from './cameraGuidance';
import type { CameraError } from './camera';

describe('isSecureForCamera', () => {
  it('https는 어디서든 허용된다', () => {
    expect(isSecureForCamera('https:', 'perclos.example.com')).toBe(true);
  });

  it('localhost는 http여도 허용된다', () => {
    expect(isSecureForCamera('http:', 'localhost')).toBe(true);
    expect(isSecureForCamera('http:', '127.0.0.1')).toBe(true);
  });

  it('LAN IP는 http면 차단된다', () => {
    // 다른 기기에서 볼 때 가장 흔히 걸리는 함정이다.
    // 브라우저가 권한 창조차 띄우지 않아 원인을 찾기 어렵다.
    expect(isSecureForCamera('http:', '192.168.0.12')).toBe(false);
  });

  it('LAN IP도 https면 허용된다', () => {
    expect(isSecureForCamera('https:', '192.168.0.12')).toBe(true);
  });
});

describe('cameraGuidance', () => {
  const ERRORS: CameraError[] = [
    'permission-denied',
    'no-device',
    'device-busy',
    'constraints-unsatisfiable',
    'playback-failed',
    'unknown',
  ];

  it('모든 실패 코드에 안내가 있다', () => {
    for (const error of ERRORS) {
      const guidance = cameraGuidance(error);
      expect(guidance.headline.length).toBeGreaterThan(0);
      expect(guidance.steps.length).toBeGreaterThan(0);
    }
  });

  it('권한 거부에는 되돌리는 방법이 들어 있다', () => {
    // 한 번 거부하면 브라우저가 다시 묻지 않는다. 그 사실을 알려주지 않으면
    // 사용자는 새로고침만 반복하게 된다.
    const guidance = cameraGuidance('permission-denied');
    expect(guidance.steps.join(' ')).toContain('다시 묻지 않습니다');
  });

  it('카메라 점유는 화상통화 앱을 짚어 준다', () => {
    expect(cameraGuidance('device-busy').steps.join(' ')).toContain('Zoom');
  });
});
