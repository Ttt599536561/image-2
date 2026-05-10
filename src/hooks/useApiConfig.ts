import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_API_CONFIG, loadApiConfig, saveApiConfig } from '../lib/storage';
import { normalizeBaseUrl, type ApiConfig } from '../lib/validation';

export type { ApiConfig };

export function useApiConfig() {
  const [config, setConfigState] = useState<ApiConfig>(DEFAULT_API_CONFIG);

  useEffect(() => {
    setConfigState(loadApiConfig());
  }, []);

  const saveConfig = useCallback((nextConfig: ApiConfig) => {
    const trimmedConfig = {
      baseUrl: DEFAULT_API_CONFIG.baseUrl,
      apiKey: nextConfig.apiKey.trim(),
      rememberApiKey: nextConfig.rememberApiKey,
    };

    setConfigState(trimmedConfig);
    saveApiConfig(trimmedConfig);
  }, []);

  return { config, saveConfig };
}
