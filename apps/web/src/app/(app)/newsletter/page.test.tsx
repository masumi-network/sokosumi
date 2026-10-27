import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/newsletter",
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App.Newsletter") =>
    createTranslator({ locale: "en", messages, namespace }),
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    getSettings: mocks.getSettings,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: mocks.getProject,
    listProjects: mocks.listProjects,
  },
}));

import NewsletterPage, { generateMetadata } from "./page";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PAGE = messages.App.Newsletter;

function props(searchParams: Record<string, string | string[]> = {}) {
  return { searchParams: Promise.resolve(searchParams) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.getProject.mockResolvedValue({ id: PROJECT_ID, name: "Launch" });
  mocks.getSettings.mockResolvedValue(null);
  mocks.listProjects.mockResolvedValue({ projects: [], pagination: null });
});

describe("NewsletterPage", () => {
  it("returns notFound before reading anything when disabled", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(
      NewsletterPage(props({ projectId: PROJECT_ID })),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("uses the translated page title for metadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Newsletter" });
  });

  it("opens the issues of an existing newsletter", async () => {
    mocks.getSettings.mockResolvedValue({ id: "n1", name: "Weekly" });
    await expect(
      NewsletterPage(props({ projectId: PROJECT_ID })),
    ).rejects.toThrow(`REDIRECT:/newsletter/issues?projectId=${PROJECT_ID}`);
    expect(mocks.getSettings).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("opens setup while the project has no newsletter", async () => {
    await expect(
      NewsletterPage(props({ projectId: PROJECT_ID })),
    ).rejects.toThrow(`REDIRECT:/newsletter/settings?projectId=${PROJECT_ID}`);
  });

  it("lists the projects, linking back to the index, without a project", async () => {
    mocks.listProjects.mockResolvedValue({
      projects: [{ id: "project-1", name: "Launch plan" }],
      pagination: null,
    });
    render(await NewsletterPage(props()));

    expect(
      screen.getByRole("heading", { level: 2, name: PAGE.pickProject }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Launch plan" })).toHaveAttribute(
      "href",
      "/newsletter?projectId=project-1",
    );
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("says an unknown project is unavailable instead of redirecting", async () => {
    mocks.getProject.mockResolvedValue(null);
    render(await NewsletterPage(props({ projectId: PROJECT_ID })));

    expect(screen.getByText(PAGE.pickUnavailable)).toBeInTheDocument();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });
});
