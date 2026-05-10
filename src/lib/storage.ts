import type { ApiConfig } from './validation';

const STORAGE_KEY = 'ai-image-workshop-api-config';
const SELECTED_MODEL_STORAGE_KEY = 'ai-image-workshop-selected-model';

export const IMAGE_MODEL_OPTIONS = ['gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-2'] as const;
export const DEFAULT_IMAGE_MODEL = IMAGE_MODEL_OPTIONS[0];

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
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
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
        baseUrl: DEFAULT_API_CONFIG.baseUrl,
        apiKey: config.rememberApiKey ? config.apiKey : '',
        rememberApiKey: config.rememberApiKey,
      }),
    );
  } catch {
    // Some browser privacy modes disable storage. The app can still run for the current session.
  }
}

export function loadSelectedImageModel(): string {
  try {
    const model = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
    return isSupportedImageModel(model) ? model : DEFAULT_IMAGE_MODEL;
  } catch {
    return DEFAULT_IMAGE_MODEL;
  }
}

export function saveSelectedImageModel(model: string): void {
  try {
    if (isSupportedImageModel(model)) {
      window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, model);
    }
  } catch {
    // Some browser privacy modes disable storage. The current selection still works in memory.
  }
}

function isSupportedImageModel(model: unknown): model is (typeof IMAGE_MODEL_OPTIONS)[number] {
  return typeof model === 'string' && IMAGE_MODEL_OPTIONS.includes(model as (typeof IMAGE_MODEL_OPTIONS)[number]);
}
