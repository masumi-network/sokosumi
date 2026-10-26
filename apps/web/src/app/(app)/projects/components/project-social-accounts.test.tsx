import type {
  DisconnectProjectSocialConnectionResponse,
  ProjectSocialConnection,
} from "@sokosumi/core-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  refreshProjectSocialAccountStatistics,
} from "@/lib/actions/project/action";
import { stubLoadedImage } from "@/test/stub-pending-image-load";
import messages from "../../../../../messages/en.json";

const { refreshMock, toastErrorMock, toastSuccessMock, toastWarningMock } =
  vi.hoisted(() => ({
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastWarningMock: vi.fn(),
  }));

const MESSAGES: Record<string, string> = {
  title: "Social accounts",
  account: "{provider} account",
  connect: "Connect {provider} account",
  connectAccount: "Connect account",
  projectClosed: "This project is closed.",
  comingSoon: "Coming soon",
  connectComingSoon: "{provider} (coming soon)",
  empty: "No accounts yet.",
  emptyHint: "Connect one to post.",
  actions: "Actions for {account}",
  reconnect: "Reconnect",
  startOver: "Start over",
  syncNow: "Sync now",
  replace: "Replace",
  disconnect: "Disconnect",
  "status.active": "Connected",
  "status.disconnected": "Disconnected",
  "status.pending": "Connection pending",
  "status.reauthorization_required": "Reconnection required",
  unknownHandle: "Unknown account",
  "replaceDialog.title": "Replace {account}?",
  "replaceDialog.description":
    "Drafts and scheduled posts move to the new account.",
  "replaceDialog.confirm": "Replace account",
  "disconnectDialog.title": "Disconnect {account}?",
  "disconnectDialog.description":
    "This project will no longer be authorized to use this account.",
  "disconnectDialog.confirm": "Disconnect account",
  cancel: "Cancel",
  "success.connected": "{account} connected.",
  "success.disconnected": "{account} disconnected.",
  "success.syncStarted": "Sync started.",
  "warning.providerRevocationFailed":
    "This account is disconnected from this project, but the provider may still authorize this app. Revoke the app under Connections.",
  "errors.notConfigured":
    "This integration is not configured yet. Contact support to enable it.",
  "errors.inFlight": "Another account action is already in progress.",
  "errors.popupBlocked":
    "Your browser blocked the authorization window. Allow popups and try again.",
  "errors.timeout": "Authorization took too long. Try again.",
  "errors.providerCallback": "Authorization did not complete. Try again.",
  "errors.legacyCallback":
    "This callback cannot verify your account. Contact support and try again.",
  "errors.verifier":
    "We could not verify your account. Start the connection again.",
  "errors.intent":
    "This connection request expired or is no longer valid. Start again.",
  "errors.duplicate":
    "That account is already connected to this project. Choose a different account.",
  "errors.reconnectMismatch":
    "Reconnect the same account that is already linked to this project.",
  "errors.finalize": "We could not finish connecting this account. Try again.",
  "errors.facebookPage":
    "Facebook needs an account that manages exactly one Page.",
  "errors.disconnect": "We could not disconnect this account. Try again.",
  "errors.sync": "Couldn't start sync.",
};

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, string>) =>
      (namespace === "App.Projects.SocialPosts"
        ? ({
            "reconnection.accounts": "Accounts needing attention",
            "reconnection.title": "{account} needs reconnecting",
            "reconnection.affected": "{count} posts affected",
          }[key] ?? key)
        : (MESSAGES[key] ?? key)
      ).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? name),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  disconnectProjectSocialConnection: vi.fn(),
  finalizeProjectSocialConnection: vi.fn(),
  initiateProjectSocialConnection: vi.fn(),
  refreshProjectSocialAccountStatistics: vi.fn(),
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
    displayName: null,
    avatarUrl: null,
    subscriptionType: null,
    status: "active",
    connectedAt: new Date("2026-09-03T10:00:00.000Z"),
    disconnectedAt: null,
    ...overrides,
  };
}

function buildDisconnectResult(
  overrides: Partial<DisconnectProjectSocialConnectionResponse> = {},
): DisconnectProjectSocialConnectionResponse {
  return {
    ...buildConnection({ status: "disconnected" }),
    providerRevocation: "succeeded",
    ...overrides,
  };
}

async function chooseAccountAction(
  user: ReturnType<typeof userEvent.setup>,
  action: "Replace" | "Disconnect",
  account = "@sokosumi",
): Promise<void> {
  await user.click(
    screen.getByRole("button", { name: `Actions for ${account}` }),
  );
  await user.click(screen.getByRole("menuitem", { name: action }));
}

async function connectProvider(
  user: ReturnType<typeof userEvent.setup>,
  provider = "X",
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Connect account" }));
  await user.click(
    screen.getByRole("menuitem", { name: `Connect ${provider} account` }),
  );
}

describe("ProjectSocialAccounts", () => {
  it("only uses message keys the catalog defines", () => {
    const catalog = messages.App.Projects.ProjectSocialAccounts;
    expect(catalog.connectAccount).toBe("Connect account");
    expect(catalog).not.toHaveProperty("description");
    for (const key of Object.keys(MESSAGES)) {
      const value = key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          catalog,
        );
      expect(typeof value, key).toBe("string");
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    MockBroadcastChannel.instances = [];
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("project-social-nonce");
    windowOpenMock = vi.spyOn(window, "open");
    windowOpenMock.mockReset();
    windowOpenMock.mockReturnValue({
      closed: false,
      sessionStorage: { setItem: vi.fn() },
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
      value: buildDisconnectResult({
        disconnectedAt: new Date("2026-09-03T10:05:00.000Z"),
      }),
    });
  });

  it("keeps Connect account without a visible section heading", () => {
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    expect(
      screen.getByRole("button", { name: "Connect account" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Social accounts" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Social accounts" }),
    ).not.toBeInTheDocument();
  });

  it("explains missing provider configuration instead of reporting an expired request", async () => {
    vi.mocked(initiateProjectSocialConnection).mockResolvedValue({
      ok: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        kind: "integration_not_configured",
        message: "The service is currently unavailable.",
      },
    });
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);
    await connectProvider(userEvent.setup(), "Instagram");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This integration is not configured yet",
    );
    expect(screen.queryByText(/COMPOSIO_INSTAGRAM/)).not.toBeInTheDocument();
  });

  it("shows an empty state when no accounts are connected", () => {
    const { rerender } = render(
      <ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />,
    );

    const empty = screen.getByTestId("project-social-accounts-empty");
    expect(empty).toBeVisible();
    expect(empty).toHaveTextContent("No accounts yet.");
    expect(empty).toHaveTextContent("Connect one to post.");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    rerender(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );
    expect(
      screen.queryByTestId("project-social-accounts-empty"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("list")).toBeVisible();
  });

  it.each([
    ["tiktok", "TikTok"],
    ["facebook", "Facebook"],
  ])(
    "shows %s as coming soon and does not start a connection",
    async (_provider, name) => {
      const user = userEvent.setup();
      render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

      await user.click(screen.getByRole("button", { name: "Connect account" }));
      const item = screen.getByRole("menuitem", {
        name: `${name} (coming soon)`,
      });
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveTextContent("Coming soon");

      await user.click(item);
      expect(initiateProjectSocialConnection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["instagram", "Instagram"],
    ["linkedin", "LinkedIn"],
    ["youtube", "YouTube"],
  ])("starts a connection for %s", async (provider, name) => {
    vi.mocked(initiateProjectSocialConnection).mockResolvedValue({
      ok: false,
      error: { code: "BAD_INPUT", message: "Unavailable" },
    });
    const user = userEvent.setup();
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);
    await connectProvider(user, name);
    await waitFor(() =>
      expect(initiateProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        action: "connect",
        provider,
      }),
    );
  });

  it("labels Facebook and YouTube display names without inventing handles", () => {
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            provider: "facebook",
            externalHandle: "Ada Lovelace",
          }),
          buildConnection({
            id: "youtube-1",
            provider: "youtube",
            externalHandle: "Our channel",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("Facebook account")).toBeVisible();
    expect(screen.getByText("Our channel")).toBeVisible();
    expect(screen.getByText("YouTube account")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Actions for Unknown account" }),
    ).not.toBeInTheDocument();
  });

  it("leads with displayName when it differs from the handle", () => {
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            displayName: "Sokosumi HQ",
          }),
          buildConnection({
            id: "connection-same",
            externalHandle: "brand",
            displayName: "@Brand",
          }),
        ]}
      />,
    );

    const named = screen.getByTestId("project-social-connection-connection-1");
    expect(within(named).getByText("Sokosumi HQ")).toBeVisible();
    expect(within(named).getByText("@sokosumi")).toBeVisible();
    expect(
      within(named).getByRole("button", { name: "Actions for Sokosumi HQ" }),
    ).toBeVisible();

    const matching = screen.getByTestId(
      "project-social-connection-connection-same",
    );
    expect(within(matching).getByText("@brand")).toBeVisible();
    expect(within(matching).queryByText("@Brand")).not.toBeInTheDocument();
    expect(
      within(matching).getByRole("button", { name: "Actions for @brand" }),
    ).toBeVisible();
  });

  it("gives Connect, Reconnect, and menu rows 44px phone targets", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            id: "connection-2",
            externalHandle: "needs-auth",
            status: "reauthorization_required",
          }),
        ]}
      />,
    );

    const connect = screen.getByRole("button", { name: "Connect account" });
    expect(connect).toHaveClass("h-11", "md:h-8");
    expect(screen.getByRole("button", { name: "Reconnect" })).toHaveClass(
      "h-11",
      "md:h-8",
    );

    await user.click(connect);
    expect(
      screen.getByRole("menuitem", { name: "Connect Instagram account" }),
    ).toHaveClass("min-h-11");
    await user.keyboard("{Escape}");

    await user.click(
      screen.getByRole("button", { name: "Actions for @needs-auth" }),
    );
    expect(screen.getByRole("menuitem", { name: "Replace" })).toHaveClass(
      "min-h-11",
    );
  });

  it("keeps the platform logo when the account has no photo", () => {
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );
    const row = screen.getByTestId("project-social-connection-connection-1");
    expect(within(row).getByTestId("social-post-account-logo")).toBeVisible();
    expect(
      within(row).queryByTestId("social-post-account-photo"),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByTestId("social-post-account-logo-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows the account photo with a platform logo badge", async () => {
    const restore = stubLoadedImage();
    const photo =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%23111'/></svg>";
    try {
      render(
        <ProjectSocialAccounts
          projectId={PROJECT_ID}
          connections={[buildConnection({ avatarUrl: photo })]}
        />,
      );
      const row = screen.getByTestId("project-social-connection-connection-1");
      await waitFor(() => {
        expect(
          within(row).getByTestId("social-post-account-photo"),
        ).toHaveAttribute("src", photo);
      });
      expect(within(row).getByTestId("social-post-account-logo")).toBeVisible();
      expect(
        within(row).getByTestId("social-post-account-logo-badge"),
      ).toBeVisible();
    } finally {
      restore();
    }
  });

  it("falls back to the platform logo when the account photo fails", async () => {
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({ avatarUrl: "https://example.invalid/missing.png" }),
        ]}
      />,
    );
    const row = screen.getByTestId("project-social-connection-connection-1");
    await waitFor(() => {
      expect(
        within(row).queryByTestId("social-post-account-photo"),
      ).not.toBeInTheDocument();
    });
    expect(within(row).getByTestId("social-post-account-logo")).toBeVisible();
    expect(
      within(row).queryByTestId("social-post-account-logo-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows connected and reauthorization-required X account lifecycle controls", async () => {
    const user = userEvent.setup();
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
      within(connectedRow).queryByRole("button", { name: "Reconnect" }),
    ).not.toBeInTheDocument();
    expect(
      within(connectedRow).queryByRole("button", { name: "Start over" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(connectedRow).getByRole("button", {
        name: "Actions for @sokosumi",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "Sync now" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Replace" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeVisible();
    await user.keyboard("{Escape}");

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
    await user.click(
      within(reauthorizationRow).getByRole("button", {
        name: "Actions for @needs-auth",
      }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Sync now" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(
      within(reauthorizationRow).queryByRole("button", { name: "Start over" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect account" }),
    ).toBeVisible();

    const pendingRow = screen.getByTestId(
      "project-social-connection-connection-3",
    );
    expect(within(pendingRow).getByText("Connection pending")).toBeVisible();
    expect(
      within(pendingRow)
        .getByText("Connection pending")
        .closest(".text-semantic-warning-label"),
    ).toBeTruthy();
    expect(
      within(pendingRow).queryByRole("button", { name: "Reconnect" }),
    ).not.toBeInTheDocument();
    expect(
      within(pendingRow).getByRole("button", { name: "Start over" }),
    ).toBeVisible();
    await user.click(
      within(pendingRow).getByRole("button", {
        name: "Actions for @pending-auth",
      }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Replace" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Sync now" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeVisible();
  });

  it("queues a background refresh from Sync now on a connected account", async () => {
    const user = userEvent.setup();
    vi.mocked(refreshProjectSocialAccountStatistics).mockResolvedValue({
      ok: true,
      value: {
        account: buildConnection(),
        importedPostCount: 0,
      },
    } as never);
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Actions for @sokosumi" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Sync now" }));
    await waitFor(() =>
      expect(refreshProjectSocialAccountStatistics).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        connectionId: "connection-1",
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Sync started.");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("hides disconnected accounts that have no actions", () => {
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-gone",
            externalHandle: "old-account",
            status: "disconnected",
          }),
        ]}
      />,
    );

    expect(
      screen.getByTestId("project-social-connection-connection-1"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("project-social-connection-connection-gone"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("@old-account")).not.toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
  });

  it("disconnects a pending account and starts a new connection on Start over", async () => {
    const user = userEvent.setup();
    vi.mocked(initiateProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "BAD_INPUT", message: "Unavailable" },
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            id: "connection-3",
            externalHandle: "pending-auth",
            status: "pending",
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start over" }));

    await waitFor(() => {
      expect(disconnectProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        socialConnectionId: "connection-3",
      });
      expect(initiateProjectSocialConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        action: "connect",
        provider: "x",
      });
    });
    expect(toastSuccessMock).not.toHaveBeenCalledWith("Account disconnected.");
  });

  it("does not start a new connection when Start over cannot disconnect", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Disconnect failed" },
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            status: "pending",
          }),
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start over" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "We could not disconnect this account. Try again.",
      );
    });
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("disables Start over on a closed project", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialAccounts
        connectDisabled
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            status: "pending",
          }),
        ]}
      />,
    );

    const startOver = screen.getByRole("button", { name: "Start over" });
    expect(startOver).toBeDisabled();
    await user.click(startOver);
    expect(disconnectProjectSocialConnection).not.toHaveBeenCalled();
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("disables the reconnect item on a closed project", async () => {
    const user = userEvent.setup();
    const connection = buildConnection({ status: "reauthorization_required" });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[connection]}
        connectDisabled
        reconnections={[{ connection, affectedPosts: [] }]}
      />,
    );
    const reconnect = within(
      screen.getByTestId(`social-reconnect-${connection.id}`),
    ).getByRole("button", { name: "Reconnect" });
    expect(reconnect).toBeDisabled();
    await user.click(reconnect);
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("shows a reconnect item with the account avatar and starts the existing flow", async () => {
    const user = userEvent.setup();
    const restore = stubLoadedImage();
    const connection = buildConnection({
      status: "reauthorization_required",
      avatarUrl: "https://example.com/photo.jpg",
    });
    const onReconnected = vi.fn();
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[connection]}
        reconnections={[{ connection, affectedPosts: [] }]}
        onReconnected={onReconnected}
      />,
    );
    const row = screen.getByTestId(`social-reconnect-${connection.id}`);
    expect(within(row).getByText("@sokosumi needs reconnecting")).toBeVisible();
    expect(within(row).queryByText(/posts affected/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(row).getByTestId("social-post-account-photo"),
      ).toHaveAttribute("src", connection.avatarUrl),
    );
    expect(
      within(row).getByTestId("social-post-account-logo-badge"),
    ).toBeInTheDocument();
    restore();
    await user.click(within(row).getByRole("button", { name: "Reconnect" }));
    expect(initiateProjectSocialConnection).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      action: "reconnect",
      socialConnectionId: connection.id,
    });
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
    await waitFor(() =>
      expect(onReconnected).toHaveBeenCalledWith(buildConnection()),
    );
  });

  it.each([null, "ca_known"])(
    "verifies a callback with connection ID %s using the initiated connection id",
    async (callbackConnectionId) => {
      const user = userEvent.setup();
      const calls: string[] = [];
      vi.mocked(completeComposioAuthCallbackAction).mockImplementation(
        async () => {
          calls.push("complete");
          return { ok: true, value: undefined };
        },
      );
      vi.mocked(finalizeProjectSocialConnection).mockImplementation(
        async () => {
          calls.push("finalize");
          return { ok: true, value: buildConnection() };
        },
      );

      render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

      await connectProvider(user);
      await waitFor(() =>
        expect(MockBroadcastChannel.instances).toHaveLength(1),
      );
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
            connectionId: callbackConnectionId,
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
      expect(toastSuccessMock).toHaveBeenCalledWith("@sokosumi connected.");
      expect(refreshMock).toHaveBeenCalledOnce();
      expect(MockBroadcastChannel.instances[0]?.close).toHaveBeenCalledOnce();
    },
  );

  it("abandons a callback for a different connection without finalizing", async () => {
    const user = userEvent.setup();
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await connectProvider(user);
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
        "This callback cannot verify your account. Contact support and try again.",
      );
    });
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
    expect(finalizeProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("completes through same-origin postMessage when BroadcastChannel is unavailable", async () => {
    const user = userEvent.setup();
    const popup = {
      closed: false,
      sessionStorage: { setItem: vi.fn() },
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "", replace: vi.fn() },
    };
    vi.stubGlobal("BroadcastChannel", undefined);
    windowOpenMock.mockReturnValue(popup as unknown as Window);
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);

    await connectProvider(user);
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

    await connectProvider(user);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Your browser blocked the authorization window. Allow popups and try again.",
    );
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();

    rerender(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);
    await connectProvider(user);
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
        "This callback cannot verify your account. Contact support and try again.",
      );
    });
    expect(completeComposioAuthCallbackAction).not.toHaveBeenCalled();
    expect(finalizeProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("accepts a callback after COOP makes the popup reference appear closed", async () => {
    vi.useFakeTimers();
    const popup = {
      closed: false,
      sessionStorage: { setItem: vi.fn() },
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "", replace: vi.fn() },
    };
    windowOpenMock.mockReturnValue(popup as unknown as Window);
    render(<ProjectSocialAccounts projectId={PROJECT_ID} connections={[]} />);
    await act(async () => {
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Connect account" }),
        { key: "Enter" },
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Connect X account" }),
      );
    });
    expect(MockBroadcastChannel.instances).toHaveLength(1);
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    vi.useRealTimers();
    expect(MockBroadcastChannel.instances[0]?.close).not.toHaveBeenCalled();
    await act(async () => {
      MockBroadcastChannel.instances[0]?.onmessage?.({
        data: {
          type: "sokosumi:composio:result",
          status: "success",
          connectionId: null,
          sessionUri: "https://backend.composio.dev/session/single-use",
          errorMessage: null,
          nonce: "project-social-nonce",
        },
      } as MessageEvent);
    });
    expect(finalizeProjectSocialConnection).toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
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
    await connectProvider(user);
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

    await connectProvider(user);
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
        "Authorization did not complete. Try again.",
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith("provider-secret-detail");

    vi.mocked(initiateProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: { code: "NOT_FOUND", message: "Unknown or expired connection" },
    });
    await connectProvider(user);
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This connection request expired or is no longer valid. Start again.",
      );
    });
  });

  it("explains a Facebook reconnect that manages zero or several Pages", async () => {
    const user = userEvent.setup();
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(finalizeProjectSocialConnection).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        kind: "social_facebook_page_required",
        message: "Facebook identity rejected",
      },
    });

    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[
          buildConnection({
            provider: "facebook",
            displayName: "Sokosumi Page",
            externalHandle: null,
            status: "reauthorization_required",
          }),
        ]}
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
        "Facebook needs an account that manages exactly one Page.",
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

    await connectProvider(user);
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
        "We could not verify your account. Start the connection again.",
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

    await connectProvider(user);
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
        "That account is already connected to this project. Choose a different account.",
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
        "Reconnect the same account that is already linked to this project.",
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

    await chooseAccountAction(user, "Disconnect");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Disconnect account",
      }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "We could not disconnect this account. Try again.",
      );
    });
  });

  it("warns when X provider revocation was not confirmed", async () => {
    const user = userEvent.setup();
    vi.mocked(disconnectProjectSocialConnection).mockResolvedValueOnce({
      ok: true,
      value: buildDisconnectResult({
        providerRevocation: "failed",
      }),
    });
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );

    await chooseAccountAction(user, "Disconnect");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Disconnect account",
      }),
    );

    expect(
      await screen.findByText(
        "This account is disconnected from this project, but the provider may still authorize this app. Revoke the app under Connections.",
      ),
    ).toBeVisible();
    expect(toastWarningMock).toHaveBeenCalledWith(
      "This account is disconnected from this project, but the provider may still authorize this app. Revoke the app under Connections.",
    );
    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      "This account is disconnected from this project, but the provider may still authorize this app. Revoke the app under Connections.",
    );
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

    await chooseAccountAction(user, "Replace");
    const replaceDialog = screen.getByRole("alertdialog");
    expect(replaceDialog).toHaveAccessibleName("Replace @sokosumi?");
    expect(replaceDialog).toHaveTextContent(
      "Drafts and scheduled posts move to the new account.",
    );
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

    await chooseAccountAction(user, "Disconnect");
    const disconnectDialog = screen.getByRole("alertdialog");
    expect(disconnectDialog).toHaveAccessibleName("Disconnect @sokosumi?");
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
    expect(toastSuccessMock).toHaveBeenCalledWith("@sokosumi disconnected.");
  });

  it("returns focus to the account menu when a confirmation is canceled", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );

    await chooseAccountAction(user, "Disconnect");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Actions for @sokosumi" }),
      ).toHaveFocus();
    });
    expect(disconnectProjectSocialConnection).not.toHaveBeenCalled();
  });

  it("returns focus to the section when a confirmed action leaves the menu disabled", async () => {
    const user = userEvent.setup();
    const pendingDisconnect =
      Promise.withResolvers<
        Awaited<ReturnType<typeof disconnectProjectSocialConnection>>
      >();
    vi.mocked(disconnectProjectSocialConnection).mockReturnValueOnce(
      pendingDisconnect.promise,
    );
    render(
      <ProjectSocialAccounts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
      />,
    );

    await chooseAccountAction(user, "Disconnect");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Disconnect account",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("region", { name: "Social accounts" }),
      ).toHaveFocus();
    });

    await act(async () => {
      pendingDisconnect.resolve({
        ok: true,
        value: buildDisconnectResult(),
      });
    });
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

    await chooseAccountAction(user, "Replace");
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

  it("blocks connect, reconnect, and replace on a closed project", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialAccounts
        connectDisabled
        projectId={PROJECT_ID}
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            externalHandle: "needs-auth",
            status: "reauthorization_required",
          }),
        ]}
      />,
    );

    expect(screen.getByText("This project is closed.")).toBeVisible();
    const connect = screen.getByRole("button", { name: "Connect account" });
    expect(connect).toBeDisabled();
    await user.click(connect);
    expect(
      screen.queryByRole("menuitem", { name: "Connect X account" }),
    ).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Reconnect" })).toBeDisabled();

    await user.click(
      screen.getByRole("button", { name: "Actions for @sokosumi" }),
    );
    expect(
      screen.queryByRole("menuitem", { name: "Replace" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Disconnect" })).toBeVisible();
    expect(initiateProjectSocialConnection).not.toHaveBeenCalled();
  });
});
