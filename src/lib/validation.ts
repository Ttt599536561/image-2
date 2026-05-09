export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  rememberApiKey: boolean;
}

export interface GenerationValidationInput {
  prompt: string;
  quantity: number;
}

export type ValidationResult = { valid: true } | { valid: false; message: string };

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function validateApiConfig(config: ApiConfig): ValidationResult {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = config.apiKey.trim();

  if (!baseUrl) {
    return { valid: false, message: '请先填写请求地址' };
  }

  if (!apiKey) {
    return { valid: false, message: '请先填写 API Key' };
  }

  if (!/^https?:\/\//i.test(baseUrl)) {
    return { valid: false, message: '请求地址必须以 http:// 或 https:// 开头' };
  }

  return { valid: true };
}

export function validateGenerationInput(input: GenerationValidationInput): ValidationResult {
  if (!input.prompt.trim()) {
    return { valid: false, message: '请先填写图片描述' };
  }

  if (input.quantity < 1) {
    return { valid: false, message: '生成数量至少为 1' };
  }

  if (input.quantity > 4) {
    return { valid: false, message: '生成数量最多为 4' };
  }

  return { valid: true };
}
