import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config.ts';

describe('parseConfig', () => {
  it('accepts a valid VITE_API_BASE_URL', () => {
    expect(parseConfig({ VITE_API_BASE_URL: '/api/v1' })).toEqual({
      apiBaseUrl: '/api/v1',
    });
    expect(
      parseConfig({ VITE_API_BASE_URL: 'https://bearlake-server-production.up.railway.app/api/v1' }),
    ).toEqual({ apiBaseUrl: 'https://bearlake-server-production.up.railway.app/api/v1' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseConfig({ VITE_API_BASE_URL: '  /api/v1  ' })).toEqual({
      apiBaseUrl: '/api/v1',
    });
  });

  it('throws when VITE_API_BASE_URL is missing', () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
  });

  it('throws when VITE_API_BASE_URL is blank', () => {
    expect(() => parseConfig({ VITE_API_BASE_URL: '' })).toThrow(ConfigError);
    expect(() => parseConfig({ VITE_API_BASE_URL: '   ' })).toThrow(ConfigError);
  });

  it('names the missing variable in the error message', () => {
    try {
      parseConfig({});
      expect.unreachable('parseConfig should have thrown');
    } catch (err) {
      expect((err as ConfigError).message).toContain('VITE_API_BASE_URL');
    }
  });
});
