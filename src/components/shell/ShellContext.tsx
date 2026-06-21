import { createContext, useContext } from "react";

// 让各路由内的 TopBar 汉堡按钮能打开 _app 持有的侧栏抽屉。
export const ShellContext = createContext<{ openMenu: () => void }>({
  openMenu: () => {},
});

export const useShell = () => useContext(ShellContext);
