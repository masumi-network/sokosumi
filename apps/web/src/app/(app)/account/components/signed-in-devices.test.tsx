import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";

import { SignedInDevices } from "./signed-in-devices";

const mockListSessions = vi.fn();
const mockRevokeSession = vi.fn();
const mockRevokeOtherSessions = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const formatter = createTestFormatter();
  return {
    useFormatter: () => formatter,
    useTranslations: () => (key: string, values?: Record<string, string>) =>
      values ? `${key}(${Object.values(values).join(",")})` : key,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    listSessions: () => mockListSessions(),
    revokeSession: (input: unknown) => mockRevokeSession(input),
    revokeOtherSessions: () => mockRevokeOtherSessions(),
  },
}));

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

let sessions: Array<{
  id: string;
  token: string;
  userAgent: string | null;
  createdAt: string;
}>;

function renderDevices() {
  return render(<SignedInDevices currentSessionId="current" />, {
    wrapper: TestQueryProvider,
  });
}

describe("SignedInDevices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions = [
      {
        id: "other",
        token: "other-token",
        userAgent: WINDOWS_EDGE,
        createdAt: "2026-11-20T09:00:00.000Z",
      },
      {
        id: "current",
        token: "current-token",
        userAgent: MAC_SAFARI,
        createdAt: "2026-11-01T09:00:00.000Z",
      },
    ];
    mockListSessions.mockImplementation(async () => ({
      data: sessions,
      error: null,
    }));
    mockRevokeSession.mockImplementation(async ({ token }) => {
      sessions = sessions.filter((session) => session.token !== token);
      return { data: { status: true }, error: null };
    });
    mockRevokeOtherSessions.mockImplementation(async () => {
      sessions = sessions.filter((session) => session.id === "current");
      return { data: { status: true }, error: null };
    });
  });

  it("lists this device first, without a sign-out button", async () => {
    renderDevices();

    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("deviceLabel(Safari,macOS)");
    expect(rows[0]).toHaveTextContent("thisDevice");
    expect(within(rows[0]).queryByRole("button")).toBeNull();
    expect(rows[1]).toHaveTextContent("deviceLabel(Edge,Windows)");
  });

  it("signs out one other device and drops it from the list", async () => {
    const user = userEvent.setup();
    renderDevices();

    await user.click(
      await screen.findByRole("button", {
        name: "signOutDevice(deviceLabel(Edge,Windows))",
      }),
    );

    expect(mockRevokeSession).toHaveBeenCalledWith({ token: "other-token" });
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(mockToastSuccess).toHaveBeenCalledWith("signedOut");
  });

  it("signs out every other device after confirming", async () => {
    const user = userEvent.setup();
    renderDevices();

    await user.click(
      await screen.findByRole("button", { name: "signOutOthers" }),
    );
    await user.click(screen.getByRole("button", { name: "confirmSignOut" }));

    expect(mockRevokeOtherSessions).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "signOutOthers" })).toBeNull();
  });

  it("keeps the device and says so when sign-out fails", async () => {
    const user = userEvent.setup();
    mockRevokeSession.mockResolvedValueOnce({
      data: null,
      error: { message: "nope" },
    });
    renderDevices();

    await user.click(
      await screen.findByRole("button", {
        name: "signOutDevice(deviceLabel(Edge,Windows))",
      }),
    );

    expect(mockToastError).toHaveBeenCalledWith("signOutError");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("offers a retry when the list does not load", async () => {
    mockListSessions.mockResolvedValueOnce({
      data: null,
      error: { message: "down" },
    });
    renderDevices();

    expect(await screen.findByText("loadError")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
  });
});
