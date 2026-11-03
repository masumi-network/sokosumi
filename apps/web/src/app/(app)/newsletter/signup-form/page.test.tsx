import { render, screen } from "@testing-library/react";
import type { Window } from "happy-dom";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en.json";
import {
  NEWSLETTER,
  NEWSLETTER_PROJECT_ID,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  project: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("@/i18n/client-message-boundary", () => ({
  ClientMessageBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/actions/newsletter/action", () => ({
  saveNewsletterSettings: vi.fn(),
}));
vi.mock("@/lib/actions/newsletter/signup", () => ({
  subscribeToNewsletter: vi.fn(),
}));
vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: vi.fn(),
  getUserFileUploadErrorMessage: (_error: unknown, fallback: string) =>
    fallback,
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  usePathname: () => "/newsletter/signup-form",
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App.Newsletter") =>
    createTranslator({ locale: "en", messages, namespace }),
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    isEnabled: mocks.enabled,
    getSettings: mocks.settings,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: mocks.project },
}));
vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_SOKOSUMI_URL: "https://preview.example.com",
  }),
}));
vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: () => undefined,
}));
vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  usePrefetchScopeProjects: () => () => undefined,
  useHasAnyScopeProject: () => ({ isPending: false, hasProjects: true }),
}));

import NewsletterSignupFormPage from "./page";

const PROPS = {
  searchParams: Promise.resolve({ projectId: NEWSLETTER_PROJECT_ID }),
};
const SIGNUP_URL = `https://preview.example.com/n/${PUBLIC_NEWSLETTER_SLUG}`;

beforeAll(() => {
  // Inspect the iframe destination without fetching the public page in this unit test.
  (window as typeof window & Window).happyDOM.settings.enableIframePageLoading =
    false;
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.project.mockResolvedValue({
    id: NEWSLETTER_PROJECT_ID,
    name: "Launch",
  });
  mocks.settings.mockResolvedValue(NEWSLETTER);
});

describe("newsletter signup form page", () => {
  it("shows the selected project's signup links and a live preview", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await NewsletterSignupFormPage(PROPS)}
      </NextIntlClientProvider>,
    );

    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith(
      NEWSLETTER_PROJECT_ID,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Launch newsletter" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Signup form" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Signup form" })).toHaveAttribute(
      "href",
      `/newsletter/signup-form?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
    expect(screen.getByRole("heading", { name: "Signup form" })).toBeVisible();
    expect(
      screen.getByText(
        messages.App.Projects.Newsletter.SignupForm.pageDescription,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(messages.App.Projects.Newsletter.SignupForm.description),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open signup page" }),
    ).toHaveAttribute("href", SIGNUP_URL);
    expect(
      screen.getByRole("heading", { name: "Signup form preview" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Customize signup form" }),
    ).toBeVisible();
    expect(
      screen.getByRole("tab", { name: "Newsletter signup" }),
    ).toBeVisible();
  });

  it("hides disabled newsletters before reading the project or settings", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterSignupFormPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("asks for a project when no project is selected", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await NewsletterSignupFormPage({ searchParams: Promise.resolve({}) })}
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("newsletter-no-project")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Select project" }),
    ).toBeVisible();
    expect(
      screen.queryByText(messages.App.Newsletter.pickUnavailable),
    ).toBeNull();
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("shows the unavailable notice for an inaccessible project", async () => {
    mocks.project.mockResolvedValue(null);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await NewsletterSignupFormPage(PROPS)}
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(messages.App.Newsletter.pickUnavailable),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Select project" }),
    ).toBeVisible();
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("returns to project settings until a newsletter is configured", async () => {
    mocks.settings.mockResolvedValue(null);
    await expect(NewsletterSignupFormPage(PROPS)).rejects.toThrow(
      `REDIRECT:/newsletter/settings?projectId=${NEWSLETTER_PROJECT_ID}`,
    );
  });

  it("preserves slug encoding in the preview and hosted page link", async () => {
    mocks.settings.mockResolvedValue({ ...NEWSLETTER, publicSlug: 'news/"&' });
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {await NewsletterSignupFormPage(PROPS)}
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        /<iframe src="https:\/\/preview.example.com\/n\/news%2F%22%26\/embed"/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open signup page" }),
    ).toHaveAttribute("href", "https://preview.example.com/n/news%2F%22%26");
  });

  it("propagates settings read failures", async () => {
    mocks.settings.mockRejectedValue(new Error("Core unavailable"));
    await expect(NewsletterSignupFormPage(PROPS)).rejects.toThrow(
      "Core unavailable",
    );
  });
});
