export interface GenerationValidationInput {
  prompt: string;
  quantity: number;
}

export type ValidationResult = { valid: true } | { valid: false; message: string };

export function validateGenerationInput(input: GenerationValidationInput): ValidationResult {
  if (!input.prompt.trim()) {
    return { valid: false, message: '请先填写图片描述' };
  }

  if (input.quantity < 1) {
    return { valid: false, message: '生成数量至少为 1' };
  }

  if (input.quantity > 1) {
    return { valid: false, message: '生成数量固定为 1' };
  }

  return { valid: true };
}
