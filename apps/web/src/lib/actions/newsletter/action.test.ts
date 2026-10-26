import type { Newsletter } from "@sokosumi/core-client";
import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (
    namespace: "App.Projects.Newsletter" | "App.Projects.Newsletter.Validation",
  ) => createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: <T extends object, R>(handler: (params: T) => Promise<R>) =>
    handler,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { saveSettings: mocks.save },
}));

import { saveNewsletterSettings } from "./action";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VALUES = {
  name: " Weekly ",
  senderName: " Team ",
  replyTo: " TEAM@Example.com ",
  logoUrl: "",
  primaryColor: "#abc",
  accentColor: "",
  fontFamily: "Georgia",
  footerText: "Thanks",
  welcomeEmailEnabled: true,
  welcomeSubject: "Hello",
  welcomeBody: "Welcome!",
};
const NEWSLETTER: Newsletter = {
  id: "n1",
  projectId: PROJECT_ID,
  workspaceId: "w1",
  name: "Weekly",
  senderName: "Team",
  replyTo: "team@example.com",
  brand: { primaryColor: "#abc", fontFamily: "Georgia", footerText: "Thanks" },
  welcomeEmailEnabled: true,
  welcomeSubject: "Hello",
  welcomeBody: "Welcome!",
  publicSlug: "weekly-123",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue(NEWSLETTER);
});

describe("saveNewsletterSettings", () => {
  it("normalizes settings, drops blank optional brand fields, and revalidates the page", async () => {
    const result = await saveNewsletterSettings({
      projectId: PROJECT_ID,
      values: { ...VALUES, publicSlug: "forged-slug" },
    });
    expect(mocks.save).toHaveBeenCalledWith(PROJECT_ID, {
      name: "Weekly",
      senderName: "Team",
      replyTo: "team@example.com",
      brand: {
        primaryColor: "#abc",
        fontFamily: "Georgia",
        footerText: "Thanks",
      },
      welcomeEmailEnabled: true,
      welcomeSubject: "Hello",
      welcomeBody: "Welcome!",
    });
    expect(result).toEqual({ ok: true, value: NEWSLETTER });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/newsletter`,
    );
  });

  it("validates incoming settings on the server and returns inline errors", async () => {
    const result = await saveNewsletterSettings({
      projectId: PROJECT_ID,
      values: { ...VALUES, replyTo: "invalid", primaryColor: "red" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        fieldErrors: {
          replyTo: [en.App.Projects.Newsletter.Validation.email],
          primaryColor: [en.App.Projects.Newsletter.Validation.color],
        },
      },
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects missing welcome text before calling Core", async () => {
    const result = await saveNewsletterSettings({
      projectId: PROJECT_ID,
      values: { ...VALUES, welcomeBody: " " },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        fieldErrors: {
          welcomeBody: [en.App.Projects.Newsletter.Validation.required],
        },
      },
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects HTTP logos before saving settings that emails cannot render", async () => {
    const result = await saveNewsletterSettings({
      projectId: PROJECT_ID,
      values: { ...VALUES, logoUrl: "http://example.com/logo.png" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        fieldErrors: {
          logoUrl: [en.App.Projects.Newsletter.Validation.url],
        },
      },
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a malformed project ID", async () => {
    expect(
      await saveNewsletterSettings({ projectId: "invalid", values: VALUES }),
    ).toMatchObject({ ok: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])(
    "returns a translated error for Core status %i",
    async (status) => {
      mocks.save.mockRejectedValue(
        new CoreApiRequestError("Private Core detail", { status }),
      );
      expect(
        await saveNewsletterSettings({ projectId: PROJECT_ID, values: VALUES }),
      ).toEqual({
        ok: false,
        error: {
          message:
            status === 404
              ? en.App.Projects.Newsletter.unavailable
              : en.App.Projects.Newsletter.error,
        },
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});
