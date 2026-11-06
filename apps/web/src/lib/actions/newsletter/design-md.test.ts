import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  fetchMarkdown: vi.fn(),
  getProject: vi.fn(),
  resolveEffective: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App.Projects.Newsletter.DesignPicker") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: <T extends object, R>(handler: (params: T) => Promise<R>) =>
    handler,
}));
vi.mock("@/components/design-md/design-md-edit-page-shared", () => ({
  fetchDesignMdMarkdown: mocks.fetchMarkdown,
}));
vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: { resolveEffectiveDesignMd: mocks.resolveEffective },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.getProject },
}));

import { loadNewsletterBrandFromDesignMd } from "./design-md";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_URL = "https://blob.example.com/design-md/project.md";
const WORKSPACE_URL = "https://blob.example.com/design-md/workspace.md";
const FAILED = {
  ok: false,
  error: { message: en.App.Projects.Newsletter.DesignPicker.error },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fetchMarkdown.mockResolvedValue({ markdown: "primary: #cc0000" });
  mocks.getProject.mockResolvedValue({
    logo: "https://cdn.example.com/project.png",
    designMd: { url: PROJECT_URL },
  });
  mocks.resolveEffective.mockResolvedValue({
    label: "Acme",
    url: WORKSPACE_URL,
    owner: {
      type: "organization",
      name: "Acme",
      logo: "https://cdn.example.com/org.png",
    },
  });
});

describe("loadNewsletterBrandFromDesignMd", () => {
  it("maps the project's DESIGN.md with its logo", async () => {
    await expect(
      loadNewsletterBrandFromDesignMd({
        projectId: PROJECT_ID,
        source: "project",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        primaryColor: "#cc0000",
        logoUrl: "https://cdn.example.com/project.png",
      },
    });
    expect(mocks.fetchMarkdown).toHaveBeenCalledWith(PROJECT_URL);
    expect(mocks.resolveEffective).not.toHaveBeenCalled();
  });

  it("maps the workspace's DESIGN.md with the organization's logo", async () => {
    await expect(
      loadNewsletterBrandFromDesignMd({
        projectId: PROJECT_ID,
        source: "workspace",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        primaryColor: "#cc0000",
        logoUrl: "https://cdn.example.com/org.png",
      },
    });
    expect(mocks.fetchMarkdown).toHaveBeenCalledWith(WORKSPACE_URL);
    expect(mocks.getProject).not.toHaveBeenCalled();
  });

  it("has no logo to offer for a personal DESIGN.md", async () => {
    mocks.resolveEffective.mockResolvedValue({
      label: "Personal",
      url: WORKSPACE_URL,
      owner: { type: "user" },
    });
    await expect(
      loadNewsletterBrandFromDesignMd({
        projectId: PROJECT_ID,
        source: "workspace",
      }),
    ).resolves.toEqual({ ok: true, value: { primaryColor: "#cc0000" } });
  });

  it("rejects bad input before reading anything", async () => {
    for (const input of [
      { projectId: "nope", source: "project" as const },
      {
        projectId: PROJECT_ID,
        source: "https://evil.example/x" as "project",
      },
    ]) {
      await expect(loadNewsletterBrandFromDesignMd(input)).resolves.toEqual(
        FAILED,
      );
    }
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.fetchMarkdown).not.toHaveBeenCalled();
  });

  it("fails when the design is gone, unreadable or Core is down", async () => {
    const input = { projectId: PROJECT_ID, source: "project" as const };
    mocks.getProject.mockResolvedValueOnce({ logo: null, designMd: null });
    await expect(loadNewsletterBrandFromDesignMd(input)).resolves.toEqual(
      FAILED,
    );
    mocks.fetchMarkdown.mockResolvedValueOnce({ error: true });
    await expect(loadNewsletterBrandFromDesignMd(input)).resolves.toEqual(
      FAILED,
    );
    mocks.getProject.mockRejectedValueOnce(new Error("Core unavailable"));
    await expect(loadNewsletterBrandFromDesignMd(input)).resolves.toEqual(
      FAILED,
    );
  });
});
