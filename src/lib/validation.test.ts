import { describe, expect, it } from 'vitest';
import {
  normalizeBaseUrl,
  validateApiConfig,
  validateGenerationInput,
} from './validation';

describe('validateApiConfig', () => {
  it('rejects an empty API key', () => {
    expect(validateApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: '' })).toEqual({
      valid: false,
      message: '请先填写 API Key',
    });
  });

  it('rejects an empty Base URL', () => {
    expect(validateApiConfig({ baseUrl: '', apiKey: 'sk-test' })).toEqual({
      valid: false,
      message: '请先填写请求地址',
    });
  });

  it('rejects a non-http Base URL', () => {
    expect(validateApiConfig({ baseUrl: 'ftp://api.example.com/v1', apiKey: 'sk-test' })).toEqual({
      valid: false,
      message: '请求地址必须以 http:// 或 https:// 开头',
    });
  });

  it('accepts a valid HTTPS Base URL and key', () => {
    expect(validateApiConfig({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test' })).toEqual({
      valid: true,
    });
  });
});

describe('normalizeBaseUrl', () => {
  it('removes trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1');
  });

  it('trims whitespace', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1/  ')).toBe('https://api.example.com/v1');
  });
});

describe('validateGenerationInput', () => {
  it('rejects empty prompts', () => {
    expect(validateGenerationInput({ prompt: '', quantity: 1 })).toEqual({
      valid: false,
      message: '请先填写图片描述',
    });
  });

  it('rejects whitespace-only prompts', () => {
    expect(validateGenerationInput({ prompt: '    ', quantity: 1 })).toEqual({
      valid: false,
      message: '请先填写图片描述',
    });
  });

  it('rejects quantities below 1', () => {
    expect(validateGenerationInput({ prompt: 'a cat', quantity: 0 })).toEqual({
      valid: false,
      message: '生成数量至少为 1',
    });
  });

  it('rejects quantities above 4', () => {
    expect(validateGenerationInput({ prompt: 'a cat', quantity: 5 })).toEqual({
      valid: false,
      message: '生成数量最多为 4',
    });
  });

  it('accepts visible prompt text and valid quantity', () => {
    expect(validateGenerationInput({ prompt: 'a cat', quantity: 2 })).toEqual({ valid: true });
  });
});
