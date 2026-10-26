import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertNewsletterEnabled,
  isNewsletterEnabled,
  isNewsletterWorkspaceEnabled,
} from "./feature";

const newsletterEnv = vi.hoisted(() => ({ NEWSLETTER_ENABLED: false }));
const workspace = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/config/env", () => ({ getEnv: () => newsletterEnv }));
vi.mock("@/lib/db/prisma", () => ({ default: { workspace } }));

beforeEach(() => {
  vi.resetAllMocks();
  newsletterEnv.NEWSLETTER_ENABLED = false;
});

describe("newsletter workspace beta gate", () => {
  it.each([null, { slug: "other" }, { slug: "utxo" }])(
    "requires the project's workspace organization to be utxo: %s",
    async (organization) => {
      newsletterEnv.NEWSLETTER_ENABLED = true;
      workspace.findUnique.mockResolvedValue({ organization });
      expect(await isNewsletterWorkspaceEnabled("workspace_1")).toBe(
        organization?.slug === "utxo",
      );
      expect(workspace.findUnique).toHaveBeenCalledWith({
        where: { id: "workspace_1" },
        select: { organization: { select: { slug: true } } },
      });
    },
  );

  it("rejects disabled, missing, and unknown workspaces", async () => {
    expect(await isNewsletterWorkspaceEnabled("workspace_1")).toBe(false);
    newsletterEnv.NEWSLETTER_ENABLED = true;
    expect(await isNewsletterWorkspaceEnabled(null)).toBe(false);
    expect(workspace.findUnique).not.toHaveBeenCalled();
    workspace.findUnique.mockResolvedValue(null);
    expect(await isNewsletterWorkspaceEnabled("unknown")).toBe(false);
  });

  it("propagates workspace lookup failures", async () => {
    newsletterEnv.NEWSLETTER_ENABLED = true;
    workspace.findUnique.mockRejectedValue(new Error("Database unavailable"));
    await expect(isNewsletterWorkspaceEnabled("workspace_1")).rejects.toThrow(
      "Database unavailable",
    );
  });
});

describe("newsletter feature flag", () => {
  it.each([false, true])("reports enabled=%s", (enabled) => {
    newsletterEnv.NEWSLETTER_ENABLED = enabled;

    expect(isNewsletterEnabled()).toBe(enabled);
  });

  it("throws a 404 HTTP error when disabled", () => {
    expect(assertNewsletterEnabled).toThrow(HTTPException);
    expect(assertNewsletterEnabled).toThrow(
      expect.objectContaining({
        status: 404,
        message: "Newsletter is not enabled",
      }),
    );
  });

  it("allows access when enabled", () => {
    newsletterEnv.NEWSLETTER_ENABLED = true;

    expect(assertNewsletterEnabled).not.toThrow();
  });
});
