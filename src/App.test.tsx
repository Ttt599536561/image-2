import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type GenerateImageFn } from './App';

const validConfig = {
  baseUrl: 'https://relay.example.com/v1',
  apiKey: 'sk-real-secret',
};

const runtimeConfig = {
  ...validConfig,
  rememberApiKey: false,
};

function renderApp(generateImage?: GenerateImageFn) {
  return render(<App generateImage={generateImage ?? vi.fn()} />);
}

async function saveApiConfig(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: /中转站 API 配置/ }));
  await user.clear(screen.getByLabelText(/Base URL/i));
  await user.type(screen.getByLabelText(/Base URL/i), validConfig.baseUrl);
  await user.type(screen.getByLabelText('API Key'), validConfig.apiKey);
  await user.click(screen.getByRole('button', { name: '保存配置' }));
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the API config modal and saves entered config', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /中转站 API 配置/ }));

    expect(screen.getByRole('dialog', { name: '自定义 API 中转站配置' })).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: '前往「智岛 API 官网」注册获取' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Base URL/i));
    await user.type(screen.getByLabelText(/Base URL/i), validConfig.baseUrl);
    await user.type(screen.getByLabelText('API Key'), validConfig.apiKey);
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '自定义 API 中转站配置' })).not.toBeInTheDocument();
    });
    expect(JSON.parse(localStorage.getItem('ai-image-workshop-api-config') ?? '{}')).toEqual({
      baseUrl: validConfig.baseUrl,
      apiKey: '',
      rememberApiKey: false,
    });
  });

  it('persists the API key only when the user chooses to remember it', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /中转站 API 配置/ }));
    await user.clear(screen.getByLabelText(/Base URL/i));
    await user.type(screen.getByLabelText(/Base URL/i), validConfig.baseUrl);
    await user.type(screen.getByLabelText('API Key'), validConfig.apiKey);
    await user.click(screen.getByLabelText('在此设备记住密钥'));
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    expect(JSON.parse(localStorage.getItem('ai-image-workshop-api-config') ?? '{}')).toEqual({
      baseUrl: validConfig.baseUrl,
      apiKey: validConfig.apiKey,
      rememberApiKey: true,
    });
  });

  it('closes the API config modal with Escape', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /中转站 API 配置/ }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '自定义 API 中转站配置' })).not.toBeInTheDocument();
    });
  });

  it('renders an actionable error when prompt is missing', async () => {
    const user = userEvent.setup();
    renderApp();
    await saveApiConfig(user);

    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('请先填写图片描述')).toBeInTheDocument();
  });

  it('renders an actionable error when API key is missing', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByLabelText('图片描述'), 'A neon city at dusk');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('请先填写 API Key')).toBeInTheDocument();
  });

  it('renders generated images from a mocked generation adapter', async () => {
    const user = userEvent.setup();
    const generateImage = vi.fn<GenerateImageFn>().mockResolvedValue({
      images: [{ src: 'https://relay.example.com/generated.png', kind: 'url' }],
      rawResponse: { data: [{ url: 'https://relay.example.com/generated.png' }] },
    });
    renderApp(generateImage);
    await saveApiConfig(user);

    await user.type(screen.getByLabelText('图片描述'), 'A glass mountain under sunrise');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByRole('img', { name: 'Generated image 1' })).toHaveAttribute(
      'src',
      'https://relay.example.com/generated.png',
    );
    expect(screen.getByRole('link', { name: '下载图片 1' })).toHaveAttribute(
      'href',
      'https://relay.example.com/generated.png',
    );
    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        config: runtimeConfig,
        request: expect.objectContaining({
          prompt: 'A glass mountain under sunrise',
          model: 'gpt-image-2',
        }),
      }),
    );
  });

  it('renders generation failures from a mocked generation adapter', async () => {
    const user = userEvent.setup();
    const generateImage = vi
      .fn<GenerateImageFn>()
      .mockRejectedValue(new Error('Relay rejected Authorization: Bearer sk-real-secret'));
    renderApp(generateImage);
    await saveApiConfig(user);

    await user.type(screen.getByLabelText('图片描述'), 'A quiet library in space');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('Relay rejected Authorization: Bearer sk-***')).toBeInTheDocument();
    expect(screen.queryByText(validConfig.apiKey)).not.toBeInTheDocument();
  });

  it('redacts secrets in raw JSON responses before rendering them', async () => {
    const user = userEvent.setup();
    const generateImage = vi.fn<GenerateImageFn>().mockResolvedValue({
      images: [{ src: 'https://relay.example.com/generated.png', kind: 'url' }],
      rawResponse: { echoed: 'Authorization: Bearer sk-real-secret' },
    });
    renderApp(generateImage);
    await saveApiConfig(user);

    await user.type(screen.getByLabelText('图片描述'), 'A glass mountain under sunrise');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('"echoed": "Authorization: Bearer sk-***"', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(validConfig.apiKey)).not.toBeInTheDocument();
  });

  it('redacts the API key in the CURL preview', async () => {
    const user = userEvent.setup();
    renderApp();
    await saveApiConfig(user);

    await user.type(screen.getByLabelText('图片描述'), 'A small studio with warm lights');

    const preview = screen.getByTestId('curl-preview');
    expect(preview).toHaveTextContent('Authorization: Bearer sk-***');
    expect(preview).not.toHaveTextContent(validConfig.apiKey);
    expect(preview).toHaveTextContent('https://relay.example.com/v1/images/generations');
  });

  it('renders the return-format compatibility control', () => {
    renderApp();

    expect(screen.getByLabelText('返回格式')).toBeInTheDocument();
    expect(screen.getByLabelText('返回格式')).toBeDisabled();
  });
});
