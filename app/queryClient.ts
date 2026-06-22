// QueryClient 工厂 + 浏览器单例。
// 单例的意义：clientLoader（在 React 树之外运行）与组件树共享「同一个缓存」——
// 这样"乐观写缓存 → 立即导航 → clientLoader 命中缓存即时渲染"才成立。
// SSR：每次渲染各自新建（绝不跨请求共享，防数据串号）。
import { QueryClient } from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** 浏览器：惰性建一次、全局单例；SSR：每次新建。 */
export function getQueryClient(): QueryClient {
  if (typeof document === "undefined") return makeQueryClient(); // SSR
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
