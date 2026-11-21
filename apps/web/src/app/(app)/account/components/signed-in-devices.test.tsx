import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
    useTranslations: () =>
      Object.assign(
        (key: string, values?: Record<string, string>) =>
          values ? `${key}(${Object.values(values).join(",")})` : key,
        {
          rich: (
            key: string,
            values: { link: (chunks: ReactNode) => ReactNode },
          ) => (
            <>
              {key}
              {values.link("link")}
            </>
          ),
        },
      ),
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/services/user-sessions.browser", () => ({
  listMySessions: () => mockListSessions(),
  signOutMySession: (id: string) => mockRevokeSession(id),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { revokeOtherSessions: () => mockRevokeOtherSessions() },
}));

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

let sessions: Array<{
  id: string;
  userAgent: string | null;
  createdAt: string;
  current: boolean;
}>;

function renderDevices() {
  return render(<SignedInDevices />, {
    wrapper: TestQueryProvider,
  });
}

describe("SignedInDevices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessions = [
      {
        id: "other",
        userAgent: WINDOWS_EDGE,
        createdAt: "2026-11-20T09:00:00.000Z",
        current: false,
      },
      {
        id: "current",
        userAgent: MAC_SAFARI,
        createdAt: "2026-11-01T09:00:00.000Z",
        current: true,
      },
    ];
    mockListSessions.mockImplementation(async () => sessions);
    mockRevokeSession.mockImplementation(async (id: string) => {
      sessions = sessions.filter((session) => session.id !== id);
    });
    mockRevokeOtherSessions.mockImplementation(async () => {
      sessions = sessions.filter((session) => session.id === "current");
      return { data: { status: true }, error: null };
    });
  });

  it("names the section as a heading and links to notification devices", async () => {
    renderDevices();

    expect(
      screen.getByRole("heading", { level: 2, name: "title" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "/account/notifications",
    );
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

    expect(mockRevokeSession).toHaveBeenCalledWith("other");
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
    mockRevokeSession.mockRejectedValueOnce(new Error("nope"));
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
    mockListSessions.mockRejectedValueOnce(new Error("down"));
    renderDevices();

    expect(await screen.findByText("loadError")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "retry" })).toBeInTheDocument();
  });
});
