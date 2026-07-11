import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserApiConfig, persistUserApiConfig } from "../../lib/userApiConfig";
import { ApiKeyModal } from "./ApiKeyModal";

describe("ApiKeyModal", () => {
  beforeEach(() => localStorage.clear());

  it("saves custom, retains its key in system mode, and clears explicitly", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const first = render(<ApiKeyModal userId="user-a" customEnabled onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "系统 Key" })).toBeChecked());
    await user.click(screen.getByRole("radio", { name: "自定义 Key" }));
    await user.type(screen.getByLabelText("自定义 Key 内容"), "  fictional-local-value  ");
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "custom", apiKey: "fictional-local-value" });
    expect(onClose).toHaveBeenCalledOnce();

    first.unmount();
    render(<ApiKeyModal userId="user-a" customEnabled onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "自定义 Key" })).toBeChecked());
    await user.click(screen.getByRole("radio", { name: "系统 Key" }));
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", apiKey: "fictional-local-value" });
    await user.click(screen.getByRole("button", { name: "清除自定义 Key" }));
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "system", apiKey: "" });
  });

  it("shows the fixed read-only URL and validates blank custom input locally", async () => {
    const user = userEvent.setup();
    render(<ApiKeyModal userId="user-a" customEnabled onClose={vi.fn()} />);
    await user.click(await screen.findByRole("radio", { name: "自定义 Key" }));
    expect(screen.getByDisplayValue("https://api.tangguo.xin/v1")).toHaveAttribute("readOnly");
    expect(screen.getByText(/第三方可能按服务商规则计费/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存并使用" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入自定义 Key");
  });

  it("keeps a saved custom key when custom mode is paused", async () => {
    persistUserApiConfig("user-a", { mode: "custom", apiKey: "fictional-paused-value" });
    render(<ApiKeyModal userId="user-a" customEnabled={false} onClose={vi.fn()} />);
    expect(await screen.findByText("自定义 Key 暂停使用，可切换系统 Key")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "自定义 Key" })).toBeDisabled();
    expect(loadUserApiConfig("user-a")).toEqual({ mode: "custom", apiKey: "fictional-paused-value" });
  });

  it("traps focus, closes with Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(<ApiKeyModal userId="user-a" customEnabled onClose={onClose} />);
    const close = await screen.findByRole("button", { name: "关闭" });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(document.activeElement).not.toBe(document.body);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
