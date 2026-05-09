import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_API_CONFIG, loadApiConfig, saveApiConfig } from './storage';

describe('api config storage', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns defaults when storage is empty', () => {
    expect(loadApiConfig()).toEqual(DEFAULT_API_CONFIG);
  });

  it('saves and loads API config', () => {
    saveApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' });

    expect(loadApiConfig()).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
    });
  });

  it('falls back to defaults when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(loadApiConfig()).toEqual(DEFAULT_API_CONFIG);
  });

  it('does not crash when saving is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => saveApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' })).not.toThrow();
  });
});
