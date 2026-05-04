import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    // Reset internal store by using unique keys per test
  });

  it('allows requests under the limit', () => {
    const key = 'test:allow';
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, 5, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5 - 1 - i);
    }
  });

  it('blocks requests over the limit', () => {
    const key = 'test:block';
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60_000);
    }
    const result = checkRateLimit(key, 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    const key = 'test:reset';
    checkRateLimit(key, 1, 10);
    const blocked = checkRateLimit(key, 1, 10);
    expect(blocked.allowed).toBe(false);

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const reset = checkRateLimit(key, 1, 10);
        expect(reset.allowed).toBe(true);
        resolve();
      }, 20);
    });
  });

  it('isolates different identifiers', () => {
    checkRateLimit('user:A', 1, 60_000);
    const result = checkRateLimit('user:B', 1, 60_000);
    expect(result.allowed).toBe(true);
  });
});
