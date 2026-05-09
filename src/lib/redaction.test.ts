import { describe, expect, it } from 'vitest';
import { redactSecrets, redactText } from './redaction';

describe('redactText', () => {
  it('redacts exact user-provided secrets', () => {
    expect(redactText('Authorization: Bearer sk-real-secret', ['sk-real-secret'])).toBe(
      'Authorization: Bearer sk-***',
    );
  });

  it('redacts generic bearer tokens', () => {
    expect(redactText('Authorization: Bearer sk-proxy-1234567890', [])).toBe(
      'Authorization: Bearer sk-***',
    );
  });
});

describe('redactSecrets', () => {
  it('redacts nested response values without mutating the original object', () => {
    const raw = {
      error: {
        message: 'relay echoed sk-real-secret',
        headers: ['Authorization: Bearer sk-real-secret'],
      },
    };

    expect(redactSecrets(raw, ['sk-real-secret'])).toEqual({
      error: {
        message: 'relay echoed sk-***',
        headers: ['Authorization: Bearer sk-***'],
      },
    });
    expect(raw.error.message).toBe('relay echoed sk-real-secret');
  });
});
