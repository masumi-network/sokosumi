import type { SokoBotMcpServer } from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { addMock, updateToolMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  updateToolMock: vi.fn(),
}));

vi.mock("@/lib/actions/soko-bot/tools-action", () => ({
  addSokoBotMcpServerAction: addMock,
  refreshSokoBotMcpServerAction: vi.fn(),
  removeSokoBotMcpServerAction: vi.fn(),
  updateSokoBotMcpToolAction: updateToolMock,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { McpServersSection } from "./mcp-servers-section.client";

const BOT = "01960001-0001-7001-8001-000000000099";

function server(overrides: Partial<SokoBotMcpServer> = {}): SokoBotMcpServer {
  return {
    id: "01960001-0001-7001-8001-0000000000aa",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    authKind: "header",
    tools: [
      {
        name: "search_issues",
        description: "Find issues",
        inputSchema: {},
        readOnly: true,
        enabled: true,
      },
      {
        name: "create_issue",
        description: "Open an issue",
        inputSchema: {},
        readOnly: false,
        enabled: false,
      },
    ],
    toolsRefreshedAt: new Date(0),
    lastError: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

describe("McpServersSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a server's tools with their switch once opened", async () => {
    render(<McpServersSection botId={BOT} initialServers={[server()]} />);
    expect(screen.getByText("Linear")).toBeTruthy();
    expect(screen.queryByText("search_issues")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Linear/ }));
    expect(screen.getByText("search_issues")).toBeTruthy();
    const switches = screen.getAllByRole("switch");
    expect(switches.map((entry) => entry.getAttribute("aria-checked"))).toEqual(
      ["true", "false"],
    );
  });

  it("switches a tool on through Core and shows Core's answer", async () => {
    const on = server();
    on.tools[1] = { ...on.tools[1], enabled: true };
    updateToolMock.mockResolvedValue({ ok: true, value: on });
    render(<McpServersSection botId={BOT} initialServers={[server()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Linear/ }));

    await act(async () => {
      fireEvent.click(screen.getAllByRole("switch")[1]);
    });

    expect(updateToolMock).toHaveBeenCalledWith({
      input: {
        botId: BOT,
        serverId: on.id,
        name: "create_issue",
        enabled: true,
      },
    });
    expect(screen.getAllByRole("switch")[1]?.getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("adds a server with an API key and never keeps the key on screen", async () => {
    addMock.mockResolvedValue({ ok: true, value: server({ name: "Tracker" }) });
    render(<McpServersSection botId={BOT} initialServers={[]} />);

    fireEvent.change(screen.getByLabelText("nameLabel"), {
      target: { value: "Tracker" },
    });
    fireEvent.change(screen.getByLabelText("urlLabel"), {
      target: { value: "https://mcp.example.com/mcp" },
    });
    fireEvent.change(screen.getByLabelText("keyLabel"), {
      target: { value: "secret-key-123" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    expect(addMock).toHaveBeenCalledWith({
      input: {
        botId: BOT,
        name: "Tracker",
        url: "https://mcp.example.com/mcp",
        auth: { type: "bearer", token: "secret-key-123" },
      },
    });
    expect(screen.getByText("Tracker")).toBeTruthy();
    expect(screen.queryByDisplayValue("secret-key-123")).toBeNull();
  });
});
