const SELECTED_MODEL_STORAGE_KEY = 'ai-image-workshop-selected-model';

export const IMAGE_MODEL_OPTIONS = ['gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-2'] as const;
export const DEFAULT_IMAGE_MODEL = IMAGE_MODEL_OPTIONS[0];

// 仅作中转 base URL 的服务端回退默认值（process.env.RELAY_BASE_URL 缺省时用）。
// 不再承载任何 apiKey —— Key 一律由服务端 env 注入，前端/localStorage 不碰（密钥红线）。
export const DEFAULT_API_CONFIG = {
  baseUrl: 'https://api.tangguo.xin/v1',
} as const;

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
