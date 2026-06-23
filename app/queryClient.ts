// QueryClient 工厂 + 浏览器单例。
// 单例的意义：clientLoader（在 React 树之外运行）与组件树共享「同一个缓存」——
// 这样"乐观写缓存 → 立即导航 → clientLoader 命中缓存即时渲染"才成立。
// SSR：每次渲染各自新建（绝不跨请求共享，防数据串号）。
import { QueryClient } from "@tanstack/react-query";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 已加载的数据在本地缓存更久 → 切换页面/重新点开**不再重复跨境拉取**，命中缓存即时渲染。
        // 安全：数据变更一律由对应 mutation 的 invalidateQueries 主动刷新（删/改/存/兑换/生成成功都 invalidate），
        // 故拉长 staleTime 只压掉"被动重拉"（导航/重挂载/聚焦），不会让改动看不到。
        staleTime: 5 * 60_000, // 5min 内视为新鲜：导航/组件重挂载不触发后台重拉
        gcTime: 60 * 60_000, // 1h 不回收：离开页面再回来仍命中缓存
        refetchOnWindowFocus: false,
        retry: 1,
      },
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
