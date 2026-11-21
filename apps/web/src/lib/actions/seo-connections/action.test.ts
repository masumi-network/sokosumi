import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  session: vi.fn(),
  connect: vi.fn(),
  finalize: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: boundary.session,
}));
vi.mock("@/lib/services/seo-connection.service", () => ({
  seoConnectionService: {
    connect: boundary.connect,
    finalize: boundary.finalize,
    disconnect: boundary.disconnect,
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import {
  connectSeoStatisticsAction,
  disconnectSeoStatisticsAction,
  finalizeSeoStatisticsAction,
} from "./action";

const actor = { provider: "ga4", viewerId: "owner", organizationId: "org" };
beforeEach(() => {
  vi.clearAllMocks();
  boundary.session.mockResolvedValue({
    status: "authenticated",
    session: {
      user: { id: "owner" },
      session: { activeOrganizationId: "org" },
    },
  });
});
describe("SEO connection action trust boundary", () => {
  it.each([
    { user: { id: "another-owner" }, session: { activeOrganizationId: "org" } },
    { user: { id: "owner" }, session: { activeOrganizationId: "another-org" } },
  ])(
    "refuses stale viewer or workspace context before any provider operation",
    async (session) => {
      boundary.session.mockResolvedValue({ status: "authenticated", session });
      const outcomes = await Promise.all([
        connectSeoStatisticsAction({
          ...actor,
          callbackUrl: "https://preprod.sokosumi.com/seo/connections/callback",
        }),
        finalizeSeoStatisticsAction({ ...actor, sessionUri: "one-use" }),
        disconnectSeoStatisticsAction(actor),
      ]);
      for (const outcome of outcomes)
        expect(outcome).toMatchObject({
          ok: false,
          error: { status: 409, kind: "seo_viewer_changed" },
        });
      expect(boundary.connect).not.toHaveBeenCalled();
      expect(boundary.finalize).not.toHaveBeenCalled();
      expect(boundary.disconnect).not.toHaveBeenCalled();
    },
  );

  it("preserves the Core status needed to distinguish retryable verification from fresh consent", async () => {
    boundary.finalize.mockRejectedValue(
      new CoreApiRequestError("Unavailable", { status: 503 }),
    );
    expect(
      await finalizeSeoStatisticsAction({
        ...actor,
        connectionId: "ca-native",
      }),
    ).toMatchObject({ ok: false, error: { status: 503 } });
    expect(boundary.finalize).toHaveBeenCalledWith(
      "ga4",
      "ca-native",
      undefined,
    );
  });
});
