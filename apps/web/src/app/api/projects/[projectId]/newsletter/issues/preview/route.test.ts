import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";
import { NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ session: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.session,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { previewIssue: mocks.preview },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Projects.Newsletter.Issues",
    }),
}));

import { POST } from "./route";

const VALUES = { subject: "News", template: "TEXT", content: [] };
function preview(values: unknown = VALUES, projectId = NEWSLETTER_PROJECT_ID) {
  return POST(
    new Request("https://web.test/api/preview", {
      method: "POST",
      body: JSON.stringify(values),
    }),
    { params: Promise.resolve({ projectId }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "u1" } },
  });
  mocks.preview.mockResolvedValue({ html: "<p>News</p>" });
});
describe("newsletter preview proxy", () => {
  it("renders validated content through the newsletter service without caching", async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ html: "<p>News</p>" });
    expect(mocks.preview).toHaveBeenCalledWith(NEWSLETTER_PROJECT_ID, VALUES);
  });
  it("requires a session and preserves unavailable authentication as 503", async () => {
    mocks.session.mockResolvedValue({ status: "signedOut" });
    expect((await preview()).status).toBe(401);
    mocks.session.mockResolvedValue({
      status: "unavailable",
      reason: "network",
    });
    expect((await preview()).status).toBe(503);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("rejects invalid blocks and malformed project IDs", async () => {
    expect(
      (
        await preview({
          ...VALUES,
          content: [
            { type: "button", label: "Read", url: "http://example.com" },
          ],
        })
      ).status,
    ).toBe(422);
    expect((await preview(VALUES, "bad")).status).toBe(422);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([403, 404, 503])(
    "preserves Core status %i without leaking details",
    async (status) => {
      mocks.preview.mockRejectedValue(
        new CoreApiRequestError("Private detail", { status }),
      );
      const response = await preview();
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: en.App.Projects.Newsletter.Issues.Preview.error,
      });
    },
  );
});
