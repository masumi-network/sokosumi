import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

import { ProjectSocialAccounts } from "@/app/projects/components/project-social-accounts";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import {
  disconnectProjectSocialConnection,
  finalizeProjectSocialConnection,
  initiateProjectSocialConnection,
} from "@/lib/actions/project/action";
import type { ProjectSocialConnection } from "@/lib/clients/generated/core/types.gen";

const { refreshMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

const MESSAGES: Record<string, string> = {
  title: "Social accounts",
  description:
    "Connect X accounts that this project can use for future publishing.",
  account: "X account",
  connect: "Connect X account",
  reconnect: "Reconnect",
  replace: "Replace",
  disconnect: "Disconnect",
  connecting: "Connecting…",
  disconnecting: "Disconnecting…",
  "status.active": "Connected",
  "status.disconnected": "Disconnected",
  "status.pending": "Connection pending",
  "status.reauthorization_required": "Reconnection required",
  unknownHandle: "Unknown X account",
  "replaceDialog.title": "Replace this X account?",
  "replaceDialog.description":
    "The current account will be disconnected before you connect a replacement.",
  "replaceDialog.confirm": "Replace account",
  "disconnectDialog.title": "Disconnect this X account?",
  "disconnectDialog.description":
    "This project will no longer be authorized to use this account.",
  "disconnectDialog.confirm": "Disconnect account",
  cancel: "Cancel",
  "success.connected": "X account connected.",
  "success.disconnected": "X account disconnected.",
  "errors.inFlight": "Another X account action is already in progress.",
  "errors.popupBlocked":
    "Your browser blocked the X authorization window. Allow popups and try again.",
  "errors.popupClosed":
    "The X authorization window was closed before setup finished. Try again.",
  "errors.timeout": "X authorization took too long. Try again.",
  "errors.providerCallback":
    "X authorization did not complete. Return to Project settings and try again.",
  "errors.legacyCallback":
    "This OAuth callback cannot verify your X account. Update the Composio callback setup and try again.",
  "errors.verifier":
    "We could not verify your X account. Start the connection again.",
  "errors.intent":
    "This connection request expired or is no longer valid. Start again.",
  "errors.duplicate":
    "That X account is already connected to this project. Choose a different account.",
  "errors.reconnectMismatch":
    "Reconnect the same X account that is already linked to this project.",
  "errors.finalize":
    "We could not finish connecting this X account. Try again.",
  "errors.disconnect": "We could not disconnect this X account. Try again.",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => MESSAGES[key] ?? key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  disconnectProjectSocialConnection: vi.fn(),
  finalizeProjectSocialConnection: vi.fn(),
  initiateProjectSocialConnection: vi.fn(),
}));

vi.mock("@/lib/actions/composio/action", () => ({
  completeComposioAuthCallbackAction: vi.fn(),
}));

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];

  readonly close = vi.fn();
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }
}

const PROJECT_ID = "project-1";

let windowOpenMock: MockInstance<typeof window.open>;

function buildConnection(
  overrides: Partial<ProjectSocialConnection> = {},
): ProjectSocialConnection {
  return {
    id: "connection-1",
    provider: "x",
    externalHandle: "sokosumi",
    status: "active",
    connectedAt: new Date("2026-09-03T10:00:00.000Z"),
    disconnectedAt: null,
    ...overrides,
  };
}

describe("ProjectSocialAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("project-social-nonce");
    windowOpenMock = vi.spyOn(window, "open");
    windowOpenMock.mockReset();
    windowOpenMock.mockReturnValue({
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "", replace: vi.fn() },
    } as unknown as Window);
    vi.mocked(initiateProjectSocialConnection).mockResolvedValue({
      ok: true,
      value: {
        connectionId: "ca_known",
        redirectUrl: "https://connect.composio.dev/link-token",
      },
    });
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(finalizeProjectSocialConnection).mockResolvedValue({
      ok: true,
      value: buildConnection(),
    });
    vi.mocked(disconnectProjectSocialConnection).mockResolvedValue({
      ok: true,
      value: buildConnection({
        status: "disconnected",
        disconnectedAt: new Date("2026-09-03T10:05:00.000Z"),
      }),
    });
  });

  it("shows connected and reauthorization-required X account lifecycle controls", () => {
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            externalHandle: "needs-auth",
            status: "reauthorization_required",
          }),
          buildConnection({
            id: "connection-3",
            externalHandle: "pending-auth",
            status: "pending",
          }),
        ]}
      />,
    );

    const connectedRow = screen.getByTestId(
      "project-social-connection-connection-1",
    );
    expect(within(connectedRow).getByText("@sokosumi")).toBeVisible();
    expect(within(connectedRow).getByText("Connected")).toBeVisible();
    expect(
      within(connectedRow).getByRole("button", { name: "Replace" }),
    ).toBeVisible();
    expect(
      within(connectedRow).getByRole("button", { name: "Disconnect" }),
    ).toBeVisible();
    expect(
      within(connectedRow).queryByRole("button", { name: "Reconnect" }),
    ).not.toBeInTheDocument();

    const reauthorizationRow = screen.getByTestId(
      "project-social-connection-connection-2",
    );
    expect(within(reauthorizationRow).getByText("@needs-auth")).toBeVisible();
    expect(
      within(reauthorizationRow).getByText("Reconnection required"),
    ).toBeVisible();
    expect(
      within(reauthorizationRow).getByRole("button", { name: "Reconnect" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Connect X account" }),
    ).toBeVisible();

    const pendingRow = screen.getByTestId(
      "project-social-connection-connection-3",
    );
    expect(within(pendingRow).getByText("Connection pending")).toBeVisible();
    expect(
      within(pendingRow).queryByRole("button", { name: "Reconnect" }),
    ).not.toBeInTheDocument();
    expect(
      within(pendingRow).queryByRole("button", { name: "Replace" }),
    ).not.toBeInTheDocument();
    expect(
      within(pendingRow).getByRole("button", { name: "Disconnect" }),
    ).toBeVisible();
  });

  it("verifies a matching callback and finalizes with the initiated connection id", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.mocked(completeComposioAuthCallbackAction).mockImplementation(
      async () => {
        calls.push("complete");
        return { ok: true, value: undefined };
      },
    );
    vi.mocked(finalizeProjectSocialConnection).mockImplementation(async () => {
      calls.push("finalize");
      return { ok: true, value: buildConnection() };
    });

    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    expect(window.open).toHaveBeenCalledWith(
      "about:blank",
      "sokosumi:composio:oauth:project-social-nonce",
      expect.any(String),
    );

    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_known",
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(completeComposioAuthCallbackAction).toHaveBeenCalledWith({
        connectionId: "ca_known",
        sessionUri: "https://backend.composio.dev/session/single-use",
      });
      expect(finalizeProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        connectionId: "ca_known",
      });
    });
    expect(calls).toEqual(["complete", "finalize"]);
    expect(toastSuccessMock).toHaveBeenCalledWith("X account connected.");
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(MockBroadcastChannel.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("abandons a callback for a different connection without finalizing", async () => {
    const user = userEvent.setup();
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_other",
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This OAuth callback cannot verify your X account. Update the Composio callback setup and try again.",
      );
    });
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
    expect(finalizeProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("completes through same-origin postMessage when BroadcastChannel is unavailable", async () => {
    const user = userEvent.setup();
    const popup = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "", replace: vi.fn() },
    };
    vi.stubGlobal("BroadcastChannel", undefined);
    windowOpenMock.mockReturnValue(popup as unknown as Window);
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => {
      expect(popup.location.href).toBe(
        "https://connect.composio.dev/link-token",
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "sokosumi:composio:result",
            status: "success",
            connectionId: "ca_known",
            sessionUri: "https://backend.composio.dev/session/single-use",
            errorMessage: null,
            nonce: "project-social-nonce",
          },
        }),
      );
    });

    await waitFor(() => {
      expect(completeComposioAuthCallbackAction).toHaveBeenCalledWith({
        connectionId: "ca_known",
        sessionUri: "https://backend.composio.dev/session/single-use",
      });
      expect(finalizeProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        connectionId: "ca_known",
      });
    });
  });

  it("reports blocked popups and verifier-required callbacks without finalizing", async () => {
    const user = userEvent.setup();
    windowOpenMock.mockReturnValueOnce(null);

    const { rerender } = render(
      <ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />,
    );

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Your browser blocked the X authorization window. Allow popups and try again.",
    );
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();

    rerender(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);
    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_legacy_callback",
          sessionUri: null,
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This OAuth callback cannot verify your X account. Update the Composio callback setup and try again.",
      );
    });
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
    expect(finalizeProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("reports when the authorization popup closes before a callback", async () => {
    const user = userEvent.setup();
    const popup = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "", replace: vi.fn() },
    };
    windowOpenMock.mockReturnValue(popup as unknown as Window);
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    popup.closed = true;

    await waitFor(
      () => {
        expect(toastErrorMock).toHaveBeenCalledWith(
          "The X authorization window was closed before setup finished. Try again.",
        );
      },
      { timeout: 1_000 },
    );
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
    expect(finalizeProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("does not attach a callback channel after the Settings modal unmounts", async () => {
    const user = userEvent.setup();
    let resolveInitiation:
      | ((
          value: Awaited<ReturnType<typeof initiateProjectSocialConnection>>,
        ) => void)
      | undefined;
    vi.mocked(initiateProjectSocialConnection).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitiation = resolve;
        }),
    );

    const { unmount } = render(
      <ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />,
    );
    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    unmount();

    await act(async () => {
      resolveInitiation?.({
        ok: true,
        value: {
          connectionId: "ca_known",
          redirectUrl: "https://connect.composio.dev/link-token",
        },
      });
    });

    expect(MockBroadcastChannel.instances).toHaveLength(0);
  });

  it("shows provider and action failures without exposing callback details", async () => {
    const user = userEvent.setup();
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "error",
          connectionId: null,
          sessionUri: null,
          errorMessage: "provider-secret-detail",
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "X authorization did not complete. Return to Project settings and try again.",
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith("provider-secret-detail");

    vi.mocked(initiateProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "NOT_FOUND", message: "Unknown or expired connection" },
    });
    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This connection request expired or is no longer valid. Start again.",
      );
    });
  });

  it("reports a callback verification failure without finalizing", async () => {
    const user = userEvent.setup();
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "BAD_INPUT", message: "Verification unavailable" },
    });
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_known",
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "We could not verify your X account. Start the connection again.",
      );
    });
    expect(finalizeProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("explains when a duplicate X account cannot be added", async () => {
    const user = userEvent.setup();
    vi.mocked(finalizeProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "This X account is already connected to the Project",
      },
    });
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await user.click(screen.getByRole("button", { name: "Connect X account" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_known",
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "That X account is already connected to this project. Choose a different account.",
      );
    });
  });

  it("explains reconnect identity mismatches", async () => {
    const user = userEvent.setup();
    vi.mocked(finalizeProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "BAD_INPUT",
        message: "Reconnect must match the existing account",
      },
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection({ status: "reauthorization_required" })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(MockBroadcastChannel.instances).toHaveLength(1));
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: "ca_known",
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Reconnect the same X account that is already linked to this project.",
      );
    });
  });

  it("reports failed disconnects after deliberate confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Disconnect failed" },
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Disconnect account",
      }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "We could not disconnect this X account. Try again.",
      );
    });
  });

  it("requires explicit confirmation before replacing or disconnecting an account", async () => {
    const user = userEvent.setup();
    vi.mocked(initiateProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "BAD_INPUT", message: "Connection unavailable" },
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Replace" }));
    const replaceDialog = screen.getByRole("alertdialog");
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();
    await user.click(
      within(replaceDialog).getByRole("button", { name: "Replace account" }),
    );
    await waitFor(() => {
      expect(initiateProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        action: "replace",
        socialConnectionId: "connection-1",
      });
    });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    const disconnectDialog = screen.getByRole("alertdialog");
    expect(disconnectProjectSocialConnection).not.toHaveBeenCalled();
    await user.click(
      within(disconnectDialog).getByRole("button", {
        name: "Disconnect account",
      }),
    );
    await waitFor(() => {
      expect(disconnectProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        socialConnectionId: "connection-1",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("X account disconnected.");
  });

  it("refreshes after a replacement initiation failure retires the active connection", async () => {
    const user = userEvent.setup();
    vi.mocked(initiateProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "BAD_INPUT", message: "Connection unavailable" },
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Replace" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Replace account",
      }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This connection request expired or is no longer valid. Start again.",
      );
      expect(refreshMock).toHaveBeenCalledOnce();
    });
  });
});
