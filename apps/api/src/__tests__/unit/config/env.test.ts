import { describe, it, expect } from 'vitest';
import { parseTrustProxy } from '../../../config/env';

describe('parseTrustProxy', () => {
  it('defaults to a single hop when unset or blank', () => {
    expect(parseTrustProxy(undefined)).toBe(1);
    expect(parseTrustProxy('   ')).toBe(1);
  });

  it('parses a hop count', () => {
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('parses the booleans', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('treats anything else as an allow-list of proxy addresses', () => {
    expect(parseTrustProxy('10.0.0.1, 10.0.0.2')).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  // A negative or fractional value is not a hop count; falling through to the
  // allow-list branch is safer than silently trusting an unexpected shape.
  it('does not accept a negative hop count as a number', () => {
    expect(parseTrustProxy('-1')).toEqual(['-1']);
  });
});
