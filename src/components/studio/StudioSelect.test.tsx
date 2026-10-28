import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StudioSelect } from "./StudioSelect";
function Select() {
  const [value, setValue] = useState("auto");
  return <><button>上一项</button><StudioSelect label="生成质量" value={value} onChange={setValue} options={[{ value: "auto", label: "自动" }, { value: "high", label: "高" }, { value: "low", label: "低" }]} /><button>下一项</button></>;
}
describe("studio select", () => {
  it("supports arrows and Enter with an exposed selected option", () => {
    render(<Select />);
    const trigger = screen.getByRole("combobox", { name: "生成质量" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const list = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(list).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(trigger).toHaveTextContent("高");
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "高" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("lets Tab leave the menu without committing the active option", async () => {
    const user = userEvent.setup(); render(<Select />);
    const trigger = screen.getByRole("combobox", { name: "生成质量" });
    await user.click(trigger); await user.keyboard("{ArrowDown}{Tab}");
    expect(screen.getByRole("button", { name: "下一项" })).toHaveFocus();
    expect(trigger).toHaveTextContent("自动");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("returns Shift+Tab to the previous field and closes on an outside click", async () => {
    const user = userEvent.setup(); render(<Select />);
    const trigger = screen.getByRole("combobox", { name: "生成质量" });
    await user.click(trigger); await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "上一项" })).toHaveFocus();
    await user.click(trigger); await user.click(screen.getByRole("button", { name: "下一项" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一项" })).toHaveFocus();
  });
});
