import type {
  FinalizeProjectAdConnectionResponse,
  ProjectAdAccount,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachAdAccounts,
  disconnectAdAccount,
  finalizeAdConnection,
  initiateAdConnection,
} from "@/lib/actions/ads/action";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import type { ComposioOAuthPopupFlow } from "@/lib/composio/use-composio-oauth-popup";
import messages from "../../../../../messages/en.json";
import { AdsAccounts } from "./ads-accounts";

const { toastErrorMock, toastSuccessMock, popupMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  popupMock: { blocked: false },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/lib/actions/ads/action", () => ({
  attachAdAccounts: vi.fn(),
  disconnectAdAccount: vi.fn(),
  finalizeAdConnection: vi.fn(),
  initiateAdConnection: vi.fn(),
}));

vi.mock("@/lib/actions/composio/action", () => ({
  completeComposioAuthCallbackAction: vi.fn(),
}));

// The popup protocol has its own tests; here the popup is a flow that either
// answers with a callback or blocks.
const flow = {
  navigate: vi.fn(),
  nonce: "nonce",
  waitForCallback: vi.fn(),
} satisfies ComposioOAuthPopupFlow;

vi.mock("@/lib/composio/use-composio-oauth-popup", () => ({
  useComposioOAuthPopup: () => ({
    runPopupOAuth: async (action: (f: ComposioOAuthPopupFlow) => unknown) =>
      popupMock.blocked
        ? { kind: "popup_blocked" }
        : { kind: "completed", value: await action(flow) },
  }),
}));

const PROJECT_ID = "project-1";

function buildAccount(
  overrides: Partial<ProjectAdAccount> = {},
): ProjectAdAccount {
  return {
    id: "account-1",
    connectionId: "connection-1",
    provider: "google_ads",
    externalAccountId: "123-456-7890",
    name: "Launch plan",
    currency: "EUR",
    timeZone: null,
    loginCustomerId: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  };
}

function finalization(
  accountCount: number,
): FinalizeProjectAdConnectionResponse {
  return {
    connection:
      accountCount === 0
        ? null
        : {
            id: "connection-1",
            provider: "google_ads",
            status: "active",
            createdAt: new Date("2026-10-01T10:00:00.000Z"),
          },
    availableAccounts: Array.from({ length: accountCount }, (_, index) => ({
      externalAccountId: `acc-${index + 1}`,
      name: `Account ${index + 1}`,
      currency: "EUR",
      timeZone: null,
    })),
  };
}

function renderAccounts(accounts: ProjectAdAccount[] = []) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ App: { Ads: messages.App.Ads } }}
    >
      <AdsAccounts accounts={accounts} projectId={PROJECT_ID} />
    </NextIntlClientProvider>,
  );
}

describe("AdsAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    popupMock.blocked = false;
    vi.mocked(initiateAdConnection).mockResolvedValue({
      ok: true,
      value: {
        connectionId: "ca_1",
        redirectUrl: "https://connect.composio.dev/link",
      },
    });
    flow.waitForCallback.mockResolvedValue({
      kind: "callback",
      payload: {
        status: "success",
        connectionId: "ca_1",
        sessionUri: "https://backend.composio.dev/session/one",
      },
    });
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(finalizeAdConnection).mockResolvedValue({
      ok: true,
      value: finalization(2),
    });
    vi.mocked(attachAdAccounts).mockResolvedValue({ ok: true, value: [] });
    vi.mocked(disconnectAdAccount).mockResolvedValue({
      ok: true,
      value: undefined,
    });
  });

  describe("empty state", () => {
    it("offers both connect buttons as its next step", () => {
      renderAccounts();

      expect(screen.getByText("No ad accounts connected yet")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Connect Meta Ads" }),
      ).toBeEnabled();
    });
  });

  describe("account list", () => {
    it("shows provider, name, external id and currency per account", () => {
      renderAccounts([
        buildAccount(),
        buildAccount({
          id: "account-2",
          provider: "meta_ads",
          externalAccountId: "act_42",
          name: "Brand",
          currency: "USD",
        }),
      ]);

      const rows = within(
        screen.getByRole("list", { name: "Connected ad accounts" }),
      ).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Launch plan");
      expect(rows[0]).toHaveTextContent("Google Ads · 123-456-7890 · EUR");
      expect(rows[1]).toHaveTextContent("Brand");
      expect(rows[1]).toHaveTextContent("Meta Ads · act_42 · USD");
      expect(screen.queryByText("No ad accounts connected yet")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      ).toBeVisible();
    });
  });

  describe("connecting", () => {
    it("runs the popup flow, then lets the person pick and attach accounts", async () => {
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      );

      expect(initiateAdConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        provider: "google_ads",
      });
      expect(flow.navigate).toHaveBeenCalledWith(
        "https://connect.composio.dev/link",
      );
      expect(completeComposioAuthCallbackAction).toHaveBeenCalledWith({
        connectionId: "ca_1",
        sessionUri: "https://backend.composio.dev/session/one",
      });
      expect(finalizeAdConnection).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        connectionId: "ca_1",
      });

      const dialog = await screen.findByRole("dialog", {
        name: "Choose ad accounts",
      });
      await user.click(
        within(dialog).getByRole("checkbox", { name: /Account 2/ }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Connect selected" }),
      );

      await waitFor(() =>
        expect(attachAdAccounts).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          adConnectionId: "connection-1",
          externalAccountIds: ["acc-2"],
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Ad accounts connected successfully",
      );
    });

    it("says so when the login reaches no ad accounts, without a dialog", async () => {
      vi.mocked(finalizeAdConnection).mockResolvedValue({
        ok: true,
        value: finalization(0),
      });
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Meta Ads" }),
      );

      expect(
        await screen.findByText("No ad accounts found for this login"),
      ).toBeVisible();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("keeps the dialog open and toasts when attaching fails", async () => {
      vi.mocked(attachAdAccounts).mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR" },
      });
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      );
      const dialog = await screen.findByRole("dialog");
      await user.click(
        within(dialog).getByRole("checkbox", { name: /Account 1/ }),
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Connect selected" }),
      );

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Failed to connect ad accounts",
        ),
      );
      expect(screen.getByRole("dialog")).toBeVisible();
    });

    it("notes that a provider isn't available when Core is not configured, keeping the other usable", async () => {
      vi.mocked(initiateAdConnection).mockResolvedValue({
        ok: false,
        error: { code: "ADS_NOT_CONFIGURED" },
      });
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      );

      expect(
        await screen.findByText("Google Ads isn't available yet"),
      ).toBeVisible();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Connect Meta Ads" }),
      ).toBeEnabled();
    });

    it("toasts any other failure to start", async () => {
      vi.mocked(initiateAdConnection).mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR" },
      });
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Meta Ads" }),
      );

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Failed to connect Meta Ads",
        ),
      );
      expect(screen.queryByText(/isn't available yet/)).toBeNull();
    });

    it("toasts when the provider reports an error in the popup", async () => {
      flow.waitForCallback.mockResolvedValue({
        kind: "callback",
        payload: { status: "error", connectionId: "ca_1", sessionUri: null },
      });
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      );

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Failed to connect Google Ads",
        ),
      );
      expect(finalizeAdConnection).not.toHaveBeenCalled();
    });

    it("stays quiet when the popup is closed by the person", async () => {
      flow.waitForCallback.mockResolvedValue({ kind: "cancelled" });
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      );

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Connect Google Ads" }),
        ).toBeEnabled(),
      );
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(finalizeAdConnection).not.toHaveBeenCalled();
    });

    it("tells the person when the browser blocked the popup", async () => {
      popupMock.blocked = true;
      const user = userEvent.setup();
      renderAccounts();

      await user.click(
        screen.getByRole("button", { name: "Connect Google Ads" }),
      );

      expect(toastErrorMock).toHaveBeenCalledWith(
        "Your browser blocked the authorization window. Allow popups and try again.",
      );
      expect(initiateAdConnection).not.toHaveBeenCalled();
    });
  });

  describe("disconnecting", () => {
    it("asks first, then disconnects the account", async () => {
      const user = userEvent.setup();
      renderAccounts([buildAccount()]);

      await user.click(
        screen.getByRole("button", { name: "Disconnect Launch plan" }),
      );
      const dialog = await screen.findByRole("alertdialog", {
        name: "Disconnect Launch plan?",
      });
      expect(disconnectAdAccount).not.toHaveBeenCalled();

      await user.click(
        within(dialog).getByRole("button", { name: "Disconnect" }),
      );

      await waitFor(() =>
        expect(disconnectAdAccount).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          accountId: "account-1",
        }),
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Ad account disconnected successfully",
      );
    });

    it("does nothing when the confirmation is cancelled", async () => {
      const user = userEvent.setup();
      renderAccounts([buildAccount()]);

      await user.click(
        screen.getByRole("button", { name: "Disconnect Launch plan" }),
      );
      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(disconnectAdAccount).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("toasts when disconnecting fails", async () => {
      vi.mocked(disconnectAdAccount).mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR" },
      });
      const user = userEvent.setup();
      renderAccounts([buildAccount()]);

      await user.click(
        screen.getByRole("button", { name: "Disconnect Launch plan" }),
      );
      const dialog = await screen.findByRole("alertdialog");
      await user.click(
        within(dialog).getByRole("button", { name: "Disconnect" }),
      );

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Failed to disconnect ad account",
        ),
      );
    });
  });
});
