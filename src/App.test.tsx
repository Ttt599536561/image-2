import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { type GenerateImageFn } from './App';

const REAL_SECRET = 'sk-real-secret';

function renderApp(generateImage?: GenerateImageFn) {
  return render(<App generateImage={generateImage ?? vi.fn()} />);
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render any API key / relay config UI (keys live only in server env)', () => {
    renderApp();

    expect(screen.queryByRole('button', { name: /中转站 API 配置/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '自定义 API 中转站配置' })).not.toBeInTheDocument();
  });

  it('renders an actionable error when prompt is missing', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('请先填写图片描述')).toBeInTheDocument();
  });

  it('renders generated images from a mocked generation adapter without requiring a key', async () => {
    const user = userEvent.setup();
    const generateImage = vi.fn<GenerateImageFn>().mockResolvedValue({
      images: [{ src: 'https://relay.example.com/generated.png', kind: 'url' }],
      rawResponse: { data: [{ url: 'https://relay.example.com/generated.png' }] },
    });
    renderApp(generateImage);

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
        request: expect.objectContaining({
          prompt: 'A glass mountain under sunrise',
          model: 'gpt-image-1-mini',
        }),
      }),
    );
    // 不再传 config / 任何 Key 给生成适配器。
    expect(generateImage).not.toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.anything() }),
    );
  });

  it('keeps the selected model as the default after a successful generation', async () => {
    const user = userEvent.setup();
    const generateImage = vi.fn<GenerateImageFn>().mockResolvedValue({
      images: [{ src: 'https://relay.example.com/generated.png', kind: 'url' }],
      rawResponse: { data: [{ url: 'https://relay.example.com/generated.png' }] },
    });
    const { unmount } = renderApp(generateImage);

    await user.selectOptions(screen.getByLabelText('模型'), 'gpt-image-2');
    await user.type(screen.getByLabelText('图片描述'), 'A glass mountain under sunrise');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByRole('img', { name: 'Generated image 1' })).toBeInTheDocument();
    expect(screen.getByLabelText('模型')).toHaveValue('gpt-image-2');

    unmount();
    renderApp(generateImage);

    expect(screen.getByLabelText('模型')).toHaveValue('gpt-image-2');
  });

  it('redacts secrets in mocked failure messages before rendering them', async () => {
    const user = userEvent.setup();
    const generateImage = vi
      .fn<GenerateImageFn>()
      .mockRejectedValue(new Error(`Relay rejected Authorization: Bearer ${REAL_SECRET}`));
    renderApp(generateImage);

    await user.type(screen.getByLabelText('图片描述'), 'A quiet library in space');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('Relay rejected Authorization: Bearer sk-***')).toBeInTheDocument();
    expect(screen.queryByText(REAL_SECRET)).not.toBeInTheDocument();
  });

  it('redacts secrets in raw JSON responses before rendering them', async () => {
    const user = userEvent.setup();
    const generateImage = vi.fn<GenerateImageFn>().mockResolvedValue({
      images: [{ src: 'https://relay.example.com/generated.png', kind: 'url' }],
      rawResponse: { echoed: `Authorization: Bearer ${REAL_SECRET}` },
    });
    renderApp(generateImage);

    await user.type(screen.getByLabelText('图片描述'), 'A glass mountain under sunrise');
    await user.click(screen.getByRole('button', { name: '开始创作' }));

    expect(await screen.findByText('"echoed": "Authorization: Bearer sk-***"', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(REAL_SECRET)).not.toBeInTheDocument();
  });

  it('hides the CURL preview from the result panel', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByLabelText('图片描述'), 'A small studio with warm lights');

    expect(screen.queryByTestId('curl-preview')).not.toBeInTheDocument();
    expect(screen.queryByText('CURL 预览')).not.toBeInTheDocument();
  });

  it('hides quantity and return-format controls while rendering friendly size and moderation controls', () => {
    renderApp();

    expect(screen.queryByLabelText('数量')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('返回格式')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    const autoSizeRadio = screen.getByRole('radio', { name: /智能/ });
    expect(autoSizeRadio).toBeChecked();
    expect(autoSizeRadio).toHaveAttribute('value', 'auto');
    expect(screen.getByRole('radio', { name: /1:1 方形/ })).toHaveAttribute('value', '1024x1024');
    expect(screen.getByRole('radio', { name: /2:3 竖图/ })).toHaveAttribute('value', '1024x1536');
    expect(screen.getByRole('radio', { name: /3:2 横图/ })).toHaveAttribute('value', '1536x1024');
    expect(screen.getByRole('radio', { name: /9:16 竖屏/ })).toHaveAttribute('value', '1088x1920');
    expect(screen.getByRole('radio', { name: /16:9 横屏/ })).toHaveAttribute('value', '1920x1088');
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
