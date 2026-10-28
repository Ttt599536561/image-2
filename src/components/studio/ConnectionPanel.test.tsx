import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionPanel } from "./ConnectionPanel";
import { CONNECTION_STORAGE_KEY, DEFAULT_CONNECTION, saveConnection } from "../../lib/studio/connection";

function Settings() {
  const [connection, setConnection] = useState({ ...DEFAULT_CONNECTION });
  return <ConnectionPanel connection={connection} onChange={(next) => { setConnection(next); saveConnection(next, localStorage); }} onBack={() => {}} />;
}
describe("connection settings", () => {
  beforeEach(() => localStorage.clear());
  it("requires an explicit remember choice and clears the key independently of history", () => {
    localStorage.setItem("unrelated-history-fixture", "keep");
    render(<Settings />);
    const key = screen.getByLabelText("API Key");
    expect(key).toHaveAttribute("type", "password");
    fireEvent.change(key, { target: { value: "fixture-secret" } });
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).not.toContain("fixture-secret");
    fireEvent.click(screen.getByLabelText(/在此浏览器记住 API Key/));
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).toContain("fixture-secret");
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(key).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "清除 API Key" }));
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("type", "password");
    expect(localStorage.getItem(CONNECTION_STORAGE_KEY)).not.toContain("fixture-secret");
    expect(localStorage.getItem("unrelated-history-fixture")).toBe("keep");
  });
});
