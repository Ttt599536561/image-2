import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type GenerateImageFn } from './App';

const validConfig = {
  baseUrl: 'https://api.tangguo.xin/v1',
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
    expect(screen.queryByLabelText(/Base URL/i)).not.toBeInTheDocument();
    expect(screen.getByText('https://api.tangguo.xin/v1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往One-API官网注册获取' })).toHaveAttribute(
      'href',
      'https://api.tangguo.xin/',
    );

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
          model: 'gpt-image-1-mini',
        }),
      }),
    );
  });

  it('keeps the selected model as the default after a successful generation', async () => {
    const user = userEvent.setup();
    const generateImage = vi.fn<GenerateImageFn>().mockResolvedValue({
      images: [{ src: 'https://relay.example.com/generated.png', kind: 'url' }],
      rawResponse: { data: [{ url: 'https://relay.example.com/generated.png' }] },
    });
    const { unmount } = renderApp(generateImage);
    await saveApiConfig(user);

    await user.selectOptions(screen.getByLabelText('模型'), 'gpt-image-2');
    await user.type(screen.getByLabelText('图片描述'), 'A glass mountain under sunrise');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByRole('img', { name: 'Generated image 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('模型')).toHaveValue('gpt-image-2');

    unmount();
    renderApp(generateImage);

    expect(screen.getByLabelText('模型')).toHaveValue('gpt-image-2');
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

  it('hides the CURL preview from the result panel', async () => {
    const user = userEvent.setup();
    renderApp();
    await saveApiConfig(user);

    await user.type(screen.getByLabelText('图片描述'), 'A small studio with warm lights');

    expect(screen.queryByTestId('curl-preview')).not.toBeInTheDocument();
    expect(screen.queryByText('CURL 预览')).not.toBeInTheDocument();
  });

  it('hides quantity and return-format controls while rendering friendly size and moderation controls', () => {
    renderApp();

    expect(screen.queryByLabelText('数量')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('返回格式')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '1:1 正方形' })).toHaveValue('1024x1024');
    expect(screen.getByRole('option', { name: '3:2 横图' })).toHaveValue('1536x1024');
    expect(screen.getByRole('option', { name: '2:3 竖图' })).toHaveValue('1024x1536');
    expect(screen.getByRole('option', { name: '自动审核' })).toHaveValue('auto');
    expect(screen.getByRole('option', { name: '宽松审核' })).toHaveValue('low');
    expect(screen.getByText('宽松审核会降低过滤强度，适合普通创作失败时再尝试。')).toBeInTheDocument();
  });

  it('shows a development toast when the image-to-image tab is clicked', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('tab', { name: '图生图' }));

    expect(await screen.findByRole('status')).toHaveTextContent('图生图功能正在开发中');
  });
});
