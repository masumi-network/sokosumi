import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";

const { isEnabledMock, projectServiceMock, notFoundMock, redirectMock } =
  vi.hoisted(() => ({
    isEnabledMock: vi.fn(),
    projectServiceMock: { getProjectById: vi.fn(), listProjects: vi.fn() },
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    redirectMock: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
  }));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({ locale: "en", messages, namespace: "App.Newsletter" }),
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: isEnabledMock },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

import NewsletterPage, { generateMetadata } from "./page";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("NewsletterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnabledMock.mockResolvedValue(true);
    projectServiceMock.getProjectById.mockResolvedValue({ id: PROJECT_ID });
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [],
      pagination: null,
    });
  });

  it("returns notFound before reading projects when disabled", async () => {
    isEnabledMock.mockResolvedValue(false);

    await expect(
      NewsletterPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledOnce();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects a valid project scope to its newsletter", async () => {
    await expect(
      NewsletterPage({
        searchParams: Promise.resolve({ projectId: ` ${PROJECT_ID} ` }),
      }),
    ).rejects.toThrow(`REDIRECT:/projects/${PROJECT_ID}/newsletter`);
    expect(projectServiceMock.getProjectById).toHaveBeenCalledWith(PROJECT_ID);
    expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
  });

  it("uses the first project scope when the query parameter is repeated", async () => {
    await expect(
      NewsletterPage({
        searchParams: Promise.resolve({ projectId: [PROJECT_ID, "ignored"] }),
      }),
    ).rejects.toThrow(`REDIRECT:/projects/${PROJECT_ID}/newsletter`);
    expect(projectServiceMock.getProjectById).toHaveBeenCalledExactlyOnceWith(
      PROJECT_ID,
    );
  });

  it("returns notFound for a malformed project ID before calling Core", async () => {
    await expect(
      NewsletterPage({
        searchParams: Promise.resolve({ projectId: "missing" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(projectServiceMock.listProjects).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("does not redirect to a project the workspace cannot access", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    await expect(
      NewsletterPage({
        searchParams: Promise.resolve({ projectId: PROJECT_ID }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(projectServiceMock.getProjectById).toHaveBeenCalledWith(PROJECT_ID);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("lists workspace projects linking to their existing newsletter pages", async () => {
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [
        { id: "project-1", name: "Launch plan" },
        { id: "project-2", name: "Weekly update" },
      ],
      pagination: null,
    });

    render(await NewsletterPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Newsletter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(messages.App.Newsletter.description),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Launch plan" })).toHaveAttribute(
      "href",
      "/projects/project-1/newsletter",
    );
    expect(screen.getByRole("link", { name: "Weekly update" })).toHaveAttribute(
      "href",
      "/projects/project-2/newsletter",
    );
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("shows an empty state with a way to create a project", async () => {
    render(
      await NewsletterPage({
        searchParams: Promise.resolve({ projectId: " " }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: messages.App.Newsletter.empty.title,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(messages.App.Newsletter.empty.description),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: messages.App.Newsletter.empty.action }),
    ).toHaveAttribute("href", "/projects?create=true");
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("keeps later projects reachable through Core's pagination", async () => {
    projectServiceMock.listProjects.mockResolvedValue({
      projects: [{ id: "project-2", name: "Later project" }],
      pagination: { nextCursor: "next/page" },
    });

    render(
      await NewsletterPage({
        searchParams: Promise.resolve({ cursor: "current-page" }),
      }),
    );

    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      limit: 20,
      cursor: "current-page",
    });
    expect(
      screen.getByRole("link", { name: messages.App.Newsletter.nextPage }),
    ).toHaveAttribute("href", "/newsletter?cursor=next%2Fpage");
  });

  it("uses the first cursor when the query parameter is repeated", async () => {
    render(
      await NewsletterPage({
        searchParams: Promise.resolve({ cursor: ["current-page", "ignored"] }),
      }),
    );

    expect(projectServiceMock.listProjects).toHaveBeenCalledWith({
      limit: 20,
      cursor: "current-page",
    });
  });

  it("uses the translated page title for metadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Newsletter" });
  });
});
