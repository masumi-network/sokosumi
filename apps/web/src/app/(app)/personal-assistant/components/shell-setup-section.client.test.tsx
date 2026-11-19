import type { SokoBotSecret } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveSecretMock, setSetupMock } = vi.hoisted(() => ({
  saveSecretMock: vi.fn(),
  setSetupMock: vi.fn(),
}));

vi.mock("@/lib/actions/soko-bot/tools-action", () => ({
  saveSokoBotSecretAction: saveSecretMock,
  deleteSokoBotSecretAction: vi.fn(),
  setSokoBotSandboxSetupAction: setSetupMock,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ShellSetupSection } from "./shell-setup-section.client";

const BOT = "01960001-0001-7001-8001-000000000099";

function secret(name: string, shellAccess = true): SokoBotSecret {
  return {
    id: `id-${name}`,
    name,
    shellAccess,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("ShellSetupSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves setup commands one per line, without blank lines", async () => {
    setSetupMock.mockResolvedValue({
      ok: true,
      value: ["npm install -g vercel", "pip install httpie"],
    });
    render(
      <ShellSetupSection
        botId={BOT}
        initialCommands={[]}
        initialSecrets={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("commandsTitle"), {
      target: { value: "npm install -g vercel\n\n  pip install httpie  \n" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "saveCommands" }));
    });
    expect(setSetupMock).toHaveBeenCalledWith({
      input: {
        botId: BOT,
        commands: ["npm install -g vercel", "pip install httpie"],
      },
    });
  });

  it("adds a key with shell access, shows only its name, and clears the value", async () => {
    saveSecretMock.mockResolvedValue({
      ok: true,
      value: secret("VERCEL_TOKEN"),
    });
    render(
      <ShellSetupSection
        botId={BOT}
        initialCommands={[]}
        initialSecrets={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("keyNameLabel"), {
      target: { value: "vercel_token" },
    });
    fireEvent.change(screen.getByLabelText("keyValueLabel"), {
      target: { value: "tok-123456" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /addKey/ }));
    });
    expect(saveSecretMock).toHaveBeenCalledWith({
      input: {
        botId: BOT,
        name: "VERCEL_TOKEN",
        value: "tok-123456",
        shellAccess: true,
      },
    });
    expect(screen.getByText("VERCEL_TOKEN")).toBeTruthy();
    expect(screen.queryByDisplayValue("tok-123456")).toBeNull();
  });

  it("switches shell access without sending a value", async () => {
    saveSecretMock.mockResolvedValue({
      ok: true,
      value: secret("GH_TOKEN", false),
    });
    render(
      <ShellSetupSection
        botId={BOT}
        initialCommands={[]}
        initialSecrets={[secret("GH_TOKEN")]}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("switch"));
    });
    expect(saveSecretMock).toHaveBeenCalledWith({
      input: { botId: BOT, name: "GH_TOKEN", shellAccess: false },
    });
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false",
    );
  });
});
