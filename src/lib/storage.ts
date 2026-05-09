import type { ApiConfig } from './validation';

const STORAGE_KEY = 'ai-image-workshop-api-config';

export const DEFAULT_API_CONFIG: ApiConfig = {
  baseUrl: 'https://api.tangguo.xin/v1',
  apiKey: '',
  rememberApiKey: false,
};

export function loadApiConfig(): ApiConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_API_CONFIG;
    }

    const parsed = JSON.parse(raw) as Partial<ApiConfig>;
    const rememberApiKey = parsed.rememberApiKey === true;

    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_API_CONFIG.baseUrl,
      apiKey: rememberApiKey && typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULT_API_CONFIG.apiKey,
      rememberApiKey,
    };
  } catch {
    return DEFAULT_API_CONFIG;
  }
}

export function saveApiConfig(config: ApiConfig): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        baseUrl: config.baseUrl,
        apiKey: config.rememberApiKey ? config.apiKey : '',
        rememberApiKey: config.rememberApiKey,
      }),
    );
  } catch {
    // Some browser privacy modes disable storage. The app can still run for the current session.
  }
}
