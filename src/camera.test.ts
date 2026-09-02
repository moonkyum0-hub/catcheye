import { describe, expect, it } from 'vitest';
import { classifyAcquireError, errorName } from './camera';

// camera.ts는 최상위에서 DOM을 건드리지 않는다(navigator/document 접근은 전부
// startCamera 안에서 일어난다) — 그래서 순수 함수인 errorName/classifyAcquireError는
// Node에서 안전하게 import해서 검증할 수 있다.
describe('errorName', () => {
  it('DOMException의 name을 읽는다', () => {
    expect(errorName(new DOMException('', 'NotAllowedError'))).toBe('NotAllowedError');
  });

  it('name 속성만 가진 평범한 객체도 처리한다', () => {
    // 레거시 엔진은 OverconstrainedError를 DOMException이 아닌 평범한 객체로 던진다.
    // errorName이 DOMException으로 좁히지 않는 이유가 바로 이것이다.
    expect(errorName({ name: 'NotReadableError' })).toBe('NotReadableError');
  });

  it('name이 없으면 빈 문자열이다', () => {
    expect(errorName({})).toBe('');
  });

  it('name이 문자열이 아니면 빈 문자열이다', () => {
    expect(errorName({ name: 42 })).toBe('');
  });

  it('null이면 빈 문자열이다', () => {
    expect(errorName(null)).toBe('');
  });

  it('undefined면 빈 문자열이다', () => {
    expect(errorName(undefined)).toBe('');
  });

  it('문자열이면 빈 문자열이다', () => {
    expect(errorName('NotAllowedError')).toBe('');
  });
});

describe('classifyAcquireError', () => {
  it('NotAllowedError는 permission-denied다', () => {
    expect(classifyAcquireError(new DOMException('', 'NotAllowedError'))).toBe(
      'permission-denied',
    );
  });

  it('SecurityError는 permission-denied다', () => {
    expect(classifyAcquireError({ name: 'SecurityError' })).toBe('permission-denied');
  });

  it('NotFoundError는 no-device다', () => {
    expect(classifyAcquireError({ name: 'NotFoundError' })).toBe('no-device');
  });

  it('DevicesNotFoundError는 no-device다', () => {
    expect(classifyAcquireError({ name: 'DevicesNotFoundError' })).toBe('no-device');
  });

  it('레거시 별칭이 평범한 객체로 던져져도 device-busy로 분류한다', () => {
    // OverconstrainedError/TrackStartError 계열은 DOMException이 아닌 형태로도
    // 던져질 수 있다는 것이 이번 변경의 요점이다.
    expect(classifyAcquireError({ name: 'NotReadableError' })).toBe('device-busy');
    expect(classifyAcquireError({ name: 'TrackStartError' })).toBe('device-busy');
  });

  it('OverconstrainedError는 constraints-unsatisfiable이다', () => {
    expect(classifyAcquireError({ name: 'OverconstrainedError' })).toBe(
      'constraints-unsatisfiable',
    );
  });

  it('ConstraintNotSatisfiedError는 constraints-unsatisfiable이다', () => {
    expect(classifyAcquireError({ name: 'ConstraintNotSatisfiedError' })).toBe(
      'constraints-unsatisfiable',
    );
  });

  it('알 수 없는 name은 unknown이다', () => {
    expect(classifyAcquireError({ name: 'SomethingElse' })).toBe('unknown');
  });

  it('name이 없거나 객체가 아니면 unknown이다', () => {
    expect(classifyAcquireError(null)).toBe('unknown');
    expect(classifyAcquireError(undefined)).toBe('unknown');
    expect(classifyAcquireError('NotAllowedError')).toBe('unknown');
    expect(classifyAcquireError({})).toBe('unknown');
  });
});
