import type { Newsletter } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  getSettings: vi.fn(),
  form: vi.fn(),
  pathname: { current: "/newsletter/settings" },
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => mocks.pathname.current,
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
vi.mock("../newsletter-settings-form", () => ({
  NewsletterSettingsForm: (props: object) => {
    mocks.form(props);
    return <div>Settings form</div>;
  },
}));

import NewsletterSettingsPage, { generateMetadata } from "./page";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PAGE = messages.App.Newsletter;
const SETTINGS = messages.App.Projects.Newsletter;

function props(searchParams: Record<string, string | string[]> = {}) {
  return { searchParams: Promise.resolve(searchParams) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname.current = "/newsletter/settings";
  mocks.enabled.mockResolvedValue(true);
  mocks.getProject.mockResolvedValue({
    id: PROJECT_ID,
    name: "Launch",
    logo: "https://example.com/logo.png",
  });
  mocks.getSettings.mockResolvedValue(null);
  mocks.listProjects.mockResolvedValue({ projects: [], pagination: null });
});

describe("NewsletterSettingsPage", () => {
  it("returns notFound before reading anything when disabled", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(
      NewsletterSettingsPage(props({ projectId: PROJECT_ID })),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("uses the translated page title for metadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Newsletter" });
  });

  describe("with a project", () => {
    it("shows setup for the named project with only a Settings tab", async () => {
      render(
        await NewsletterSettingsPage(props({ projectId: ` ${PROJECT_ID} ` })),
      );

      expect(mocks.getProject).toHaveBeenCalledWith(PROJECT_ID);
      expect(
        screen.getByRole("heading", { level: 2, name: "Launch newsletter" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: SETTINGS.emptyTitle }),
      ).toBeInTheDocument();
      const tabs = screen.getAllByRole("link");
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toHaveAttribute(
        "href",
        `/newsletter/settings?projectId=${PROJECT_ID}`,
      );
      expect(tabs[0]).toHaveAttribute("aria-current", "page");
      expect(mocks.form).toHaveBeenCalledWith(
        expect.objectContaining({
          newsletter: null,
          projectId: PROJECT_ID,
          projectName: "Launch",
          projectLogo: "https://example.com/logo.png",
        }),
      );
    });

    it("uses the first project scope when the query parameter is repeated", async () => {
      await NewsletterSettingsPage(
        props({ projectId: [PROJECT_ID, "ignored"] }),
      );
      expect(mocks.getProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
    });

    it("loads existing settings and offers Issues, Calendar, Subscribers, Settings", async () => {
      const newsletter: Pick<Newsletter, "id" | "name"> = {
        id: "n1",
        name: "Weekly",
      };
      mocks.getSettings.mockResolvedValue(newsletter);
      render(await NewsletterSettingsPage(props({ projectId: PROJECT_ID })));

      expect(mocks.getSettings).toHaveBeenCalledWith(PROJECT_ID);
      expect(
        screen.queryByRole("heading", { name: SETTINGS.emptyTitle }),
      ).not.toBeInTheDocument();
      expect(mocks.form).toHaveBeenCalledWith(
        expect.objectContaining({ newsletter }),
      );
      const nav = screen.getByRole("navigation", {
        name: SETTINGS.navigation,
      });
      expect(
        Array.from(nav.querySelectorAll("a")).map((link) => [
          link.textContent,
          link.getAttribute("href"),
        ]),
      ).toEqual([
        [SETTINGS.Issues.title, `/newsletter/issues?projectId=${PROJECT_ID}`],
        [
          SETTINGS.Calendar.title,
          `/newsletter/calendar?projectId=${PROJECT_ID}`,
        ],
        [
          SETTINGS.Subscribers.title,
          `/newsletter/subscribers?projectId=${PROJECT_ID}`,
        ],
        [
          SETTINGS.Analytics.title,
          `/newsletter/analytics?projectId=${PROJECT_ID}`,
        ],
        [SETTINGS.settings, `/newsletter/settings?projectId=${PROJECT_ID}`],
      ]);
      expect(
        screen.getByRole("link", { name: SETTINGS.settings }),
      ).toHaveAttribute("aria-current", "page");
    });

    it("does not disguise a failed settings read as an empty newsletter", async () => {
      mocks.getSettings.mockRejectedValue(new Error("Core unavailable"));
      await expect(
        NewsletterSettingsPage(props({ projectId: PROJECT_ID })),
      ).rejects.toThrow("Core unavailable");
      expect(mocks.form).not.toHaveBeenCalled();
    });
  });

  describe("without a project", () => {
    it("lists workspace projects linking to their newsletter", async () => {
      mocks.listProjects.mockResolvedValue({
        projects: [
          { id: "project-1", name: "Launch plan" },
          { id: "project-2", name: "Weekly update" },
        ],
        pagination: null,
      });

      render(await NewsletterSettingsPage(props()));

      expect(
        screen.getByRole("heading", { level: 1, name: PAGE.title }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: PAGE.pickProject }),
      ).toBeInTheDocument();
      expect(screen.getByText(PAGE.description)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Launch plan" })).toHaveAttribute(
        "href",
        "/newsletter/settings?projectId=project-1",
      );
      expect(
        screen.getByRole("link", { name: "Weekly update" }),
      ).toHaveAttribute("href", "/newsletter/settings?projectId=project-2");
      expect(mocks.getProject).not.toHaveBeenCalled();
      expect(screen.queryByText(PAGE.pickUnavailable)).toBeNull();
    });

    it("shows an empty state with a way to create a project", async () => {
      render(await NewsletterSettingsPage(props({ projectId: " " })));

      expect(
        screen.getByRole("heading", { name: PAGE.empty.title }),
      ).toBeInTheDocument();
      expect(screen.getByText(PAGE.empty.description)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: PAGE.empty.action }),
      ).toHaveAttribute("href", "/projects?create=true");
      expect(mocks.getProject).not.toHaveBeenCalled();
    });

    it("keeps later projects reachable through Core's pagination", async () => {
      mocks.listProjects.mockResolvedValue({
        projects: [{ id: "project-2", name: "Later project" }],
        pagination: { nextCursor: "next/page" },
      });

      render(await NewsletterSettingsPage(props({ cursor: "current-page" })));

      expect(mocks.listProjects).toHaveBeenCalledWith({
        limit: 20,
        cursor: "current-page",
      });
      expect(screen.getByRole("link", { name: PAGE.nextPage })).toHaveAttribute(
        "href",
        "/newsletter/settings?cursor=next%2Fpage",
      );
    });
  });

  describe("with an unknown project", () => {
    it("says so above the project list instead of 404-ing", async () => {
      mocks.getProject.mockResolvedValue(null);
      render(await NewsletterSettingsPage(props({ projectId: PROJECT_ID })));

      expect(screen.getByText(PAGE.pickUnavailable)).toBeInTheDocument();
      expect(mocks.listProjects).toHaveBeenCalled();
      expect(mocks.getSettings).not.toHaveBeenCalled();
    });

    it("does not ask Core about a malformed project ID", async () => {
      render(await NewsletterSettingsPage(props({ projectId: "missing" })));

      expect(screen.getByText(PAGE.pickUnavailable)).toBeInTheDocument();
      expect(mocks.getProject).not.toHaveBeenCalled();
    });
  });
});
