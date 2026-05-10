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
    saveApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', rememberApiKey: true });

    expect(loadApiConfig()).toEqual({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      apiKey: 'sk-test',
      rememberApiKey: true,
    });
  });

  it('does not persist the API key unless remembering is enabled', () => {
    saveApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', rememberApiKey: false });

    expect(loadApiConfig()).toEqual({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      apiKey: '',
      rememberApiKey: false,
    });
  });

  it('ignores stored custom Base URLs and always uses the fixed relay', () => {
    window.localStorage.setItem(
      'ai-image-workshop-api-config',
      JSON.stringify({
        baseUrl: 'https://other-relay.example.com/v1',
        apiKey: 'sk-test',
        rememberApiKey: true,
      }),
    );

    expect(loadApiConfig()).toEqual({
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      apiKey: 'sk-test',
      rememberApiKey: true,
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

    expect(() =>
      saveApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', rememberApiKey: false }),
    ).not.toThrow();
  });
});
