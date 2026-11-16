import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import {
  type ComponentType,
  Fragment,
  type ReactNode,
  StrictMode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_MESSAGE_PATHS } from "@/i18n/message-namespaces";
import { pickMessages } from "@/i18n/pick-messages";
import {
  readSeoConnectionCallback,
  SEO_CONNECTION_HANDOFF_PREFIX,
} from "@/lib/seo/connection-callback";
import messages from "../../../../../messages/en.json";
import SeoConnectionReturnPage from "./page";

// Without a local layout, this route inherits only RootIntlTree's global bag.
const layouts = import.meta.glob<{
  default: ComponentType<{ children: ReactNode }>;
}>("./layout.tsx", { eager: true });
const ReturnLayout = layouts["./layout.tsx"]?.default ?? Fragment;
const network = vi.hoisted(() => ({ finalize: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/actions/seo-connections/action", () => ({
  finalizeSeoStatisticsAction: network.finalize,
}));
vi.mock("@/i18n/client-message-boundary", () => ({
  ClientMessageBoundary: ({
    children,
    paths,
  }: {
    children: ReactNode;
    paths: readonly string[];
  }) => (
    <NextIntlClientProvider
      locale="en"
      messages={pickMessages(messages, paths)}
    >
      {children}
    </NextIntlClientProvider>
  ),
}));
const AUDIT = "687d2470-7c63-4779-b10c-462d24ac1e1b";
const connectedResult = {
  ok: true,
  value: {
    provider: "ga4",
    name: "Google Analytics",
    status: "connected",
    source: "native",
  },
} as const;
const parameters = () => ({
  provider: "ga4",
  viewer: "owner",
  organization: "org",
  auditId: AUDIT,
  session_uri: "one-use-session",
});

async function show(params: Record<string, string> = parameters()) {
  window.name =
    SEO_CONNECTION_HANDOFF_PREFIX +
    JSON.stringify(readSeoConnectionCallback(new URLSearchParams(params)));
  render(
    <StrictMode>
      <NextIntlClientProvider
        locale="en"
        messages={pickMessages(messages, GLOBAL_MESSAGE_PATHS)}
        onError={() => {}}
      >
        <ReturnLayout>
          <SeoConnectionReturnPage />
        </ReturnLayout>
      </NextIntlClientProvider>
    </StrictMode>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "close").mockImplementation(() => {});
  vi.stubGlobal("opener", null);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage = network.publish;
      close() {}
    },
  );
  network.finalize.mockResolvedValue(connectedResult);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native SEO callback recovery", () => {
  it("completes in an ordinary tab without nonce, storage, or opener and returns only to its Audit", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    await show({
      ...parameters(),
      returnUrl: "https://untrusted.example/",
      next: "/personal-assistant",
    });
    expect(await screen.findByText(/Your account is connected/)).toBeVisible();
    expect(network.finalize).toHaveBeenCalledExactlyOnceWith({
      provider: "ga4",
      viewerId: "owner",
      organizationId: "org",
      sessionUri: "one-use-session",
    });
    expect(
      screen.getByRole("link", { name: "Return to audit" }),
    ).toHaveAttribute("href", `/seo?auditId=${AUDIT}`);
    expect(
      screen.queryByText(/personal assistant|inbox|calendar|project manager/i),
    ).toBeNull();
    expect(network.publish).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it("keeps the same callback available for explicit verification retry after a temporary failure", async () => {
    network.finalize.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", status: 503 },
    });
    await show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
    expect(window.close).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Retry Google Analytics verification",
      }),
    );
    expect(await screen.findByText(/Your account is connected/)).toBeVisible();
    expect(network.finalize).toHaveBeenCalledTimes(2);
    expect(network.finalize.mock.calls[1][0]).toEqual(
      network.finalize.mock.calls[0][0],
    );
  });

  it("delivers only verified completion using URL state when browser popup state is lost", async () => {
    await show({ ...parameters(), seo_state: "native-attempt" });
    await waitFor(() => expect(network.publish).toHaveBeenCalled());
    expect(network.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "native-attempt",
        status: "success",
        sessionUri: null,
      }),
    );
    expect(JSON.stringify(network.publish.mock.calls)).not.toContain(
      "one-use-session",
    );
    expect(window.close).toHaveBeenCalledOnce();
  });

  it("keeps a popup open until the server verifies consent and publishes completion", async () => {
    const verification = Promise.withResolvers<typeof connectedResult>();
    network.finalize.mockReturnValueOnce(verification.promise);
    await show({ ...parameters(), seo_state: "native-attempt" });
    expect(network.finalize).toHaveBeenCalledOnce();
    expect(network.publish).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    await act(async () => verification.resolve(connectedResult));
    await waitFor(() => expect(window.close).toHaveBeenCalledOnce());
    expect(network.publish.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(window.close).mock.invocationCallOrder[0],
    );
  });

  it("keeps a rejected popup open with translated recovery copy", async () => {
    network.finalize.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", status: 503 },
    });
    await show({ ...parameters(), seo_state: "native-attempt" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
    expect(network.publish).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it("keeps an inactive verification result open without publishing success", async () => {
    network.finalize.mockResolvedValueOnce({
      ok: true,
      value: { ...connectedResult.value, status: "pending" },
    });
    await show({ ...parameters(), seo_state: "native-attempt" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      messages.App.Seo.connections.activationPending,
    );
    expect(network.publish).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });

  it("keeps the Audit fallback when verified completion cannot reach an opener", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    await show({ ...parameters(), seo_state: "native-attempt" });
    expect(await screen.findByText(/Your account is connected/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to audit" }),
    ).toHaveAttribute("href", `/seo?auditId=${AUDIT}`);
    expect(window.close).not.toHaveBeenCalled();
  });

  it("keeps translated success and its Audit fallback when the browser refuses closure", async () => {
    vi.mocked(window.close).mockImplementation(() => {
      throw new DOMException("Closure blocked", "SecurityError");
    });
    await show({ ...parameters(), seo_state: "native-attempt" });
    expect(await screen.findByText(/Your account is connected/)).toBeVisible();
    expect(window.close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Return to audit" }),
    ).toHaveAttribute("href", `/seo?auditId=${AUDIT}`);
  });

  it("does not redeem denied approval or an invalid native return context", async () => {
    await show({
      ...parameters(),
      status: "error",
      auditId: "https://untrusted.example/",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google approval did not finish",
    );
    expect(
      screen.getByRole("link", { name: "Return to audit" }),
    ).toHaveAttribute("href", "/seo");
    expect(network.finalize).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
  });
});
