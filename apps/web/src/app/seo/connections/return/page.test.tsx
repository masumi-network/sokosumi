import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readSeoConnectionCallback,
  SEO_CONNECTION_HANDOFF_PREFIX,
} from "@/lib/seo/connection-callback";
import messages from "../../../../../messages/en.json";
import SeoConnectionReturnPage from "./page";

const network = vi.hoisted(() => ({ finalize: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/actions/seo-connections/action", () => ({
  finalizeSeoStatisticsAction: network.finalize,
}));
const AUDIT = "687d2470-7c63-4779-b10c-462d24ac1e1b";
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
      <NextIntlClientProvider locale="en" messages={messages}>
        <SeoConnectionReturnPage />
      </NextIntlClientProvider>
    </StrictMode>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("opener", null);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage = network.publish;
      close() {}
    },
  );
  network.finalize.mockResolvedValue({
    ok: true,
    value: {
      provider: "ga4",
      name: "Google Analytics",
      status: "connected",
      source: "native",
    },
  });
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
  });
});
