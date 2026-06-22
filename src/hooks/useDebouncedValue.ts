import { useEffect, useState } from "react";

/** 防抖值（P3-S2 搜索）：value 停止变化 ms 后才更新返回值，减少每键一次网络请求。 */
export function useDebouncedValue<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
