import { X } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type ApiConfig } from '../hooks/useApiConfig';

type ApiConfigModalProps = {
  config: ApiConfig;
  onClose: () => void;
  onSave: (config: ApiConfig) => void;
};

export function ApiConfigModal({ config, onClose, onSave }: ApiConfigModalProps) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [rememberApiKey, setRememberApiKey] = useState(config.rememberApiKey);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ baseUrl, apiKey, rememberApiKey });
  }

  return (
    <div className="modal-backdrop">
      <section
        aria-labelledby="api-config-title"
        aria-modal="true"
        className="api-config-modal"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 id="api-config-title">自定义 API 中转站配置</h2>
            <p>浏览器会把配置保存在本地，并直接向你的中转站发起请求。</p>
          </div>
          <button aria-label="关闭配置" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="quota-callout">
          <span>还没有可用额度？</span>
          <button type="button">前往「智岛 API 官网」注册获取</button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          <label>
            Base URL
            <input
              autoComplete="url"
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              type="url"
              value={baseUrl}
            />
          </label>

          <label>
            API Key
            <input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              type="password"
              value={apiKey}
            />
          </label>

          <label className="remember-key-option">
            <input
              aria-label="在此设备记住密钥"
              checked={rememberApiKey}
              onChange={(event) => setRememberApiKey(event.target.checked)}
              type="checkbox"
            />
            在此设备记住 API Key
          </label>

          <p className="modal-helper">
            默认只在当前页面会话中使用 API Key；勾选后才会写入浏览器本地存储。
          </p>

          <div className="modal-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              取消
            </button>
            <button className="primary-button" type="submit">
              保存配置
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
